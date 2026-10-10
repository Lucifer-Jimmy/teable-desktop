import { useMutation } from '@tanstack/react-query';
import { HttpErrorCode, type HttpError } from '@teable/core';
import type { ISignin, ISignup } from '@teable/openapi';
import {
  signup,
  signin,
  signinSchema,
  signupSchema,
  sendSignupVerificationCode,
  sendSignupVerificationCodeRoSchema,
} from '@teable/openapi';
import { Spin, Error as ErrorCom } from '@teable/ui-lib/base';
import { Button, Input, Label, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ZodIssue } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { trackSignUp } from '@/components/google-ads';
import { useCutDown } from '@/features/app/hooks/useCutDown';
import { useEnv } from '@/features/app/hooks/useEnv';
import { usePublicSettingQuery } from '@/features/app/hooks/useSetting';
import { authConfig } from '../../i18n/auth.config';
import { SendVerificationButton } from './SendVerificationButton';

export interface ISignForm {
  className?: string;
  type?: 'signin' | 'signup';
  onSuccess?: () => void;
}
export const SignForm: FC<ISignForm> = (props) => {
  const { className, type = 'signin', onSuccess } = props;
  const { t } = useTranslation(authConfig.i18nNamespaces);
  const [signupVerificationToken, setSignupVerificationToken] = useState<string>();
  const [signupVerificationCode, setSignupVerificationCode] = useState<string>();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>();
  const { countdown, setCountdown } = useCutDown();
  const env = useEnv();
  const emailRef = useRef<HTMLInputElement>(null);

  const { data: setting } = usePublicSettingQuery();
  const { signupVerificationSendCodeMailRate = 0 } = setting ?? {};

  useEffect(() => {
    setSignupVerificationCode(undefined);
    setSignupVerificationToken(undefined);
    setError(undefined);
    setCountdown(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // Countdown timer for send verification code button

  const { mutate: submitMutation } = useMutation({
    mutationFn: ({ type, form }: { type: 'signin' | 'signup'; form: ISignin }) => {
      if (type === 'signin') {
        return signin(form);
      }
      if (type === 'signup') {
        // Affiliate attribution rides the teable_affiliate_via cookie, not this payload.
        return signup({
          ...form,
          refMeta: {
            query: window.location.search || undefined,
            referer: document.referrer || undefined,
          },
          defaultSpaceName: t('space:initialSpaceName', { name: form.email.split('@')[0] }),
        });
      }
      throw new Error('Invalid type');
    },
    onError: (error: HttpError) => {
      // need verify email
      switch (error.code) {
        case HttpErrorCode.UNPROCESSABLE_ENTITY:
          if (error.data && typeof error.data === 'object' && 'token' in error.data) {
            setSignupVerificationToken(error.data.token as string);
            setError(undefined);
            // Start countdown based on configured rate limit (only if configured)
            if (
              typeof signupVerificationSendCodeMailRate === 'number' &&
              signupVerificationSendCodeMailRate > 0
            ) {
              setCountdown(signupVerificationSendCodeMailRate);
            }
          } else {
            setError(error.message);
          }
          break;
        case HttpErrorCode.CONFLICT:
          setError(t('auth:signError.exist'));
          break;
        case HttpErrorCode.INVALID_CREDENTIALS:
          setError(t('auth:signError.incorrect'));
          break;
        case HttpErrorCode.INVALID_CAPTCHA:
          setError(t('auth:signupError.verificationCodeInvalid'));
          break;
        case HttpErrorCode.TOO_MANY_REQUESTS:
          if (error.data && typeof error.data === 'object' && 'minutes' in error.data) {
            setError(t('auth:signError.tooManyRequests', { minutes: error.data.minutes }));
          } else {
            setError(error.message);
          }
          break;
        default:
          setError(error.message);
      }
      setIsLoading(false);
      return true;
    },
    meta: {
      preventGlobalError: true,
    },
    onSuccess: (data, variables) => {
      // Cross-domain GA4 signup event (Google Ads conversions upload server-side)
      if (variables.type === 'signup' && data.data) {
        trackSignUp({
          marketingGaId: env.marketingGaId,
          userInfo: {
            id: data.data.id,
            email: data.data.email,
            name: data.data.name,
          },
        });
      }

      onSuccess?.();
    },
  });

  const {
    mutate: sendSignupVerificationCodeMutation,
    isPending: sendSignupVerificationCodeLoading,
  } = useMutation({
    mutationFn: ({ email }: { email: string }) => sendSignupVerificationCode(email),
    onSuccess: (data) => {
      setSignupVerificationToken(data.data.token);
      // Start countdown based on configured rate limit (only if configured)
      if (
        typeof signupVerificationSendCodeMailRate === 'number' &&
        signupVerificationSendCodeMailRate > 0
      ) {
        setCountdown(signupVerificationSendCodeMailRate);
      }
    },
    onError: (error: HttpError) => {
      if (
        error.code === HttpErrorCode.TOO_MANY_REQUESTS &&
        error.data &&
        typeof error.data === 'object' &&
        'seconds' in error.data
      ) {
        setError(t('auth:signupError.sendMailRateLimit', { seconds: error.data.seconds }));
        return;
      }
      setError(error.message);
    },
    meta: {
      preventGlobalError: true,
    },
  });

  const validation = useCallback(
    (form: ISignin | ISignup) => {
      const transformError = (issues: ZodIssue[]) => {
        if (issues?.[0].path?.[0] === 'password') {
          const code = issues[0].code;
          if (code === 'too_small') {
            return { error: t('auth:signupError.passwordLength') };
          }
          // In Zod 4.x, string validation errors may use different codes
          // Check for common validation failure codes
          if (code === 'invalid_format' || code === 'custom') {
            return { error: t('auth:signupError.passwordInvalid') };
          }
        }
        return { error: issues[0]?.message ?? t('common:noun.unknownError') };
      };
      if (type === 'signin') {
        const res = signinSchema.safeParse(form);
        if (!res.success) {
          return transformError(res.error.issues);
        }
        return {
          error: undefined,
        };
      }
      const res = signupSchema.safeParse(form);
      if (!res.success) {
        return transformError(res.error.issues);
      }
      return {
        error: undefined,
      };
    },
    [t, type]
  );

  const showVerificationCode = type === 'signup' && signupVerificationToken;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const email = (event.currentTarget.elements.namedItem('email') as HTMLInputElement).value;
    const password = (event.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
    const code = (event.currentTarget.elements.namedItem('verification-code') as HTMLInputElement)
      ?.value;

    const form = {
      email,
      password,
      verification: code ? { code, token: signupVerificationToken } : undefined,
    };

    const { error } = validation(form);
    if (error) {
      setError(error);
      return;
    }

    if (showVerificationCode && !signupVerificationCode) {
      setError(t('auth:signupError.verificationCodeRequired'));
      return;
    }

    // Using custom isLoading instead of submitMutation.isLoading because isLoading only reflects the mutation state,
    // and we need the loader to persist during the delay between the request completion and the redirect.
    setIsLoading(true);
    submitMutation({ type, form });
  }

  const buttonText = useMemo(
    () => (type === 'signin' ? t('auth:button.signin') : t('auth:button.signup')),
    [t, type]
  );

  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        {
          'pointer-events-none': isLoading,
        },
        className
      )}
    >
      <div className="relative mb-6 text-muted-foreground">
        <h2 className="text-start text-base">
          {type === 'signin' ? t('auth:title.signin') : t('auth:title.signup')}
        </h2>
      </div>
      <form className="relative" onSubmit={onSubmit} onChange={() => setError(undefined)}>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">{t('auth:label.email')}</Label>
            <Input
              className="h-9 sm:h-8"
              id="email"
              placeholder={t('auth:placeholder.email')}
              type="text"
              autoComplete="username"
              ref={emailRef}
              onChange={() => {
                setSignupVerificationCode(undefined);
                setSignupVerificationToken(undefined);
              }}
              disabled={isLoading}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t('auth:label.password')}</Label>
            </div>
            <Input
              className="h-9 sm:h-8"
              id="password"
              placeholder={t('auth:placeholder.password')}
              type="password"
              autoComplete={type === 'signup' ? 'new-password' : 'current-password'}
              disabled={isLoading}
            />
          </div>

          {showVerificationCode && (
            <div className="mt-4 grid gap-3">
              <Label htmlFor="verification-code">{t('auth:label.verificationCode')}</Label>
              <Input
                className="h-9 sm:h-8"
                id="verification-code"
                type="text"
                placeholder={t('auth:placeholder.verificationCode')}
                value={signupVerificationCode}
                onChange={(e) => setSignupVerificationCode(e.target.value)}
              />
              <SendVerificationButton
                disabled={sendSignupVerificationCodeLoading || countdown > 0}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const emailInput = e.currentTarget.form?.querySelector(
                    '#email'
                  ) as HTMLInputElement;
                  const email = emailInput?.value;
                  if (!email) {
                    return;
                  }

                  const res = sendSignupVerificationCodeRoSchema.safeParse({
                    email,
                  });
                  if (!res.success) {
                    setError(fromZodError(res.error).message);
                    return;
                  }
                  sendSignupVerificationCodeMutation({ email });
                }}
                loading={sendSignupVerificationCodeLoading}
                countdown={countdown}
              />
            </div>
          )}

          <div>
            <Button className="w-full" disabled={isLoading}>
              {isLoading && <Spin />}
              {buttonText}
            </Button>
            <ErrorCom error={error} />
          </div>
        </div>
      </form>
    </div>
  );
};
