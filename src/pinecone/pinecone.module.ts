import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PineconeService } from './pinecone.service';
import { EmbeddingModule } from '../embedding/embedding.module';

@Module({
  imports: [ConfigModule, EmbeddingModule],
  providers: [PineconeService],
  exports: [PineconeService],
})
export class PineconeModule {}


