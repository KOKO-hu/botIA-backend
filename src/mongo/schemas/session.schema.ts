import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SessionDocument = Session & Document;

@Schema({ collection: 'sessions', timestamps: true })
export class Session {
  // _id as session id (ObjectId)
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  expiresAt?: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);


