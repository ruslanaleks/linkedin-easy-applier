import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GeneratedPostStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ThrottleGenerateGuard } from '../common/guards/throttle-generate.guard';
import {
  CurrentUser,
  AuthUser,
} from '../auth/decorators/current-user.decorator';
import { GenerationService } from './generation.service';
import { GeneratePostDto } from './dto/generate-post.dto';
import { UpdateGeneratedDto } from './dto/update-generated.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class GenerationController {
  constructor(private generationService: GenerationService) {}

  @Post('generate')
  @UseGuards(ThrottleGenerateGuard)
  generate(@CurrentUser() user: AuthUser, @Body() dto: GeneratePostDto) {
    return this.generationService.generate(user.userId, dto);
  }

  @Get('generated')
  listGenerated(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: GeneratedPostStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.generationService.listGenerated(
      user.userId,
      status,
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  @Patch('generated/:id')
  updateGenerated(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateGeneratedDto,
  ) {
    return this.generationService.updateGenerated(user.userId, id, dto);
  }
}
