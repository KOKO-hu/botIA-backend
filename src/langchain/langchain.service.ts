import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatMistralAI } from '@langchain/mistralai';
import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RequestCancelledException } from '../chat/exceptions/cancelled.exception';

@Injectable()
export class LangChainService {
  private readonly logger = new Logger(LangChainService.name);
  private llm: ChatMistralAI | ChatOpenAI;
  private chain: any; // Pipeline Runnables
  private isMistral: boolean = false;

  constructor(private configService: ConfigService) {
    const mistralApiKey = this.configService.get<string>('MISTRAL_API_KEY');
    const openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');
    
    // Priorité à Mistral, fallback vers OpenAI
    if (mistralApiKey) {
      this.initializeMistral(mistralApiKey);
    } else if (openaiApiKey) {
      this.initializeOpenAI(openaiApiKey);
    } else {
      this.logger.warn('Aucune clé API configurée (Mistral ou OpenAI), LangChain ne fonctionnera pas');
      return;
    }
  }

  private initializeMistral(apiKey: string): void {
    const model = this.configService.get<string>('MISTRAL_MODEL') || 'mistral-large-latest';
    
    this.llm = new ChatMistralAI({
      apiKey: apiKey,
      model: model,
      temperature: 0.3,
    });

    this.isMistral = true;
    this.logger.log(`LangChainService initialisé avec Mistral (${model})`);
    
    // Initialiser la mémoire et la chaîne après avoir configuré le LLM
    this.initializeMemoryAndChain();
  }

  private initializeOpenAI(apiKey: string): void {
    this.llm = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: 'gpt-3.5-turbo',
      temperature: 0.3,
    });

    this.isMistral = false;
    this.logger.log('LangChainService initialisé avec OpenAI GPT-3.5-turbo (fallback)');
    
    // Initialiser la mémoire et la chaîne après avoir configuré le LLM
    this.initializeMemoryAndChain();
  }

  private initializeMemoryAndChain(): void {
    // Template de prompt optimisé pour Mistral (nouveau pipeline Runnables)
    const promptTemplate = ChatPromptTemplate.fromTemplate(`
Tu es un assistant juridique spécialisé dans les lois béninoises. Tu réponds aux questions en te basant sur les documents fournis et l'historique de la conversation.

Documents pertinents:
{documents}

Historique de la conversation:
{history}

Question de l'utilisateur: {question}

Instructions:
- Réponds UNIQUEMENT à partir des Documents pertinents ci-dessus.
- N'invente rien. Si l'information n'est pas présente dans les documents, réponds: "Je n'ai pas assez d'informations dans les documents fournis."
- Reste strictement dans le domaine juridique béninois.
- Parle comme un juriste en conversation : style naturel, accessible, sans formater comme un document académique.
- Évite les listes à puces, les "Source :", les citations formelles.
- Sois direct et conversationnel tout en restant précis.

Réponse:
`);

    // Création du pipeline Runnables (remplace LLMChain)
    this.chain = promptTemplate.pipe(this.llm).pipe(new StringOutputParser());

    this.logger.log(`LangChainService configuré avec ${this.isMistral ? 'Mistral' : 'OpenAI'} (mémoire MongoDB uniquement)`);
  }

  async generateResponse(question: string, documents: string[], sessionId?: string, historyOverride?: string, abortSignal?: AbortSignal): Promise<string> {
    if (!this.chain) {
      throw new Error("LangChain non initialisé");
    }

    try {
      // Construire le contexte à partir des documents
      const context = documents.join("\n\n");
      
      // Utiliser uniquement l'historique MongoDB (via historyOverride)
      const history = historyOverride || "";

      // Vérifier l'annulation avant l'appel LLM
      if (abortSignal?.aborted) {
        throw new RequestCancelledException(sessionId || 'unknown');
      }

      // Appeler le pipeline Runnables avec signal d'annulation
      const response = await this.chain.invoke({
        question,
        documents: context,
        history
      }, {
        signal: abortSignal
      });

      if (!response) {
        this.logger.warn("Aucune réponse textuelle trouvée dans le résultat LLM");
        return "Je n'ai pas pu générer de réponse appropriée.";
      }

      // Note: La sauvegarde se fait maintenant uniquement dans MongoDB via ChatService
      this.logger.log(`Réponse LLM générée (${response.length} caractères) - Mémoire MongoDB uniquement`);
      return response;

    } catch (error) {
      this.logger.error("Erreur lors de la génération de réponse LLM:", error);
      throw new Error("Erreur lors de la génération de la réponse");
    }
  }

  isInitialized(): boolean {
    return !!this.chain && !!this.llm;
  }

}
