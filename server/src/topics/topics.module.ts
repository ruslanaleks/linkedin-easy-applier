import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TopicsController } from './topics.controller';
import { TopicsService } from './topics.service';
import { TopicExtractionProcessor } from './topic-extraction.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'topic-extraction' })],
  controllers: [TopicsController],
  providers: [TopicsService, TopicExtractionProcessor],
  exports: [TopicsService],
})
export class TopicsModule {}
