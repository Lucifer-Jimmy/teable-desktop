import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { IUserMeVo } from '@teable/openapi';
import {
  IAddPasswordRo,
  IChangePasswordRo,
  ISignup,
  addPasswordRoSchema,
  changePasswordRoSchema,
  signupSchema,
} from '@teable/openapi';
import { Response, Request } from 'express';
import { AUTH_SESSION_COOKIE_NAME } from '../../../const';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../decorators/permissions.decorator';
import { Public } from '../decorators/public.decorator';
import { LocalAuthGuard } from '../guard/local-auth.guard';
import { SessionService } from '../session/session.service';
import { pickUserMe } from '../utils';
import { LocalAuthService } from './local-auth.service';

@Controller('api/auth')
export class LocalAuthController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly authService: LocalAuthService
  ) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @HttpCode(200)
  @Post('signin')
  async signin(@Req() req: Request): Promise<IUserMeVo> {
    return req.user as IUserMeVo;
  }

  @Public()
  @Post('signup')
  async signup(
    @Body(new ZodValidationPipe(signupSchema)) body: ISignup,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request
  ): Promise<IUserMeVo> {
    const remoteIp =
      req.ip || req.connection.remoteAddress || (req.headers['x-forwarded-for'] as string);
    const user = pickUserMe(await this.authService.signup(body, remoteIp));
    // set cookie, passport login
    await new Promise<void>((resolve, reject) => {
      req.login(user, (err) => (err ? reject(err) : resolve()));
    });
    return user;
  }

  @Patch('/change-password')
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordRoSchema)) changePasswordRo: IChangePasswordRo,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    await this.authService.changePassword(changePasswordRo);
    await this.sessionService.signout(req);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }

  @Post('/add-password')
  async addPassword(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @Body(new ZodValidationPipe(addPasswordRoSchema)) body: IAddPasswordRo
  ) {
    await this.authService.addPassword(body.password);
    await this.sessionService.signout(req);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }
}
