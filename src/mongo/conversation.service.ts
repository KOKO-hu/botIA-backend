import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectModel(Conversation.name) 
    private conversationModel: Model<ConversationDocument>
  ) {}

  async createConversation(sessionId: string, userId: string = 'anonymous'): Promise<Conversation> {
    const conversation = new this.conversationModel({
      sessionId,
      userId,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
      messageCount: 0,
    });

    await conversation.save();
    this.logger.log(`Conversation créée: ${sessionId} pour l'utilisateur: ${userId}`);
    return conversation;
  }

  async addMessage(
    sessionId: string, 
    role: 'user' | 'assistant', 
    content: string,
    metadata?: any
  ): Promise<void> {
    await this.conversationModel.updateOne(
      { sessionId },
      {
        $push: {
          messages: {
            role,
            content,
            timestamp: new Date(),
            metadata
          }
        },
        $inc: { messageCount: 1 },
        $set: { updatedAt: new Date() }
      }
    );
    this.logger.log(`Message ajouté à la session: ${sessionId} (${role})`);
  }

  async getConversationHistory(sessionId: string, limit?: number): Promise<any[]> {
    const conversation = await this.conversationModel.findOne({ sessionId });
    if (!conversation) {
      this.logger.warn(`Aucune conversation trouvée pour la session: ${sessionId}`);
      return [];
    }

    const messages = conversation.messages;
    return limit ? messages.slice(-limit) : messages;
  }

  async getConversationHistoryPaginated(
    sessionId: string,
    page: number = 1,
    pageSize: number = 5,
  ): Promise<{ messages: any[]; page: number; pageSize: number; totalMessages: number; totalPages: number; hasNext: boolean; hasPrev: boolean }>{
    const meta = await this.conversationModel.findOne({ sessionId }).select('messageCount');
    if (!meta) {
      this.logger.warn(`Aucune conversation trouvée pour la session: ${sessionId}`);
      return { messages: [], page, pageSize, totalMessages: 0, totalPages: 0, hasNext: false, hasPrev: false };
    }

    const totalMessages = meta.messageCount || 0;
    const totalPages = Math.ceil(totalMessages / pageSize) || 0;
    const safePage = Math.min(Math.max(page, 1), Math.max(totalPages, 1));

    // Fenêtre dans le tableau (messages stockés du plus ancien au plus récent)
    const start = Math.max(0, totalMessages - safePage * pageSize);
    const end = Math.max(0, totalMessages - (safePage - 1) * pageSize);
    const length = Math.max(0, Math.min(pageSize, end - start));

    // Récupérer uniquement la tranche demandée via $slice
    const convo = await this.conversationModel
      .findOne({ sessionId })
      .select({ messages: { $slice: [start, length] } });

    const messages = convo?.messages || [];

    return {
      messages,
      page: safePage,
      pageSize,
      totalMessages,
      totalPages,
      hasNext: safePage < totalPages,
      hasPrev: safePage > 1,
    };
  }

  async getConversationContext(sessionId: string, lastMessages: number = 4): Promise<string> {
    const messages = await this.getConversationHistory(sessionId, lastMessages);
    
    if (messages.length === 0) {
      return '';
    }

    return messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');
  }

  async updateConversationSummary(sessionId: string, summary: string): Promise<void> {
    await this.conversationModel.updateOne(
      { sessionId },
      { 
        $set: { 
          summary,
          updatedAt: new Date() 
        } 
      }
    );
    this.logger.log(`Résumé mis à jour pour la session: ${sessionId}`);
  }

  async updateConversationContext(sessionId: string, context: string): Promise<void> {
    await this.conversationModel.updateOne(
      { sessionId },
      { 
        $set: { 
          context,
          updatedAt: new Date() 
        } 
      }
    );
  }

  async clearConversation(sessionId: string): Promise<void> {
    await this.conversationModel.updateOne(
      { sessionId },
      { 
        $set: { 
          messages: [],
          summary: '',
          context: '',
          messageCount: 0,
          updatedAt: new Date() 
        } 
      }
    );
    this.logger.log(`Conversation effacée: ${sessionId}`);
  }

  async getActiveConversations(userId?: string): Promise<Conversation[]> {
    const filter: any = { isActive: true };
    if (userId) filter.userId = userId;
    
    return this.conversationModel.find(filter).sort({ updatedAt: -1 });
  }

  async getConversation(sessionId: string): Promise<Conversation | null> {
    return this.conversationModel.findOne({ sessionId });
  }

  async deactivateConversation(sessionId: string): Promise<void> {
    await this.conversationModel.updateOne(
      { sessionId },
      { 
        $set: { 
          isActive: false,
          updatedAt: new Date() 
        } 
      }
    );
    this.logger.log(`Conversation désactivée: ${sessionId}`);
  }

  async getConversationStats(sessionId: string): Promise<any> {
    const conversation = await this.getConversation(sessionId);
    if (!conversation) return null;

    return {
      sessionId: conversation.sessionId,
      userId: conversation.userId,
      messageCount: conversation.messageCount,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      isActive: conversation.isActive,
      hasSummary: !!conversation.summary,
      hasContext: !!conversation.context,
    };
  }
}
