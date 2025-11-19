import { Injectable } from "@nestjs/common";
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Conversation } from "src/mongo/schemas/conversation.schema";
import {
  BaseCheckpointSaver,
  Checkpoint,
  CheckpointListOptions,
  CheckpointTuple,
  PendingWrite,
  CheckpointMetadata,
  CheckpointPendingWrite,
} from "@langchain/langgraph-checkpoint";

type RunnableConfig = {
  configurable?: Record<string, any>;
  [key: string]: any;
};

@Injectable()
export class MongoCheckpointer extends BaseCheckpointSaver {

  // ✔ FIX OBLIGATOIRE pour LangGraph
  configurable = {};

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<Conversation>,
  ) {
    super();
  }

  private normalizeConfig(config: RunnableConfig | undefined, threadId: string): RunnableConfig {
    if (!config?.configurable) {
      return {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: "",
        },
      };
    }

    return {
      ...config,
      configurable: {
        checkpoint_ns: "",
        ...config.configurable,
        thread_id:
          config.configurable.thread_id ??
          config.configurable.threadId ??
          threadId,
      },
    };
  }

  private extractThreadId(input: any): string | null {
    if (!input) return null;
    if (typeof input === "string") return input;
    const configurable =
      input.configurable ??
      input?.config?.configurable ??
      input?.metadata ??
      input?.context;
    if (configurable?.thread_id) return configurable.thread_id;
    if (configurable?.threadId) return configurable.threadId;
    if (configurable?.thread) return configurable.thread;
    return null;
  }

  private buildTupleFromConversation(
    conv: Conversation,
    threadId: string,
    fallbackConfig: RunnableConfig,
  ): CheckpointTuple | undefined {
    if (!conv?.checkpoint || !conv?.checkpointMetadata) {
      return undefined;
    }

    const metadata =
      (conv.checkpointMetadata as CheckpointMetadata) ?? {
        source: "input",
        step: -2,
        parents: {},
      };

    return {
      config: this.normalizeConfig(
        (conv.checkpointConfig as RunnableConfig) ?? fallbackConfig,
        threadId,
      ),
      checkpoint: conv.checkpoint as Checkpoint,
      metadata,
      parentConfig: conv.checkpointParentConfig as RunnableConfig | undefined,
      pendingWrites:
        (conv.checkpointPendingWrites as CheckpointPendingWrite[]) ?? [],
    };
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = this.extractThreadId(config);
    if (!threadId) return undefined;

    const conv = await this.conversationModel.findById(threadId).lean();
    if (!conv) return undefined;

    return this.buildTupleFromConversation(conv, threadId, this.normalizeConfig(config, threadId));
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const tuple = await this.getTuple(config);
    if (!tuple) return;

    if (options?.filter) {
      const metadata = tuple.metadata ?? {};
      const shouldInclude = Object.entries(options.filter).every(
        ([key, value]) => metadata?.[key] === value,
      );
      if (!shouldInclude) return;
    }

    if (options?.before?.configurable?.checkpoint_id) {
      if (
        tuple.config.configurable?.checkpoint_id &&
        tuple.config.configurable.checkpoint_id >=
          options.before.configurable.checkpoint_id
      ) {
        return;
      }
    }

    if (options?.limit !== undefined && options.limit <= 0) {
      return;
    }

    yield tuple;
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const threadId = this.extractThreadId(config);
    if (!threadId) {
      throw new Error(
        'Failed to persist checkpoint: missing "thread_id" inside config.configurable.',
      );
    }

    await this.conversationModel.findByIdAndUpdate(
      threadId,
      {
        checkpoint,
        checkpointMetadata: metadata,
        checkpointConfig: this.normalizeConfig(config, threadId),
        checkpointParentConfig: config.configurable?.checkpoint_id
          ? {
              configurable: {
                thread_id: threadId,
                checkpoint_ns: config.configurable.checkpoint_ns ?? "",
                checkpoint_id: config.configurable.checkpoint_id,
              },
            }
          : null,
        checkpointPendingWrites: [],
        updatedAt: new Date(),
      },
      { new: false },
    );

    return this.normalizeConfig(config, threadId);
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    if (!writes.length) return;

    const threadId = this.extractThreadId(config);
    const checkpointId = config.configurable?.checkpoint_id;
    if (!threadId || !checkpointId) return;

    const serializedWrites: CheckpointPendingWrite[] = writes.map(
      ([channel, value]) => [
      taskId,
      channel,
      value,
      ],
    );

    await this.conversationModel.findByIdAndUpdate(threadId, {
      $push: {
        checkpointPendingWrites: {
          $each: serializedWrites,
        },
      },
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.conversationModel.findByIdAndUpdate(threadId, {
      checkpoint: null,
      checkpointMetadata: null,
      checkpointConfig: null,
      checkpointParentConfig: null,
      checkpointPendingWrites: [],
    });
  }

  async clearConversationData(threadId: string): Promise<void> {
    await this.conversationModel.findByIdAndUpdate(
      threadId,
      {
        messages: [],
        summary: "",
        context: "",
        messageCount: 0,
        updatedAt: new Date(),
      },
      { new: false },
    );
    await this.deleteThread(threadId);
  }

  async getSessionHistory(
    sessionId: string,
    userId: string,
    page: number,
    pageSize: number,
  ) {
    const conversation = await this.conversationModel
      .findOne({ sessionId, userId })
      .lean();

    if (!conversation) {
      return {
        sessionId,
        userId,
        page,
        pageSize,
        totalMessages: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
        messages: [],
      };
    }

    const checkpointMessages =
      (conversation.checkpoint as any)?.channel_values?.messages ?? [];

    const normalizeContent = (message: any) => {
      const content = message.content ?? message.lc_kwargs?.content;
      if (typeof content === "string") {
        return content;
      }
      if (Array.isArray(content)) {
        const hasOnlyToolUse = content.every((chunk) =>
          ["tool_use", "tool_result"].includes(chunk?.type),
        );
        if (hasOnlyToolUse) {
          return null;
        }
        return content;
      }
      return content ?? null;
    };

    const normalizeMessage = (message: any) => {
      if (!message) return null;
      const lc = message.lc_kwargs ?? {};
      const normalizedContent = normalizeContent({
        content: message.content ?? lc.content,
        lc_kwargs: lc,
      });

      if (normalizedContent === null || normalizedContent === undefined) {
        return null;
      }

      return {
        id: message.id ?? lc.id,
        type: message.type ?? lc.type ?? message.role ?? lc.role ?? "unknown",
        role: message.role ?? lc.role ?? message.type ?? lc.type ?? "unknown",
        name: message.name ?? lc.name ?? null,
        content: normalizedContent,
        additional_kwargs: message.additional_kwargs ?? lc.additional_kwargs ?? {},
        response_metadata:
          message.response_metadata ?? lc.response_metadata ?? {},
        tool_calls: message.tool_calls ?? lc.tool_calls ?? [],
        invalid_tool_calls:
          message.invalid_tool_calls ?? lc.invalid_tool_calls ?? [],
        usage_metadata: message.usage_metadata ?? lc.usage_metadata ?? {},
      };
    };

    const normalizedMessages = checkpointMessages
      .map(normalizeMessage)
      .filter((msg) => {
        if (!msg) return false;
        if (msg.type === "tool" && msg.name === "search_benin_law") {
          return false;
        }
        return true;
      });

    const totalMessages = normalizedMessages.length;
    const totalPages =
      totalMessages === 0 ? 0 : Math.ceil(totalMessages / pageSize);
    const safePage = Math.min(Math.max(page, 1), Math.max(totalPages, 1));
    const startIndex = (safePage - 1) * pageSize;
    const messages = normalizedMessages.slice(
      startIndex,
      startIndex + pageSize,
    );

    return {
      sessionId,
      userId,
      conversationId: conversation._id.toString(),
      page: safePage,
      pageSize,
      totalMessages,
      totalPages,
      hasPrev: safePage > 1,
      hasNext: totalPages > 0 && safePage < totalPages,
      messages,
    };
  }

  async listUserConversations(userId: string) {
    const conversations = await this.conversationModel
      .find({ userId })
      .sort({ updatedAt: -1 })
      .lean();

    return conversations.map((conversation) => ({
      conversationId: conversation._id.toString(),
      sessionId: conversation.sessionId?.toString(),
      userId: conversation.userId?.toString(),
      isActive: conversation.isActive,
      messageCount:
        conversation.messageCount ?? conversation.messages?.length ?? 0,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      summary: conversation.summary ?? "",
      context: conversation.context ?? "",
    }));
  }

  async findActiveConversation(sessionId: string, userId: string) {
    return await this.conversationModel.findOne({ sessionId, userId, isActive: true });
  }

  async init(sessionId: string, userId: string): Promise<string> {
    const conv = await this.conversationModel.create({
      sessionId,
      userId,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
      messageCount: 0
    });

    return conv._id.toString();
  }
}

