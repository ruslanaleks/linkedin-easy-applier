import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthUser,
} from '../auth/decorators/current-user.decorator';
import { PostsService } from './posts.service';
import { BatchUploadDto } from './dto/batch-upload.dto';
import { LabelPostDto } from './dto/label-post.dto';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private postsService: PostsService) {}

  @Post('batch')
  batchUpload(@CurrentUser() user: AuthUser, @Body() dto: BatchUploadDto) {
    return this.postsService.batchUpload(user.userId, dto.posts);
  }

  @Post(':id/label')
  labelPost(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: LabelPostDto,
  ) {
    return this.postsService.labelPost(user.userId, id, dto.label);
  }
}
