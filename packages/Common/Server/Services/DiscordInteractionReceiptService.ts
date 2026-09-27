import Model, {
  DiscordInteractionReceiptStatus,
} from "../../Models/DatabaseModels/DiscordInteractionReceipt";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";
import DatabaseService from "./DatabaseService";
import { IsNull, Not } from "typeorm";

const RECEIPT_TTL_MILLISECONDS: number = 15 * 60 * 1000;
const MAX_RESPONSE_BYTES: number = 64 * 1024;
const SNOWFLAKE_PATTERN: RegExp = /^[0-9]{17,20}$/;

export type DiscordInteractionReceiptClaim =
  | { kind: "acquired" }
  | { kind: "in_progress" }
  | { kind: "terminal"; response: JSONObject };

class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays("expiresAt", 1);
  }

  public async claim(data: {
    applicationId: string;
    interactionId: string;
    guildId: string;
    discordUserId: string;
  }): Promise<DiscordInteractionReceiptClaim> {
    this.assertKey(data);
    const receipt: Model = new Model();
    receipt.applicationId = data.applicationId;
    receipt.interactionId = data.interactionId;
    receipt.guildId = data.guildId;
    receipt.discordUserId = data.discordUserId;
    receipt.status = DiscordInteractionReceiptStatus.InProgress;
    receipt.expiresAt = new Date(Date.now() + RECEIPT_TTL_MILLISECONDS);

    try {
      await this.getRepository().save(receipt, { reload: false });
      return { kind: "acquired" };
    } catch (error) {
      if (!PostgresErrorTranslator.isUniqueViolation(error)) {
        throw error;
      }
    }

    const existing: Model | null = await this.getRepository().findOne({
      where: {
        applicationId: data.applicationId,
        interactionId: data.interactionId,
      },
    });
    if (!existing) {
      throw new BadDataException(
        "Discord interaction receipt could not be reconciled.",
      );
    }
    if (
      existing.guildId !== data.guildId ||
      existing.discordUserId !== data.discordUserId
    ) {
      throw new BadDataException(
        "Discord interaction receipt actor does not match.",
      );
    }
    if (existing.status === DiscordInteractionReceiptStatus.InProgress) {
      return { kind: "in_progress" };
    }
    if (!existing.replayResponse) {
      throw new BadDataException(
        "Discord interaction receipt has no replay response.",
      );
    }
    return { kind: "terminal", response: existing.replayResponse };
  }

  public async bindContext(data: {
    applicationId: string;
    interactionId: string;
    guildId: string;
    discordUserId: string;
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    this.assertKey(data);
    const updated: number =
      (
        await this.getRepository().update(
          {
            applicationId: data.applicationId,
            interactionId: data.interactionId,
            guildId: data.guildId,
            discordUserId: data.discordUserId,
            status: DiscordInteractionReceiptStatus.InProgress,
            projectId: IsNull(),
            userId: IsNull(),
          },
          { projectId: data.projectId, userId: data.userId },
        )
      ).affected || 0;
    if (updated !== 1) {
      throw new BadDataException(
        "Discord interaction receipt context could not be bound.",
      );
    }
  }

  public async complete(data: {
    applicationId: string;
    interactionId: string;
    response: JSONObject;
  }): Promise<void> {
    await this.finish({
      ...data,
      status: DiscordInteractionReceiptStatus.Completed,
    });
  }

  public async fail(data: {
    applicationId: string;
    interactionId: string;
    response: JSONObject;
  }): Promise<void> {
    await this.finish({
      ...data,
      status: DiscordInteractionReceiptStatus.Failed,
    });
  }

  private async finish(data: {
    applicationId: string;
    interactionId: string;
    status:
      | DiscordInteractionReceiptStatus.Completed
      | DiscordInteractionReceiptStatus.Failed;
    response: JSONObject;
  }): Promise<void> {
    this.assertKey(data);
    this.assertReplayResponse(data.response);
    const updated: number =
      (
        await this.getRepository().update(
          {
            applicationId: data.applicationId,
            interactionId: data.interactionId,
            status: DiscordInteractionReceiptStatus.InProgress,
            ...(data.status === DiscordInteractionReceiptStatus.Completed
              ? { projectId: Not(IsNull()), userId: Not(IsNull()) }
              : {}),
          },
          {
            status: data.status,
            // TypeORM's recursive update type cannot terminate on JSONObject.
            replayResponse: data.response as never,
            completedAt: new Date(),
          },
        )
      ).affected || 0;
    if (updated !== 1) {
      throw new BadDataException(
        "Discord interaction receipt could not be completed.",
      );
    }
  }

  private assertReplayResponse(response: JSONObject): void {
    const data: unknown = response["data"];
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new BadDataException("Invalid Discord replay response.");
    }
    const message: JSONObject = data as JSONObject;
    const mentions: unknown = message["allowed_mentions"];
    if (!mentions || typeof mentions !== "object" || Array.isArray(mentions)) {
      throw new BadDataException("Invalid Discord replay response.");
    }
    const allowedMentions: JSONObject = mentions as JSONObject;
    const content: unknown = message["content"];
    const parse: unknown = allowedMentions["parse"];
    if (
      response["type"] !== 4 ||
      Object.keys(response).some((key: string): boolean => {
        return key !== "type" && key !== "data";
      }) ||
      typeof content !== "string" ||
      content.length < 1 ||
      content.length > 2000 ||
      message["flags"] !== 64 ||
      Object.keys(message).some((key: string): boolean => {
        return (
          key !== "content" && key !== "flags" && key !== "allowed_mentions"
        );
      }) ||
      !Array.isArray(parse) ||
      parse.length !== 0 ||
      allowedMentions["replied_user"] !== false ||
      Object.keys(allowedMentions).some((key: string): boolean => {
        return key !== "parse" && key !== "replied_user";
      }) ||
      JSON.stringify(response).length > MAX_RESPONSE_BYTES
    ) {
      throw new BadDataException("Invalid Discord replay response.");
    }
  }

  private assertKey(data: {
    applicationId: string;
    interactionId: string;
    guildId?: string;
    discordUserId?: string;
  }): void {
    if (
      !SNOWFLAKE_PATTERN.test(data.applicationId) ||
      !SNOWFLAKE_PATTERN.test(data.interactionId) ||
      (data.guildId !== undefined && !SNOWFLAKE_PATTERN.test(data.guildId)) ||
      (data.discordUserId !== undefined &&
        !SNOWFLAKE_PATTERN.test(data.discordUserId))
    ) {
      throw new BadDataException("Invalid Discord interaction receipt key.");
    }
  }
}

export default new Service();
