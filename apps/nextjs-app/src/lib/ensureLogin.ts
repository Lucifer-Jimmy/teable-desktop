import type { ParsedUrlQuery } from 'querystring';
import { HttpError, isAnonymous } from '@teable/core';
import type {
  GetServerSidePropsContext,
  GetServerSidePropsResult,
  PreviewData,
  GetServerSideProps as NextGetServerSideProps,
} from 'next';
import { getUserMe } from '@/backend/api/rest/get-user';
import { isValidRedirectPath } from './isValidRedirectPath';

/* eslint-disable @typescript-eslint/no-explicit-any */
type GetServerSideProps<
  P extends { [key: string]: any } = { [key: string]: any },
  Q extends ParsedUrlQuery = ParsedUrlQuery,
  D extends PreviewData = PreviewData,
> = (context: GetServerSidePropsContext<Q, D>) => Promise<GetServerSidePropsResult<P>>;

export default function ensureLogin<P extends { [key: string]: any }>(
  handler: GetServerSideProps<P, ParsedUrlQuery, PreviewData>,
  isLoginPage?: boolean,
  options?: { parallelHandler?: boolean }
): NextGetServerSideProps<P> {
  // eslint-disable-next-line sonarjs/cognitive-complexity
  return async (context: GetServerSidePropsContext) => {
    if (options?.parallelHandler && !isLoginPage) {
      return ensureLoginParallel(handler, context);
    }
    const req = context.req;
    let props: { [key: string]: any } = {};
    try {
      const user = await getUserMe(req?.headers.cookie);
      props['user'] = user;
      // User is logged in, redirect to home page if on login page
      if (!isAnonymous(user?.id) && isLoginPage) {
        const redirect = context.query.redirect;
        // The affiliate token no longer rides redirect URLs — it lives in the
        // first-party `teable_affiliate_via` cookie (see src/proxy.ts), which every
        // downstream consumer (Rewardful bridge, backend attribution) reads.
        const destination =
          typeof redirect === 'string' && isValidRedirectPath(redirect) ? redirect : '/space';

        return {
          redirect: {
            destination,
            permanent: false,
          },
        };
      }
    } catch (error) {
      if (error instanceof HttpError) {
        if (isLoginPage) {
          // User is not logged in, handle login page
          return handler(context);
        }
        if (error.status < 500 && error.status >= 400) {
          // User is not logged in, redirect to sign up by default
          const redirect = encodeURIComponent(req?.url || '');
          const query = redirect ? `redirect=${redirect}` : '';
          return {
            redirect: {
              destination: `/auth/signup?${query}`,
              permanent: false,
            },
          };
        }
      }

      console.error('ensureLogin: ', error);
      // Workaround for https://github.com/zeit/next.js/issues/8592
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props['err'] = (error as any)?.message;
    }

    const res = await handler(context);
    if ('props' in res) {
      props = {
        ...(await res.props),
        ...props,
      };
    }

    return {
      ...res,
      props: props as P,
    };
  };
}
// The user lookup only gates the login redirect, so it doesn't have to block
// the handler's own requests — those fail with 401 on their own (and withAuthSSR
// already redirects to sign up) when the session is invalid.
async function ensureLoginParallel<P extends { [key: string]: any }>(
  handler: GetServerSideProps<P, ParsedUrlQuery, PreviewData>,
  context: GetServerSidePropsContext
): Promise<GetServerSidePropsResult<P>> {
  const req = context.req;
  let props: { [key: string]: any } = {};
  const [userResult, handlerResult] = await Promise.allSettled([
    getUserMe(req?.headers.cookie),
    handler(context),
  ]);

  if (userResult.status === 'fulfilled') {
    props['user'] = userResult.value;
  } else {
    const error = userResult.reason;
    if (error instanceof HttpError && error.status < 500 && error.status >= 400) {
      const redirect = encodeURIComponent(req?.url || '');
      const query = redirect ? `redirect=${redirect}` : '';
      return {
        redirect: {
          destination: `/auth/signup?${query}`,
          permanent: false,
        },
      };
    }
    console.error('ensureLogin: ', error);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    props['err'] = (error as any)?.message;
  }

  if (handlerResult.status === 'rejected') {
    throw handlerResult.reason;
  }
  const res = handlerResult.value;
  if ('props' in res) {
    props = {
      ...(await res.props),
      ...props,
    };
  }
  return {
    ...res,
    props: props as P,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
