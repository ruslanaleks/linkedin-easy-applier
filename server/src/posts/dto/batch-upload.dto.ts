import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PostDto {
  @IsString()
  externalId: string;

  @IsString()
  authorName: string;

  @IsOptional()
  @IsString()
  authorHeadline?: string;

  @IsOptional()
  @IsString()
  authorProfileUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  authorTier?: number;

  @IsString()
  @MinLength(10)
  content: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsISO8601()
  postedAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  reactions?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  comments?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reposts?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];

  @IsOptional()
  media?: unknown;

  @IsOptional()
  @IsNumber()
  score?: number;

  @IsOptional()
  @IsObject()
  scoreBreakdown?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assignedCategories?: string[];

  @IsOptional()
  @IsISO8601()
  scrapedAt?: string;

  @IsOptional()
  @IsString()
  scrapedBySession?: string;

  @IsOptional()
  rawPayload?: unknown;
}

export class BatchUploadDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PostDto)
  posts: PostDto[];
}
