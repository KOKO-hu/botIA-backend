import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChatModule } from './chat/chat.module';
import { MongooseModule } from '@nestjs/mongoose';
import { MongoModule } from './mongo/mongo.module';
import { LangchainService } from './langchain/langchain.service';
import { PineconeService } from './pinecone/pinecone.service';
import { MongoCheckpointer } from './memory/mongo-checkpointer.service';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
        dbName: config.get<string>('MONGODB_DB'),
      }),
    }),
    ChatModule,
    MongoModule,

  ],
  controllers: [AppController],
  providers: [AppService, LangchainService, PineconeService, MongoCheckpointer],
})
export class AppModule {}
