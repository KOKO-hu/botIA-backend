import { Injectable, Logger } from '@nestjs/common';
export interface PineconeSearchResult {
  id: string;
  score: number;
  payload: {
    text: string;
    metadata?: any;
  };
}


import { RequestCancelledException } from './exceptions/cancelled.exception';
import { PineconeService } from 'src/pinecone/pinecone.service';
import { LangchainService } from 'src/langchain/langchain.service';
import { MongoCheckpointer } from 'src/memory/mongo-checkpointer.service';
import { AIMessage, ToolMessage } from 'langchain';
export interface ChatRequest {
  question: string;
  sessionId?: string;
  userId?: string;
}

export interface ChatResponse {
  answer: string;
  relevantDocuments: PineconeSearchResult[];
  sources: Array<{
    url: string;
    titre: string;
    numero_loi: string;
  }>;
  sessionId: string;
  timestamp: Date;
}
interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswerIndex: number;
  explanation?: string;
}
export interface AgentResponse {
  type: "quiz" | "search" | "chat" | "error";
  data: QuizQuestion[] | SearchResult | string | null;
}

export interface SearchResult {
  type: "search_result";
  response: string;
  citations: string[];
  sources: Array<{
    url: string;
    numero_loi: string;
    titre: string;
    article?: string;
    pages?: string;
  }>;
}
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly langchainService: LangchainService,
    private readonly mongoCheckpointer: MongoCheckpointer
  ) {}

  async extractFinalResponse(results: any) {
    const messages = results.messages;
  
    const isToolMessage = (message: any) => {
      if (!message) return false;
      if (["tool", "tool_message"].includes(message.type)) return true;
      if (Array.isArray(message.content)) {
        return message.content.some((chunk) => chunk?.type === "tool_use" || chunk?.type === "tool_result");
      }
      return false;
    };

    const extractToolName = (message: any) => {
      if (!message) return undefined;
      if (message.toolName) return message.toolName;
      if (message.name) return message.name;
      if (message.tool?.name) return message.tool.name;
      if (Array.isArray(message.content)) {
        const chunk = message.content.find((item: any) => item?.type === "tool_use");
        return chunk?.name;
      }
      return undefined;
    };

    // 2️⃣ On récupère le dernier message AI
    const lastAiMsg = [...messages].reverse().find((m) => m.type === "ai" || m.type === "assistant");
    
    // 1️⃣ On récupère le tool seulement s'il est directement lié au dernier message AI
    // On cherche dans les 2 messages précédents, mais on vérifie qu'il n'y a pas de message user entre les deux
    // Cela évite de récupérer des tools d'anciennes conversations
    let toolMsg = null;
    if (lastAiMsg) {
      const lastAiIndex = messages.lastIndexOf(lastAiMsg);
      // Chercher un tool message dans les 2 messages précédents
      for (let i = lastAiIndex - 1; i >= 0 && i >= lastAiIndex - 2; i--) {
        const msg = messages[i];
        // Si on trouve un message user, c'est un nouveau tour, on arrête
        if (msg.type === "human" || msg.type === "user" || msg.role === "user") {
          break;
        }
        // Si on trouve un tool message, on le prend
        if (isToolMessage(msg)) {
          toolMsg = msg;
          break;
        }
      }
    }
    
    const toolName = extractToolName(toolMsg);
  
    // 3️⃣ Vérifier si le tool utilisé est un QUIZ
    const isQuiz =
      toolMsg &&
      (toolName === "create_legal_quiz_pro" ||
       toolMsg.toolName === "create_legal_quiz_pro" ||
       toolMsg.name === "create_legal_quiz_pro");
  
    // 4️⃣ Vérifier si le tool est un CHAT
    const isChatTool =
      toolMsg &&
      (
        toolName === "search_benin_law" ||
        toolName === "chat_with_law" ||
        toolName === "legal_assistant" ||
        toolMsg.toolName === "search_benin_law" ||
        toolMsg.toolName === "chat_with_law" ||
        toolMsg.toolName === "legal_assistant"
      );
  
    // 🟦 CAS 1 : Quiz → renvoyer IA + TOOL
    if (isQuiz) {
      return {
        mode: "quiz",
        ai: lastAiMsg?.content || null,
        tool: toolMsg?.content || null
      };
    }
  
    // 🟩 CAS 2 : Chat → renvoyer IA + sources avec URLs
    if (isChatTool) {
      // Extraire les sources du ToolMessage si disponible
      let sources = null;
      if (toolMsg?.content) {
        try {
          let toolContent: any;
          
          // Gérer différents formats de contenu
          if (typeof toolMsg.content === 'string') {
            // Essayer de parser comme JSON
            try {
              toolContent = JSON.parse(toolMsg.content);
            } catch {
              // Si ce n'est pas du JSON, chercher dans le contenu brut
              toolContent = toolMsg.content;
            }
          } else {
            toolContent = toolMsg.content;
          }
          
          // Extraire les sources si elles existent
          if (toolContent?.sources && Array.isArray(toolContent.sources)) {
            sources = toolContent.sources;
          } else if (toolContent?.type === 'search_result' && toolContent?.sources) {
            sources = toolContent.sources;
          }
        } catch (e) {
          // Si le parsing échoue, on continue sans sources
          this.logger.warn('Failed to parse tool message content for sources', e);
        }
      }

      return {
        mode: "chat",
        ai: lastAiMsg?.content || null as any,
        sources: sources // Ajouter les sources avec URLs pour référence
      };
    }
  
    // 🟨 CAS 3 : Aucun tool utilisé → IA seulement
    return {
      mode: "chat",
      ai: lastAiMsg?.content || null
    };
  }
  

async chat(question: string, sessionId: string, userId: string): Promise<any> {
  const existingConv = await this.mongoCheckpointer.findActiveConversation(sessionId, userId);
  const threadId = existingConv ? existingConv._id.toString() : await this.mongoCheckpointer.init(sessionId, userId);



  const agent = this.langchainService.getAgent();
  const results = await agent.invoke({
    messages: [{ role: "user", content: question }],
  }, { configurable: { thread_id: threadId } });
  
  return this.extractFinalResponse(results);
  
  }

  async clearConversation(sessionId: string, userId: string) {
    const existingConv = await this.mongoCheckpointer.findActiveConversation(sessionId, userId);
    if (!existingConv) {
      return { cleared: false };
    }

    await this.mongoCheckpointer.clearConversationData(existingConv._id.toString());
    return { cleared: true, threadId: existingConv._id.toString() };
  }

  async getSessionHistory(
    sessionId: string,
    userId: string,
    page: number,
    pageSize: number,
  ) {
    return this.mongoCheckpointer.getSessionHistory(sessionId, userId, page, pageSize);
  }

  async listUserConversations(userId: string) {
    return this.mongoCheckpointer.listUserConversations(userId);
  }
}
