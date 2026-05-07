import { Module } from '@nestjs/common';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { ThrottleGenerateGuard } from '../common/guards/throttle-generate.guard';

@Module({
  controllers: [GenerationController],
  providers: [GenerationService, ThrottleGenerateGuard],
})
export class GenerationModule {}
