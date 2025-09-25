import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Chunk, ChunkSchema } from './schemas/chunk.schema';
import { Conversation, ConversationSchema } from './schemas/conversation.schema';
import { User, UserSchema } from './schemas/user.schema';
import { Session, SessionSchema } from './schemas/session.schema';
import { ConversationService } from './conversation.service';
import { SessionGuard } from './session.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Chunk.name, schema: ChunkSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [ConversationService, AuthService, SessionGuard],
  exports: [ConversationService, AuthService, SessionGuard, MongooseModule],
})
export class MongoModule {}


