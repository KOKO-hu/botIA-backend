import { Controller, Post, Body, Get, Logger, UseGuards, Req, Query, Delete } from '@nestjs/common';
import { ChatService, ChatRequest, ChatResponse } from './chat.service';
import { SessionGuard } from '../mongo/session.guard';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Chunk, ChunkDocument } from '../mongo/schemas/chunk.schema';
import { ConversationService } from '../mongo/conversation.service';
import { CancelService } from './cancel.service';
import { RequestCancelledException } from './exceptions/cancelled.exception';

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private chatService: ChatService,
    private conversationService: ConversationService,
    private cancelService: CancelService,
    @InjectModel(Chunk.name) private chunkModel: Model<ChunkDocument>,
  ) {}

  @UseGuards(SessionGuard)
  @Post()
  async chat(@Body() body: ChatRequest, @Req() req: any): Promise<ChatResponse> {
    this.logger.log(`Nouvelle requête reçue: ${body.question}`);
    
    try {
      // Forcer l'usage du user/session issus du token
      const sessionIdFromJwt = req?.user?.sessionId;
      const userIdFromJwt = req?.user?.userId;
      
      // Créer un AbortController pour cette session
      const abortController = this.cancelService.createAbortController(sessionIdFromJwt);
      
      const response = await this.chatService.processMessage({
        ...body,
        sessionId: sessionIdFromJwt || body.sessionId,
        userId: userIdFromJwt || body['userId'],
      }, abortController.signal);
      
      // Nettoyer l'AbortController après traitement
      this.cancelService.cleanup(sessionIdFromJwt);
      
      this.logger.log(`Réponse générée pour la session: ${response.sessionId}`);
      return response;
    } catch (error) {
      // Nettoyer l'AbortController en cas d'erreur
      const sessionIdFromJwt = req?.user?.sessionId;
      if (sessionIdFromJwt) {
        this.cancelService.cleanup(sessionIdFromJwt);
      }
      
      // Gestion spéciale pour les annulations
      if (error instanceof RequestCancelledException) {
        this.logger.log(`Requête annulée pour la session: ${sessionIdFromJwt}`);
        throw error; // Re-throw l'exception proprement formatée
      }
      
      // Autres erreurs
      this.logger.error('Erreur dans le contrôleur chat:', error);
      throw error;
    }
  }

  // Historique des messages de la session courante (utilisateur connecté)
  @UseGuards(SessionGuard)
  @Get('history')
  async getSessionHistory(
    @Req() req: any,
    @Query('page') page?: string,
  ) {
    const sessionId = req?.user?.sessionId;
    const currentPage = page ? Math.max(1, Number(page)) : 1;
    const pageSize = 5;
    const result = await this.conversationService.getConversationHistoryPaginated(sessionId, currentPage, pageSize);
    return {
      sessionId,
      page: result.page,
      pageSize: result.pageSize,
      totalMessages: result.totalMessages,
      totalPages: result.totalPages,
      hasNext: result.hasNext,
      hasPrev: result.hasPrev,
      count: result.messages.length,
      messages: result.messages,
    };
  }

  // Liste des conversations actives de l'utilisateur connecté
  @UseGuards(SessionGuard)
  @Get('conversations')
  async getUserConversations(@Req() req: any) {
    const userId = req?.user?.userId;
    const conversations = await this.conversationService.getActiveConversations(userId);
    return { userId, count: conversations.length, conversations };
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
    await this.conversationService.clearConversation(sessionId);
    this.logger.log(`Conversation effacée pour la session: ${sessionId}`);
    return { sessionId, message: 'Conversation effacée avec succès' };
  }


}
