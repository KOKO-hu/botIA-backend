import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MistralAIEmbeddings } from '@langchain/mistralai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private initialized = false;
  private client: MistralAIEmbeddings | null = null;

  constructor(private readonly config: ConfigService) {
    this.initialize().catch((e) => {
      this.logger.error('Erreur init embeddings:', e);
    });
  }

  private async initialize(): Promise<void> {
    const apiKey = this.config.get<string>('MISTRAL_API_KEY');
    const model = this.config.get<string>('MISTRAL_EMBEDDING_MODEL') || 'mistral-embed';
    if (!apiKey) {
      this.logger.error('MISTRAL_API_KEY manquant');
      this.initialized = false;
      return;
    }
    this.client = new MistralAIEmbeddings({ apiKey, model });
    this.initialized = true;
    this.logger.log(`Embeddings Mistral initialisés (${model})`);
  }

  isInitialized(): boolean {
    return this.initialized && !!this.client;
  }

  async embedQuery(text: string): Promise<number[]> {
    if (!this.isInitialized() || !this.client) throw new Error('EmbeddingService non initialisé');
    const v = await this.client.embedQuery(text);
    return v as unknown as number[];
  }

  async embedDocuments(docs: string[]): Promise<number[][]> {
    if (!this.isInitialized() || !this.client) throw new Error('EmbeddingService non initialisé');
    const vs = await this.client.embedDocuments(docs);
    return vs as unknown as number[][];
  }
}


