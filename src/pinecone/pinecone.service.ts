import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pinecone as PineconeClient } from '@pinecone-database/pinecone';
import { PineconeStore } from '@langchain/pinecone';
import { Embeddings } from '@langchain/core/embeddings';
import { EmbeddingService } from '../embedding/embedding.service';

@Injectable()
export class PineconeService {
  private readonly logger = new Logger(PineconeService.name);
  private store: PineconeStore | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  private async getEmbeddings(): Promise<Embeddings> {
    // Adapter notre EmbeddingService au type Embeddings de LangChain
    return {
      embedQuery: async (text: string) => await this.embeddingService.embedQuery(text),
      embedDocuments: async (docs: string[]) => await this.embeddingService.embedDocuments(docs),
    } as unknown as Embeddings;
  }

  async getStore(): Promise<PineconeStore> {
    if (this.store) return this.store;

    const apiKey = this.config.get<string>('PINECONE_API_KEY');
    const indexName = this.config.get<string>('PINECONE_INDEX');
    if (!apiKey || !indexName) {
      throw new Error('PINECONE_API_KEY ou PINECONE_INDEX manquant');
    }

    const client = new PineconeClient({ apiKey });
    const pineconeIndex = client.Index(indexName);
    const embeddings = await this.getEmbeddings();

    this.store = await PineconeStore.fromExistingIndex(embeddings, {
      pineconeIndex,
      maxConcurrency: 5,
    });

    this.logger.log(`Pinecone connecté sur l'index: ${indexName}`);
    return this.store;
  }
}


