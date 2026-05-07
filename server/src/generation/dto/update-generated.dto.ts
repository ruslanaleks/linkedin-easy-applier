import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import { GeneratedPostStatus } from '@prisma/client';

export class UpdateGeneratedDto {
  @IsOptional()
  @IsEnum(GeneratedPostStatus)
  status?: GeneratedPostStatus;

  @IsOptional()
  @IsString()
  myEditedText?: string;

  @IsOptional()
  @IsISO8601()
  publishedAt?: string;
}
