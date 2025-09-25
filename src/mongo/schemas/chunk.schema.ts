import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ChunkDocument = HydratedDocument<Chunk>;

@Schema({ collection: 'chunks', timestamps: false })
export class Chunk {
  @Prop({ type: String, alias: '_id' })
  id?: string;

  @Prop({ type: String })
  numero_loi?: string;

  @Prop({ type: Number })
  numero_chunk?: number;

  @Prop({ type: String })
  contenu?: string;

  @Prop({ type: String })
  date_ajout?: string;

  @Prop({ type: String })
  date_loi?: string;

  @Prop({ type: Number })
  debut_chunk?: number;

  @Prop({ type: [Number], index: false })
  embedding?: number[]; // 384 dims expected

  @Prop({ type: Number })
  fin_chunk?: number;

  @Prop({ type: Number })
  longueur_chars?: number;

  @Prop({ type: Number })
  longueur_tokens_estime?: number;

  @Prop({ type: String, default: null })
  qdrant_point_id?: string | null;

  @Prop({ type: String })
  titre?: string;

  @Prop({ type: Number })
  total_chunks?: number;

  @Prop({ type: String })
  type_contenu?: string;

  @Prop({ type: String })
  url?: string;
}

export const ChunkSchema = SchemaFactory.createForClass(Chunk);

