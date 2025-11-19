import { Controller, Post, Body, Get, Logger, UseGuards, Req, Query, Delete } from '@nestjs/common';
import { ChatService, ChatRequest, ChatResponse } from './chat.service';
import { SessionGuard } from '../mongo/session.guard';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Chunk, ChunkDocument } from '../mongo/schemas/chunk.schema';

import { CancelService } from './cancel.service';
import { RequestCancelledException } from './exceptions/cancelled.exception';

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private chatService: ChatService,
  /*   private conversationService: ConversationService, */
    private cancelService: CancelService,
    @InjectModel(Chunk.name) private chunkModel: Model<ChunkDocument>,
  ) {}

   @UseGuards(SessionGuard) 
  @Post()
  async chat(@Body() body: ChatRequest, @Req() req: any): Promise<any> {
    this.logger.log(`Nouvelle requête reçue: ${body.question}`);
    return await this.chatService.chat(body.question, req.user.sessionId, req.user.userId);
  } 

  // Historique des messages de la session courante (utilisateur connecté)
  @UseGuards(SessionGuard)
  @Get('history')
  async getSessionHistory(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const sessionId = req?.user?.sessionId;
    const userId = req?.user?.userId;
    const currentPage = page ? Math.max(1, Number(page)) : 1;
    const currentPageSize = pageSize ? Math.max(1, Number(pageSize)) : 5;

    return this.chatService.getSessionHistory(
      sessionId,
      userId,
      currentPage,
      currentPageSize,
    );
  }

  // Liste des conversations actives de l'utilisateur connecté
  @UseGuards(SessionGuard)
  @Get('conversations')
  async getUserConversations(@Req() req: any) {
    const userId = req?.user?.userId;
    const conversations = await this.chatService.listUserConversations(userId);
    return {
      userId,
      count: conversations.length,
      conversations,
    };
  }

  // Annuler la requête en cours pour cette session
  @UseGuards(SessionGuard)
  @Post('cancel')
  async cancelRequest(@Req() req: any) {
    const sessionId = req?.user?.sessionId;
    const cancelled = this.cancelService.cancelRequest(sessionId);
    
    this.logger.log(`Tentative d'annulation pour la session: ${sessionId}, succès: ${cancelled}`);
    
    return {
      sessionId,
      cancelled,
      message: cancelled ? 'Requête annulée avec succès' : 'Aucune requête en cours à annuler'
    };
  }

  // Effacer l'historique de conversation de la session courante
  @UseGuards(SessionGuard)
  @Delete('clear')
  async clearCurrentSession(@Req() req: any) {
    const sessionId = req?.user?.sessionId;
    const userId = req?.user?.userId;
    const result = await this.chatService.clearConversation(sessionId, userId);
    this.logger.log(`Conversation effacée pour la session: ${sessionId}, succès: ${result.cleared}`);
    return {
      sessionId,
      cleared: result.cleared,
      message: result.cleared ? 'Conversation effacée avec succès' : 'Aucune conversation active trouvée',
    };
  }

 
}
