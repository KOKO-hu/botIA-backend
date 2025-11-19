import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { CancelService } from './cancel.service';
import { MongoModule } from '../mongo/mongo.module';
import { PineconeService } from 'src/pinecone/pinecone.service';
import { LangchainService } from 'src/langchain/langchain.service';
import { MongoCheckpointer } from 'src/memory/mongo-checkpointer.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Conversation, ConversationSchema } from 'src/mongo/schemas/conversation.schema';
@Module({
  imports: [MongoModule, MongooseModule.forFeature([{ name: Conversation.name, schema: ConversationSchema }])],
  controllers: [ChatController],
  providers: [ChatService, CancelService, PineconeService, LangchainService, MongoCheckpointer],
  exports: [ChatService, CancelService, PineconeService],
})
export class ChatModule {}
