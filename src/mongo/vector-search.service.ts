import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Chunk, ChunkDocument } from './schemas/chunk.schema';

@Injectable()
export class VectorSearchService {
  private readonly logger = new Logger(VectorSearchService.name);

  private readonly indexName: string;

  constructor(
    @InjectModel(Chunk.name) private chunkModel: Model<ChunkDocument>,
    private configService: ConfigService,
  ) {
    this.indexName = this.configService.get<string>('MONGODB_VECTOR_INDEX') || 'vector_index';
  }

  // MongoDB Atlas Vector Search using $vectorSearch
  async searchByVector(queryVector: number[], k: number = 5): Promise<Chunk[]> {
    this.logger.log(`Recherche vectorielle avec ${queryVector.length} dimensions, k=${k}`);
    this.logger.log(`Index utilisé: ${this.indexName}`);
    
    const pipeline: any[] = [
      {
        $vectorSearch: {
          index: this.indexName,
          path: 'embedding',
          queryVector,
          numCandidates: Math.max(100, k * 20),
          limit: k,
        },
      },
      {
        $project: {
          _id: 1,
          contenu: 1,
          titre: 1,
          numero_loi: 1,
          score: { $meta: 'vectorSearchScore' },
          metadata: {
            numero_chunk: '$numero_chunk',
            url: '$url',
            date_loi: '$date_loi',
          },
        },
      },
    ];

    try {
      const results = await this.chunkModel.aggregate(pipeline).exec();
      this.logger.log(`Vector search retourné ${results.length} résultats`);
      if (results.length > 0) {
        this.logger.log(`Premier résultat: ${JSON.stringify(results[0], null, 2)}`);
      }
      return results as unknown as Chunk[];
    } catch (error) {
      this.logger.error('Erreur lors de la recherche vectorielle:', error);
      throw error;
    }
  }
}


