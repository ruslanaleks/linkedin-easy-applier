import { IsIn, IsOptional } from 'class-validator';

export class WeeklyTopicsQueryDto {
  @IsOptional()
  @IsIn(['current', 'previous', 'both'])
  week?: 'current' | 'previous' | 'both' = 'both';
}
