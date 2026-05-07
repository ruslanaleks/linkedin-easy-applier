import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ThrottleGenerateGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;
    if (!userId) return false;

    const limit = parseInt(
      this.config.get('GENERATE_DAILY_LIMIT') || '30',
      10,
    );

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const count = await this.prisma.generatedPost.count({
      where: {
        accountId: userId,
        createdAt: { gte: todayStart },
      },
    });

    if (count >= limit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Daily generation limit reached (${limit}/day). Resets at midnight UTC.`,
          remaining: 0,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
