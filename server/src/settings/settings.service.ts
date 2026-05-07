import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

// Keys that should be stripped from configs (API keys belong on the server only)
const SENSITIVE_KEYS = [
  'apiKey',
  'claudeApiKey',
  'dashscopeApiKey',
  'openRouterApiKey',
  'xaiApiKey',
  'anthropicApiKey',
];

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private prisma: PrismaService) {}

  async getSettings(accountId: string) {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: {
        scoringConfig: true,
        aiConfig: true,
        engagementConfig: true,
      },
    });

    return account;
  }

  async updateSettings(accountId: string, dto: UpdateSettingsDto) {
    const data: Record<string, unknown> = {};

    if (dto.scoringConfig !== undefined) {
      data.scoringConfig = this.stripSensitiveKeys(dto.scoringConfig);
    }
    if (dto.aiConfig !== undefined) {
      data.aiConfig = this.stripSensitiveKeys(dto.aiConfig);
    }
    if (dto.engagementConfig !== undefined) {
      data.engagementConfig = dto.engagementConfig;
    }

    const account = await this.prisma.account.update({
      where: { id: accountId },
      data,
      select: {
        scoringConfig: true,
        aiConfig: true,
        engagementConfig: true,
      },
    });

    return account;
  }

  private stripSensitiveKeys(
    config: Record<string, unknown>,
  ): Record<string, unknown> {
    const cleaned = { ...config };
    for (const key of SENSITIVE_KEYS) {
      if (key in cleaned) {
        this.logger.warn(
          `Stripping sensitive key "${key}" from settings — API keys should be server-side only`,
        );
        delete cleaned[key];
      }
    }
    return cleaned;
  }
}
