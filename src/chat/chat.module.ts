import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { CancelService } from './cancel.service';
import { LangChainModule } from '../langchain/langchain.module';
import { MongoModule } from '../mongo/mongo.module';
import { PineconeModule } from '../pinecone/pinecone.module';


@Module({
  imports: [MongoModule, LangChainModule, PineconeModule],
  controllers: [ChatController],
  providers: [ChatService, CancelService],
  exports: [ChatService, CancelService],
})
export class ChatModule {}
