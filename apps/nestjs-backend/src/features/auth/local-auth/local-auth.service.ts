/* eslint-disable sonarjs/no-duplicate-string */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { generateUserId, getRandomString, HttpErrorCode, RandomType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { EmailVerifyCodeType, MailTransporterType, MailType } from '@teable/openapi';
import type { IChangePasswordRo, ISignup } from '@teable/openapi';
import * as bcrypt from 'bcrypt';
import { isEmpty } from 'lodash';
import ms from 'ms';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../../cache/cache.service';
import { AuthConfig, type IAuthConfig } from '../../../configs/auth.config';
import { BaseConfig, IBaseConfig } from '../../../configs/base.config';
import { MailConfig, type IMailConfig } from '../../../configs/mail.config';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { CustomHttpException } from '../../../custom.exception';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import { UserEmailChangeEvent } from '../../../event-emitter/events/user/user.event';
import type { IClsStore } from '../../../types/cls';
import { second } from '../../../utils/second';
import { SettingService } from '../../setting/setting.service';
import { UserService } from '../../user/user.service';
import { TeableJwtService } from '../jwt/teable-jwt.service';
import { SessionStoreService } from '../session/session-store.service';

@Injectable()
export class LocalAuthService {
  private readonly logger = new Logger(LocalAuthService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly userService: UserService,
    private readonly cls: ClsService<IClsStore>,
    private readonly sessionStoreService: SessionStoreService,
    private readonly cacheService: CacheService,
    private readonly eventEmitterService: EventEmitterService,
    @AuthConfig() private readonly authConfig: IAuthConfig,
    @MailConfig() private readonly mailConfig: IMailConfig,
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly jwtService: TeableJwtService,
    private readonly settingService: SettingService
  ) {}

  private async encodePassword(password: string) {
    const salt = await bcrypt.genSalt(10);
    const hashPassword = await bcrypt.hash(password, salt);
    return { salt, hashPassword };
  }

  private async comparePassword(
    password: string,
    hashPassword: string | null,
    salt: string | null
  ) {
    const _hashPassword = await bcrypt.hash(password || '', salt || '');
    return _hashPassword === hashPassword;
  }

  private async getUserByIdOrThrow(userId: string) {
    const user = await this.userService.getUserById(userId);
    if (!user) {
      throw new CustomHttpException(`User not found`, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.user.notFound',
        },
      });
    }
    return user;
  }

  async validateUserByEmail(email: string, pass: string) {
    const user = await this.userService.getUserByEmail(email);
    if (!user || (user.accounts.length === 0 && user.password == null)) {
      throw new CustomHttpException(`${email} not registered`, HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.auth.emailNotRegistered',
        },
      });
    }

    if (!user.password) {
      throw new CustomHttpException(`Password is not set`, HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.auth.passwordNotSet',
        },
      });
    }

    if (user.isSystem) {
      throw new CustomHttpException(`User is system user`, HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.auth.systemUser',
        },
      });
    }

    const { password, salt, ...result } = user;
    return (await this.comparePassword(pass, password, salt)) ? { ...result, password } : null;
  }

  async validateUserByEmailWithTurnstile(email: string, pass: string) {
    // Turnstile verification removed (round 2 auth cut).
    return this.validateUserByEmail(email, pass);
  }

  private jwtSignupCode(email: string, code: string) {
    return this.jwtService.signAsync(
      { email, code },
      { expiresIn: this.authConfig.signupVerificationExpiresIn }
    );
  }

  private jwtVerifySignupCode(token: string) {
    return this.jwtService.verifyAsync<{ email: string; code: string }>(token).catch(() => {
      throw new CustomHttpException('Verification code is invalid', HttpErrorCode.INVALID_CAPTCHA);
    });
  }

  private async verifySignup(_body: ISignup) {
    // Email verification removed with the mail-sender feature (round 1 collaboration cut).
    return;
  }

  private isRegisteredValidate(user: Awaited<ReturnType<typeof this.userService.getUserByEmail>>) {
    if (user && (user.password !== null || user.accounts.length > 0)) {
      throw new CustomHttpException(
        `User ${user.email} is already registered`,
        HttpErrorCode.CONFLICT,
        {
          localization: {
            i18nKey: 'httpErrors.auth.alreadyRegistered',
          },
        }
      );
    }
    if (user && user.isSystem) {
      throw new CustomHttpException(
        `User ${user.email} is system user`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.auth.systemUser',
          },
        }
      );
    }
  }

  async signup(body: ISignup, remoteIp?: string) {
    const { email, password, defaultSpaceName, refMeta, inviteCode } = body;

    this.logger.log(`Signup attempt - email: ${email}, remoteIp: ${remoteIp}`);

    await this.verifySignup(body);

    const user = await this.userService.getUserByEmail(email);
    this.isRegisteredValidate(user);
    // Risk control first, before any write and outside the transaction below —
    // a slow risk service must never hold a database connection.
    await this.userService.throwIfEmailDeniedByRiskControl('signup', email);
    const { salt, hashPassword } = await this.encodePassword(password);
    const res = await this.prismaService.$tx(async (prisma) => {
      if (user) {
        return await prisma.user.update({
          where: { id: user.id, deletedTime: null },
          data: {
            salt,
            password: hashPassword,
            lastSignTime: new Date().toISOString(),
            // Same first-touch attribution merge as fresh creation: this
            // branch CLAIMS a user pre-created by an email invitation, and
            // it is that person's real signup moment.
            refMeta: this.userService.applySignupAttribution(
              refMeta ? JSON.stringify(refMeta) : undefined
            ),
          },
        });
      }
      return await this.userService.createUserWithSettingCheck(
        {
          id: generateUserId(),
          name: email.split('@')[0],
          email,
          salt,
          password: hashPassword,
          lastSignTime: new Date().toISOString(),
          refMeta: isEmpty(refMeta) ? undefined : JSON.stringify(refMeta),
        },
        undefined,
        defaultSpaceName,
        inviteCode
      );
    });
    await this.userService.recordSignup(res.id);
    return res;
  }

  async changePassword({ password, newPassword }: IChangePasswordRo) {
    const userId = this.cls.get('user.id');
    const user = await this.getUserByIdOrThrow(userId);

    const { password: currentHashPassword, salt } = user;
    if (!(await this.comparePassword(password, currentHashPassword, salt))) {
      throw new CustomHttpException(`Password is incorrect`, HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.auth.passwordIncorrect',
        },
      });
    }
    const { salt: newSalt, hashPassword: newHashPassword } = await this.encodePassword(newPassword);
    await this.prismaService.txClient().user.update({
      where: { id: userId, deletedTime: null },
      data: {
        password: newHashPassword,
        salt: newSalt,
      },
    });
    // clear session
    await this.sessionStoreService.clearByUserId(userId);
  }

  async addPassword(newPassword: string) {
    const userId = this.cls.get('user.id');
    const user = await this.getUserByIdOrThrow(userId);

    if (user.password) {
      throw new CustomHttpException(`Password is already set`, HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.auth.passwordAlreadyExists',
        },
      });
    }
    const { salt, hashPassword } = await this.encodePassword(newPassword);
    await this.prismaService.txClient().user.update({
      where: { id: userId, deletedTime: null, password: null },
      data: {
        password: hashPassword,
        salt,
      },
    });
    // clear session
    await this.sessionStoreService.clearByUserId(userId);
  }
}
