import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { GenerationMode } from '@prisma/client';

export class ToneSettingsDto {
  @IsInt()
  @Min(0)
  @Max(100)
  serious: number;

  @IsInt()
  @Min(0)
  @Max(100)
  humor: number;

  @IsInt()
  @Min(0)
  @Max(100)
  personal: number;

  @IsInt()
  @Min(0)
  @Max(100)
  provocative: number;

  @IsIn(['short', 'medium', 'long'])
  length: 'short' | 'medium' | 'long';
}

export class GeneratePostDto {
  @IsEnum(GenerationMode)
  mode: GenerationMode;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  topicIds?: string[];

  @ValidateNested()
  @Type(() => ToneSettingsDto)
  toneSettings: ToneSettingsDto;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  extraContext?: string;
}
