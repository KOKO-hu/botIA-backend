import { Injectable, Logger } from '@nestjs/common';
export interface SearchResult {
  id: string;
  score: number;
  payload: {
    text: string;
    metadata?: any;
  };
}

import { LangChainService } from '../langchain/langchain.service';
import { PineconeService } from '../pinecone/pinecone.service';
import { ConversationService } from '../mongo/conversation.service';
import { RequestCancelledException } from './exceptions/cancelled.exception';

export interface ChatRequest {
  question: string;
  sessionId?: string;
  userId?: string;
}

export interface ChatResponse {
  answer: string;
  relevantDocuments: SearchResult[];
  sources: Array<{
    url: string;
    titre: string;
    numero_loi: string;
  }>;
  sessionId: string;
  timestamp: Date;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private langChainService: LangChainService,
    private pineconeService: PineconeService,
    private conversationService: ConversationService,
  ) {}

  async processMessage(request: ChatRequest, abortSignal?: AbortSignal): Promise<ChatResponse> {
    const { question, sessionId } = request;
    const q = (question || '').trim();

    if (!sessionId) {
      this.logger.error('sessionId manquant: utilisez le JWT pour fournir sessionId');
      throw new Error('Session invalide');
    }

    // 🔹 Enregistrer le message utilisateur dans Mongo (conversation)
    try {
      const existing = await this.conversationService.getConversation(sessionId);
      if (!existing) {
        await this.conversationService.createConversation(sessionId, request.userId || 'unknown');
      }
      await this.conversationService.addMessage(sessionId, 'user', q);
    } catch (e) {
      this.logger.error('Erreur enregistrement message utilisateur:', e as any);
    }

    // 🔹 Bypass des salutations
    if (/^(bonjour|salut|hello|hi|merci|hey)\b/i.test(q)) {
      return {
        answer: 'Bonjour 👋 — je peux aider sur les lois béninoises. Pose une question juridique spécifique.',
        relevantDocuments: [],
        sources: [],
        sessionId,
        timestamp: new Date(),
      };
    }

    // 🔹 Vérifier l'annulation avant la recherche vectorielle
    if (abortSignal?.aborted) {
      throw new RequestCancelledException(sessionId);
    }

    // 🔹 Recherche vectorielle avec Pinecone + Mistral
    let results: Array<[any, number]> = [];
    try {
      const store = await this.pineconeService.getStore();
      const hits = await (store as any).similaritySearchWithScore(q, 5);
      if (Array.isArray(hits) && hits.length > 0) {
        results = hits as Array<[any, number]>;
      }
      this.logger.log(`Pinecone retourne ${results.length} résultat(s)`);
    } catch (err) {
      this.logger.error('Erreur Pinecone:', err as any);
    }

    // 🔹 Mapping vers SearchResult
    const relevantDocuments: SearchResult[] = (results || []).map(([doc, score]: any, idx: number) => {
      const meta = doc?.metadata || {};
      const pageText: string = doc?.pageContent || doc?.document || '';
      const metaText: string = typeof meta?.contenu === 'string' ? meta.contenu : '';
      const chosenText: string = pageText && pageText.trim().length > 0 ? pageText : metaText;

      // Logs de diagnostic détaillés
      this.logger.log(
        `Map Doc ${idx + 1}: pageTextLen=${pageText?.length ?? 0}, metaTextLen=${metaText?.length ?? 0}, chosen='${chosenText?.slice(0, 80) || ''}${(chosenText?.length||0) > 80 ? '…' : ''}'`
      );

      return {
        id: (meta?.id as string) || doc?.id || '',
        score: Number(score) || 0,
        payload: {
          text: chosenText,
          metadata: meta,
        },
      } as SearchResult;
    });

    this.logger.log(`Documents reçus de Pinecone: ${relevantDocuments.length}`);
    relevantDocuments.forEach((doc, idx) => {
      this.logger.log(`Doc ${idx + 1} score: ${doc.score.toFixed(4)}`);
    });

    // 🔹 Fallback si aucun document
    if (relevantDocuments.length === 0) {
      return {
        answer: "Je n'ai pas trouvé de document pertinent. Peux-tu préciser ta question (loi, article, code) ?",
        relevantDocuments: [],
        sources: [],
        sessionId,
        timestamp: new Date(),
      };
    }

    // 🔹 Vérifier l'annulation avant la génération LLM
    if (abortSignal?.aborted) {
      throw new RequestCancelledException(sessionId);
    }

    // 🔹 Génération de réponse via LangChain (inclure les 4 derniers messages d'historique)
    const docsText = relevantDocuments.map(d => d.payload.text || d.payload.metadata?.contenu || '');
    this.logger.log(`docsText built (${docsText.length} items). Lens=[${docsText.map(t => (t?.length||0)).join(', ')}]`);
    let historyLast4 = '';
    try {
      const hist = await this.conversationService.getConversationHistory(sessionId, 4);
      historyLast4 = (hist || [])
        .map((m: any) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
        .join('\n');
      this.logger.log(`Historique (4 derniers) construit: ${historyLast4.length} chars`);
    } catch (e) {
      this.logger.error('Erreur récupération historique (4 derniers):', e as any);
    }
    let answer: string = 'Voici des extraits pertinents liés à votre question.';

    try {
      const llmResponse = await (this.langChainService as any).generateResponse?.(q, docsText, sessionId, historyLast4, abortSignal);
      
      // 🔹 Gestion des objets retournés par LangChain
      if (typeof llmResponse === 'string') {
        answer = llmResponse;
      } else if (llmResponse?.content) {
        answer = llmResponse.content;
      }
      
      this.logger.log(`Réponse LLM finale: ${answer}`);
    } catch (err) {
      this.logger.error('Erreur lors de la génération LLM, fallback utilisé:', err);
    }

    // 🔹 Extraire les sources uniques (URLs dédupliquées)
    const uniqueSources = new Map<string, { url: string; titre: string; numero_loi: string }>();
    
    relevantDocuments.forEach(doc => {
      const metadata = doc.payload.metadata;
      const url = metadata?.url;
      const titre = metadata?.titre;
      const numero_loi = metadata?.numero_loi;
      
      if (url && titre && numero_loi) {
        uniqueSources.set(url, { url, titre, numero_loi });
      }
    });
    
    const sources = Array.from(uniqueSources.values());
    this.logger.log(`Sources uniques trouvées: ${sources.length}`);

    // 🔹 Enregistrer la réponse assistant dans Mongo (conversation)
    try {
      await this.conversationService.addMessage(sessionId, 'assistant', answer, { sources });
    } catch (e) {
      this.logger.error('Erreur enregistrement message assistant:', e as any);
    }

    // 🔹 Retour final
    return {
      answer,
      relevantDocuments,
      sources,
      sessionId,
      timestamp: new Date(),
    };
  }

}
