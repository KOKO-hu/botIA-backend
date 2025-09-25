import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ConversationDocument = Conversation & Document;

@Schema({ collection: 'conversations' })
export class Conversation {
  // Référence à la session (ObjectId de Session)
  @Prop({ required: true, type: Types.ObjectId, ref: 'Session', index: true })
  sessionId: Types.ObjectId;

  // Référence à l'utilisateur (ObjectId de User)
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId: Types.ObjectId;

  @Prop({ type: [Object], required: true })
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    metadata?: {
      relevantDocuments?: any[];
      embeddingVector?: number[];
      sources?: string[];
    };
  }>;

  @Prop({ required: true })
  createdAt: Date;

  @Prop({ required: true })
  updatedAt: Date;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  summary?: string; // Résumé de la conversation pour LangChain

  @Prop()
  context?: string; // Contexte extrait pour les recherches

  @Prop({ default: 0 })
  messageCount: number; // Compteur de messages pour optimiser les requêtes
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
