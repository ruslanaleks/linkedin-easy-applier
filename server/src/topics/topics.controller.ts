import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthUser,
} from '../auth/decorators/current-user.decorator';
import { TopicsService } from './topics.service';
import { WeeklyTopicsQueryDto } from './dto/weekly-topics-query.dto';

@Controller('topics')
@UseGuards(JwtAuthGuard)
export class TopicsController {
  constructor(private topicsService: TopicsService) {}

  @Get('weekly')
  getWeeklyTopics(
    @CurrentUser() user: AuthUser,
    @Query() query: WeeklyTopicsQueryDto,
  ) {
    return this.topicsService.getWeeklyTopics(
      user.userId,
      query.week || 'both',
    );
  }

  @Get(':id/posts')
  getTopicPosts(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.topicsService.getTopicPosts(user.userId, id);
  }
}
