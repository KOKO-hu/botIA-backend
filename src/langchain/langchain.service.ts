import { Injectable } from '@nestjs/common';
import { OpenAI } from '@langchain/openai'; // Importez le modèle spécifique
import { ConfigService } from '@nestjs/config';
import { ChatAnthropic } from '@langchain/anthropic';
import { createAgent, createMiddleware, trimMessages } from 'langchain';
import { PineconeService } from 'src/pinecone/pinecone.service';
import { searchBeninLaw } from 'src/tools/chat.tools';
import { createLegalQuizPro, QuizLLM } from 'src/tools/quiz.tools';
import { MongoCheckpointer } from 'src/memory/mongo-checkpointer.service';
import { z } from 'zod';

export interface MongoCheckpointerInterface {
  get(threadId: string): Promise<{
    messages: any[];
    summary: string;
    context: string;
    messageCount: number;
  } | null>;
  put(threadId: string, state: any): Promise<void>;
}

@Injectable()
export class LangchainService {
  private readonly model: ChatAnthropic;
  private readonly agent: any;

  constructor(
    private readonly configService: ConfigService,
    private readonly pineconeService: PineconeService,
    private readonly mongoCheckpointer: MongoCheckpointer,
  ) {
    
    // Initialisez le modèle en utilisant la clé API du fichier .env
    const trimMessageHistory = createMiddleware({
      name: 'TrimMessages',
      beforeModel: async (state) => {
        console.log('state', state);
        const trimmedMessages = await trimMessages(state.messages, {
          maxTokens: 3000,
          strategy: 'last',
          startOn: "human",
          endOn: ["human", "tool"],
          tokenCounter: (msgs) => msgs.length,
        });
    console.log('trimmedMessages', trimmedMessages);
        return {
          ...state,           // 👈 IMPORTANT : garder configurable, metadata, tags, etc.
          messages: trimmedMessages,
        };
      },
    });
    const anthropicModel =
      this.configService.get<string>('ANTHROPIC_MODEL') ??
      'claude-3-sonnet-20240229';

    this.model = new ChatAnthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
      model: anthropicModel,
      temperature: 0.5,
      maxTokens: 1000,
    }).withStructuredOutput(z.object({
      response: z.string().describe('Réponse de l\'IA'),
      response_quiz: z.object({
        questions: z.array(z.object({
          question: z.string().describe('Question'),
          options: z.array(z.string()).describe('Options de réponse'),
          correctAnswerIndex: z.number().describe('Index de la bonne réponse'),
          explanation: z.string().describe('Explication'),
        })).describe('Questions'),
      }).describe('Réponse de l\'IA pour un quiz'),
    }));
    const searchLawTool = searchBeninLaw(this.pineconeService);
    const createLegalQuizTool = createLegalQuizPro(
      this.pineconeService,
      this.model as unknown as QuizLLM,
    );
    
    // Création de l’agent
    this.agent = createAgent({
      model: this.model,
      tools: [searchLawTool, createLegalQuizTool], // Ajoute tes tools plus tard
      systemPrompt: `
  You are a legal assistant specialized in Beninese law.

Rules:
1. If the user asks for a "quiz" or "questionnaire", use ONLY the tool 'create_legal_quiz_pro'.
2. If the user asks a general legal question, use ONLY the tool 'search_benin_law'.
3. NEVER combine tools for a single request.
4. Always follow the user's request type strictly.
    `,
     checkpointer: this.mongoCheckpointer as any, 
      middleware: [trimMessageHistory],
    });
  }

  public getAgent() {
    return this.agent;
  }
}
