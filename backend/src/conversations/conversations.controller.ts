import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  Post,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  findAll() {
    return this.conversationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.conversationsService.findOne(id);
  }

  @Get(':id/messages')
  getMessages(
    @Param('id') id: string,
    @Query('limit') limit?: number,
  ) {
    return this.conversationsService.getMessages(id, limit ? +limit : 50);
  }

  @Patch(':id/toggle-agent')
  toggleAgent(@Param('id') id: string, @Body() body: { paused: boolean }) {
    return this.conversationsService.toggleAgent(id, body.paused);
  }

  @Post(':id/mark-read')
  markAsRead(@Param('id') id: string) {
    return this.conversationsService.markAsRead(id);
  }

  @Post('pause-all')
  pauseAll() {
    return this.conversationsService.pauseAllExisting();
  }
}
