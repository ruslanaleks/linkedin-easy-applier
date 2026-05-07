import { IsObject, IsOptional } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsObject()
  scoringConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  aiConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  engagementConfig?: Record<string, unknown>;
}
