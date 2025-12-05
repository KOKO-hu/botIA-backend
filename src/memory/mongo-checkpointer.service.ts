import { Injectable } from "@nestjs/common";
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Conversation } from "src/mongo/schemas/conversation.schema";
import {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointListOptions,
  CheckpointTuple,
  PendingWrite,
  CheckpointMetadata,
  CheckpointPendingWrite,
} from "@langchain/langgraph-checkpoint";

type RunnableConfig = {
  configurable?: Record<string, any>;
  [key: string]: any;
};

@Injectable()
export class MongoCheckpointer extends BaseCheckpointSaver {

  // ✔ FIX OBLIGATOIRE pour LangGraph
  configurable = {};

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<Conversation>,
  ) {
    super();
  }

  private normalizeConfig(config: RunnableConfig | undefined, threadId: string): RunnableConfig {
    if (!config?.configurable) {
      return {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: "",
        },
      };
    }

    return {
      ...config,
      configurable: {
        checkpoint_ns: "",
        ...config.configurable,
        thread_id:
          config.configurable.thread_id ??
          config.configurable.threadId ??
          threadId,
      },
    };
  }

  private extractThreadId(input: any): string | null {
    if (!input) return null;
    if (typeof input === "string") return input;
    const configurable =
      input.configurable ??
      input?.config?.configurable ??
      input?.metadata ??
      input?.context;
    if (configurable?.thread_id) return configurable.thread_id;
    if (configurable?.threadId) return configurable.threadId;
    if (configurable?.thread) return configurable.thread;
    return null;
  }

  private buildTupleFromConversation(
    conv: Conversation,
    threadId: string,
    fallbackConfig: RunnableConfig,
  ): CheckpointTuple | undefined {
    if (!conv?.checkpoint || !conv?.checkpointMetadata) {
      return undefined;
    }

    const metadata =
      (conv.checkpointMetadata as CheckpointMetadata) ?? {
        source: "input",
        step: -2,
        parents: {},
      };

    return {
      config: this.normalizeConfig(
        (conv.checkpointConfig as RunnableConfig) ?? fallbackConfig,
        threadId,
      ),
      checkpoint: conv.checkpoint as Checkpoint,
      metadata,
      parentConfig: conv.checkpointParentConfig as RunnableConfig | undefined,
      pendingWrites:
        (conv.checkpointPendingWrites as CheckpointPendingWrite[]) ?? [],
    };
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = this.extractThreadId(config);
    if (!threadId) return undefined;

    const conv = await this.conversationModel.findById(threadId).lean();
    if (!conv) return undefined;

    return this.buildTupleFromConversation(conv, threadId, this.normalizeConfig(config, threadId));
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const tuple = await this.getTuple(config);
    if (!tuple) return;

    if (options?.filter) {
      const metadata = tuple.metadata ?? {};
      const shouldInclude = Object.entries(options.filter).every(
        ([key, value]) => metadata?.[key] === value,
      );
      if (!shouldInclude) return;
    }

    if (options?.before?.configurable?.checkpoint_id) {
      if (
        tuple.config.configurable?.checkpoint_id &&
        tuple.config.configurable.checkpoint_id >=
          options.before.configurable.checkpoint_id
      ) {
        return;
      }
    }

    if (options?.limit !== undefined && options.limit <= 0) {
      return;
    }

    yield tuple;
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const threadId = this.extractThreadId(config);
    if (!threadId) {
      throw new Error(
        'Failed to persist checkpoint: missing "thread_id" inside config.configurable.',
      );
    }

    // Extraire et convertir les messages du checkpoint vers le format du schéma
    const checkpointMessages = (checkpoint as any)?.channel_values?.messages ?? [];
    const formattedMessages = this.formatMessagesForSchema(checkpointMessages);

    await this.conversationModel.findByIdAndUpdate(
      threadId,
      {
        checkpoint,
        checkpointMetadata: metadata,
        checkpointConfig: this.normalizeConfig(config, threadId),
        checkpointParentConfig: config.configurable?.checkpoint_id
          ? {
              configurable: {
                thread_id: threadId,
                checkpoint_ns: config.configurable.checkpoint_ns ?? "",
                checkpoint_id: config.configurable.checkpoint_id,
              },
            }
          : null,
        checkpointPendingWrites: [],
        messages: formattedMessages,
        messageCount: formattedMessages.length,
        updatedAt: new Date(),
      },
      { new: false },
    );

    return this.normalizeConfig(config, threadId);
  }

  /**
   * Convertit les messages LangGraph vers le format du schéma Conversation
   */
  private formatMessagesForSchema(checkpointMessages: any[]): Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    metadata?: {
      relevantDocuments?: any[];
      embeddingVector?: number[];
      sources?: any[];
      quiz?: any[];
    };
  }> {
    const formatted: Array<{
      role: 'user' | 'assistant';
      content: string;
      timestamp: Date;
      metadata?: {
        relevantDocuments?: any[];
        embeddingVector?: number[];
        sources?: any[];
        quiz?: any[];
      };
    }> = [];

    // Parcourir les messages et associer les sources/quiz des ToolMessages aux messages AI
    for (let i = 0; i < checkpointMessages.length; i++) {
      const msg = checkpointMessages[i];
      
      // Si c'est un message tool, on l'ignore mais on extraira ses données pour le prochain message AI
      if (msg.type === 'tool' || msg.role === 'tool') {
        continue;
      }

      // Déterminer le role
      let role: 'user' | 'assistant' = 'user';
      if (msg.type === 'ai' || msg.type === 'assistant' || msg.role === 'assistant') {
        role = 'assistant';
      } else if (msg.type === 'human' || msg.type === 'user' || msg.role === 'user') {
        role = 'user';
      } else {
        continue; // Ignorer les autres types
      }

      // Extraire le contenu
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Extraire le texte des chunks
        content = msg.content
          .map((chunk: any) => {
            if (typeof chunk === 'string') return chunk;
            if (chunk?.type === 'text') return chunk.text;
            if (chunk?.text) return chunk.text;
            return '';
          })
          .filter(Boolean)
          .join('\n');
      } else if (msg.content?.text) {
        content = msg.content.text;
      }

      // Extraire les sources et quiz depuis les ToolMessages précédents (pour les messages assistant)
      let metadata: {
        relevantDocuments?: any[];
        embeddingVector?: number[];
        sources?: any[];
        quiz?: any[];
      } | undefined = undefined;

      if (role === 'assistant') {
        const sources = this.extractSourcesFromPreviousToolMessages(checkpointMessages, i);
        const quiz = this.extractQuizFromPreviousToolMessages(checkpointMessages, i);
        
        if (sources && sources.length > 0) {
          metadata = { ...metadata, sources };
        }
        if (quiz && quiz.length > 0) {
          metadata = { ...metadata, quiz };
        }
      }

      // Sauvegarder le message même s'il n'a pas de contenu textuel mais a des métadonnées (quiz/sources)
      // Pour les messages user, on exige toujours un contenu
      if (role === 'user' && (!content || content.trim().length === 0)) {
        continue;
      }

      // Pour les messages assistant, on sauvegarde s'il y a du contenu OU des métadonnées
      if (role === 'assistant' && !content && (!metadata || (!metadata.quiz && !metadata.sources))) {
        continue;
      }

      // Utiliser un contenu par défaut si vide mais qu'on a des métadonnées
      const finalContent = content.trim() || (metadata?.quiz ? 'Quiz généré' : 'Réponse générée');

      formatted.push({
        role,
        content: finalContent,
        timestamp: new Date(),
        metadata: metadata,
      });
    }

    return formatted;
  }

  /**
   * Extrait les sources depuis les ToolMessages précédents un message AI
   */
  private extractSourcesFromPreviousToolMessages(
    messages: any[],
    currentIndex: number,
  ): any[] | undefined {
    // Chercher uniquement le message tool immédiatement précédent
    if (currentIndex === 0) return undefined;
    
    const msg = messages[currentIndex - 1];
    
    // Si on trouve un message tool avec search_benin_law
    if (
      (msg.type === 'tool' || msg.role === 'tool' || msg.name === 'search_benin_law') &&
      msg.content
    ) {
      try {
        let toolContent: any;
        
        // Parser le contenu du tool
        if (typeof msg.content === 'string') {
          try {
            toolContent = JSON.parse(msg.content);
          } catch {
            toolContent = msg.content;
          }
        } else {
          toolContent = msg.content;
        }

        // Extraire les sources
        if (toolContent?.sources && Array.isArray(toolContent.sources)) {
          return toolContent.sources;
        } else if (toolContent?.type === 'search_result' && toolContent?.sources) {
          return toolContent.sources;
        }
      } catch (e) {
        // Ignorer les erreurs de parsing
      }
    }

    return undefined;
  }

  /**
   * Extrait les questions du quiz depuis les ToolMessages précédents un message AI
   */
  private extractQuizFromPreviousToolMessages(
    messages: any[],
    currentIndex: number,
  ): any[] | undefined {
    // Chercher uniquement le message tool immédiatement précédent
    if (currentIndex === 0) return undefined;
    
    const msg = messages[currentIndex - 1];
    
    // Si on trouve un message tool avec create_legal_quiz_pro
    if (
      (msg.type === 'tool' || msg.role === 'tool' || msg.name === 'create_legal_quiz_pro') &&
      msg.content
    ) {
      try {
        let toolContent: any;
        
        // Parser le contenu du tool
        if (typeof msg.content === 'string') {
          try {
            toolContent = JSON.parse(msg.content);
          } catch {
            toolContent = msg.content;
          }
        } else {
          toolContent = msg.content;
        }

        // Le tool retourne directement un tableau de questions (QuizQuestion[])
        if (Array.isArray(toolContent)) {
          // Si c'est directement un tableau de questions
          return toolContent;
        } else if (toolContent?.questions && Array.isArray(toolContent.questions)) {
          // Si c'est un objet avec un champ questions
          return toolContent.questions;
        } else if (toolContent && typeof toolContent === 'object') {
          // Si c'est un objet unique, le traiter comme une question
          return [toolContent];
        }
      } catch (e) {
        // Ignorer les erreurs de parsing
      }
    }

    return undefined;
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    if (!writes.length) return;

    const threadId = this.extractThreadId(config);
    const checkpointId = config.configurable?.checkpoint_id;
    if (!threadId || !checkpointId) return;

    const serializedWrites: CheckpointPendingWrite[] = writes.map(
      ([channel, value]) => [
      taskId,
      channel,
      value,
      ],
    );

    await this.conversationModel.findByIdAndUpdate(threadId, {
      $push: {
        checkpointPendingWrites: {
          $each: serializedWrites,
        },
      },
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.conversationModel.findByIdAndUpdate(threadId, {
      checkpoint: null,
      checkpointMetadata: null,
      checkpointConfig: null,
      checkpointParentConfig: null,
      checkpointPendingWrites: [],
    });
  }

  async clearConversationData(threadId: string): Promise<void> {
    await this.conversationModel.findByIdAndUpdate(
      threadId,
      {
        messages: [],
        summary: "",
        context: "",
        messageCount: 0,
        updatedAt: new Date(),
      },
      { new: false },
    );
    await this.deleteThread(threadId);
  }

  async getSessionHistory(
    sessionId: string,
    userId: string,
    page: number,
    pageSize: number,
  ) {
    const conversation = await this.conversationModel
      .findOne({ sessionId, userId })
      .lean();

    if (!conversation) {
      return {
        sessionId,
        userId,
        page,
        pageSize,
        totalMessages: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
        messages: [],
      };
    }

    // Utiliser directement les messages formatés depuis conversation.messages
    const formattedMessages = conversation.messages ?? [];

    // Transformer les messages du schéma vers le format attendu
    const normalizedMessages = formattedMessages
      .map((msg: any, index: number) => {
        if (!msg || !msg.role || !msg.content) {
          return null;
        }

        return {
          id: msg.id || `msg_${index}`,
          type: msg.role === 'user' ? 'human' : 'ai',
          role: msg.role,
          name: null,
          content: msg.content,
          additional_kwargs: {},
          response_metadata: {},
          tool_calls: [],
          invalid_tool_calls: [],
          usage_metadata: {},
          timestamp: msg.timestamp,
          metadata: msg.metadata || null,
        };
      })
      .filter((msg: any) => msg !== null);

    const totalMessages = normalizedMessages.length;
    const totalPages =
      totalMessages === 0 ? 0 : Math.ceil(totalMessages / pageSize);
    const safePage = Math.min(Math.max(page, 1), Math.max(totalPages, 1));
    const startIndex = (safePage - 1) * pageSize;
    const messages = normalizedMessages.slice(
      startIndex,
      startIndex + pageSize,
    );

    return {
      sessionId,
      userId,
      conversationId: conversation._id.toString(),
      page: safePage,
      pageSize,
      totalMessages,
      totalPages,
      hasPrev: safePage > 1,
      hasNext: totalPages > 0 && safePage < totalPages,
      messages,
    };
  }

  async listUserConversations(userId: string) {
    const conversations = await this.conversationModel
      .find({ userId })
      .sort({ updatedAt: -1 })
      .lean();

    return conversations.map((conversation) => ({
      conversationId: conversation._id.toString(),
      sessionId: conversation.sessionId?.toString(),
      userId: conversation.userId?.toString(),
      isActive: conversation.isActive,
      messageCount:
        conversation.messageCount ?? conversation.messages?.length ?? 0,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      summary: conversation.summary ?? "",
      context: conversation.context ?? "",
    }));
  }

  async findActiveConversation(sessionId: string, userId: string) {
    return await this.conversationModel.findOne({ sessionId, userId, isActive: true });
  }

  async init(sessionId: string, userId: string): Promise<string> {
    const conv = await this.conversationModel.create({
      sessionId,
      userId,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
      messageCount: 0
    });

    return conv._id.toString();
  }
}

