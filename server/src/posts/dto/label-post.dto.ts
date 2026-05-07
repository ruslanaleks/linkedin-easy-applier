import { IsEnum } from 'class-validator';
import { RelevanceLabel } from '@prisma/client';

export class LabelPostDto {
  @IsEnum(RelevanceLabel)
  label: RelevanceLabel;
}
