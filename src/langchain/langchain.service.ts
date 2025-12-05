import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatAnthropic } from '@langchain/anthropic';
import { createAgent, createMiddleware, providerStrategy, toolStrategy, trimMessages } from 'langchain';
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
  public structuredQuizModel: any;
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
          startOn: 'human',
          endOn: ['human', 'tool'],
          tokenCounter: (msgs) => msgs.length,
        });
        console.log('trimmedMessages', trimmedMessages);
        return {
          ...state, // 👈 IMPORTANT : garder configurable, metadata, tags, etc.
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
    });

    const searchLawTool = searchBeninLaw(this.pineconeService);
    const createLegalQuizTool = createLegalQuizPro(
      this.pineconeService,
      this.model as unknown as QuizLLM,
    );

    const SearchResponseSchema = z.object({
      type: z.literal("search_result"),
      response: z.string().describe("La réponse textuelle à la question juridique."),
    });

    const QuizResponseSchema = z.object({
      type: z.literal("quiz_result"),
      response_quiz: z.object({ 
        questions: z.array(z.object({
          // ... détails de vos questions ...
          question: z.string(),
          options: z.array(z.string()),
          correctAnswerIndex: z.number(),
          explanation: z.string(),
        })),
      }),
    });
    /* schema for the final agent */
const FinalAgentSchema = z.object({
  action: z.enum(["search", "quiz"]),
  data: z.union([SearchResponseSchema, QuizResponseSchema])
});
    // Création de l'agent
this.agent = createAgent({
  model: this.model,
  tools: [searchLawTool, createLegalQuizTool],
  systemPrompt: `
You are a legal assistant specialized in Beninese law.

RULES (CRITICAL):
1. "quiz" / "questionnaire" → ONLY 'create_legal_quiz_pro' tool
2. Questions juridiques générales → ONLY 'search_benin_law' tool  
3. NEVER use both tools together
4. Choose EXACTLY ONE tool per request

IMPORTANT - When using 'search_benin_law' tool:
- The tool will return sources with URLs in the 'sources' field (check the tool response)
- You MUST include ALL source URLs in your final response to the user
- Format URLs as clickable markdown links: [Loi n°XXXX - Titre](URL)
- Include URLs in a "Sources" section at the end of your response
- Each source should be formatted as: - [Loi n°{numero_loi} - {titre}]({url})
- Example format:
  **Sources :**
  - [Loi n°2017-05 - Code du travail](https://videoshotai.s3.eu-north-1.amazonaws.com/lois_benin/pdfs/loi-2017-05.pdf)
- NEVER omit the URLs - they are essential for users to access the legal documents
  `,
  checkpointer: this.mongoCheckpointer as any,
  middleware: [trimMessageHistory],
 /*  responseFormat: toolStrategy(FinalAgentSchema) */
  // PAS de responseFormat ici - les tools gèrent leur propre format
});
  }

  public getAgent() {
    return this.agent;
  }
} 
