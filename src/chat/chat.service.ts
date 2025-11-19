import { Injectable, Logger } from '@nestjs/common';
export interface SearchResult {
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

    // 1️⃣ On récupère le tool s'il existe
    const toolMsg = [...messages].reverse().find(isToolMessage);
    const toolName = extractToolName(toolMsg);
  
    // 2️⃣ On récupère le dernier message AI
    const lastAiMsg = [...messages].reverse().find((m) => m.type === "ai" || m.type === "assistant");
  
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
  
    // 🟩 CAS 2 : Chat → renvoyer IA uniquement
    if (isChatTool) {
      return {
        mode: "chat",
        ai: lastAiMsg?.content || null as any
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

 /*  const threadId = await this.mongoCheckpointer.init(sessionId, userId); */

  const agent = this.langchainService.getAgent();
  const results = await agent.invoke({
    messages: [{
      role: "user",
      content: question,
    }],
    
  }, {configurable: { thread_id: threadId }});
 
  const toolResponse = await this.extractFinalResponse(results);
 // 🟩 CAS 1 : Chat → on retourne juste le texte IA
 if (toolResponse.mode === "chat") {
  return toolResponse.ai || "";
}

// 🟦 CAS 2 : Quiz → on retourne object (ai + tool)
if (toolResponse.mode === "quiz") {
  return {
    ai: toolResponse.ai,
    tool: toolResponse.tool,
  };
}

// 🟨 Fallback (ne devrait pas arriver)
return toolResponse.ai || "";
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
