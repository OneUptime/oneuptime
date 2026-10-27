import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import Queue, { QueueName } from "../Infrastructure/Queue";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import SSRFProtection from "../Utils/SSRFProtection";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import URL from "../../Types/API/URL";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/CustomNotificationChannel";
import crypto from "crypto";

/*
 * The worker job that adds a channel to everybody's on-call rules, enqueued by
 * name: Common cannot import from App. It duplicates JOB_NAME in
 * App/FeatureSet/Workers/Jobs/OnCallDutyPolicy/AddCustomChannelToEveryonesRules.ts
 * verbatim - renaming one means renaming both.
 */
export const ADD_CUSTOM_CHANNEL_TO_EVERYONES_RULES_JOB_NAME: string =
  "OnCallDutyPolicy:AddCustomChannelToEveryonesRules";

// A signing secret's bytes: 32 random bytes, sent and stored as 64 hex digits.
const GENERATED_SECRET_BYTES: number = 32;

// What an update carries from onBeforeUpdate to onUpdateSuccess.
interface ChannelUpdateCarryForward {
  // The ids of the rows the update holds to that did not page everyone before.
  notPagingEveryoneBefore: Array<string>;
}

/*
 * Whether a channel pages everyone right now: it is on, and adds itself to
 * everyone's rules. A value never written reads as the column's default, true.
 */
export const isPagingEveryone: (channel: {
  isEnabled?: boolean | undefined;
  pageEveryoneByDefault?: boolean | undefined;
}) => boolean = (channel: {
  isEnabled?: boolean | undefined;
  pageEveryoneByDefault?: boolean | undefined;
}): boolean => {
  return channel.isEnabled !== false && channel.pageEveryoneByDefault !== false;
};

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  // A new signing secret, for a channel created without one.
  public static generateSecret(): string {
    return crypto.randomBytes(GENERATED_SECRET_BYTES).toString("hex");
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    createBy.data.name = this.readName(createBy.data.name);

    await this.assertNameIsFree({ name: createBy.data.name });

    if (!createBy.data.webhookUrl) {
      throw new BadDataException("A webhook URL is required.");
    }

    /*
     * The admin's own service, often on the installation's private network,
     * so private targets are allowed - as for a person's own webhook, and
     * checked again by every send (CustomNotificationChannel's sender).
     */
    await SSRFProtection.validateWebhookTargetIsSafe(
      createBy.data.webhookUrl.toString(),
      {
        allowPrivateNetworkTargets: true,
      },
    );

    if (!createBy.data.secret || !createBy.data.secret.trim()) {
      createBy.data.secret = Service.generateSecret();
    }

    /*
     * Nobody's rules have it yet, whatever the request says: the worker job
     * adds it to them once the channel is on and pages everyone
     * (AddCustomChannelToEveryonesRules), and records when it did.
     */
    delete (createBy.data as unknown as Record<string, unknown>)[
      "addedToEveryonesRulesAt"
    ];

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (isPagingEveryone(createdItem)) {
      await this.enqueueAddToEveryonesRules(createdItem.id);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: Record<string, unknown> = updateBy.data as Record<
      string,
      unknown
    >;

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        isEnabled: true,
        pageEveryoneByDefault: true,
      },
    );

    if (data["name"] !== undefined) {
      const name: string = this.readName(data["name"]);
      data["name"] = name;

      await this.assertNameIsFree({
        name: name,
        exceptIds: rows.map((row: Model): ObjectID => {
          return row.id!;
        }),
      });
    }

    /*
     * Create-time validation on its own is not a control: the URL is
     * editable afterwards.
     */
    const webhookUrl: unknown = data["webhookUrl"];

    if (webhookUrl !== undefined) {
      if (
        !webhookUrl ||
        (typeof webhookUrl !== "string" && !(webhookUrl instanceof URL))
      ) {
        throw new BadDataException("A webhook URL is required.");
      }

      await SSRFProtection.validateWebhookTargetIsSafe(webhookUrl, {
        allowPrivateNetworkTargets: true,
      });
    }

    const secret: unknown = data["secret"];

    if (
      secret !== undefined &&
      (typeof secret !== "string" || !secret.trim())
    ) {
      throw new BadDataException(
        "A signing secret is required: your service checks every request with it.",
      );
    }

    const carryForward: ChannelUpdateCarryForward = {
      notPagingEveryoneBefore: rows
        .filter((row: Model): boolean => {
          return !isPagingEveryone(row);
        })
        .map((row: Model): string => {
          return row.id!.toString();
        }),
    };

    return {
      updateBy,
      carryForward: carryForward,
    };
  }

  /*
   * A channel that starts paging everyone - turned on while it pages
   * everyone, or set to page everyone while it is on - is added to
   * everybody's rules again: whoever joined while it did not page everyone
   * has it from no rule, and the admin has just asked for everybody.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const carryForward: ChannelUpdateCarryForward | null =
      (onUpdate.carryForward as ChannelUpdateCarryForward | null) || null;

    const notPagingEveryoneBefore: Set<string> = new Set<string>(
      carryForward?.notPagingEveryoneBefore || [],
    );

    const candidateIds: Array<ObjectID> = updatedItemIds.filter(
      (id: ObjectID): boolean => {
        return notPagingEveryoneBefore.has(id.toString());
      },
    );

    if (candidateIds.length === 0) {
      return onUpdate;
    }

    const channels: Array<Model> = await this.findBy({
      query: {
        _id: QueryHelper.any(candidateIds),
      },
      select: {
        _id: true,
        isEnabled: true,
        pageEveryoneByDefault: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const channel of channels) {
      if (!isPagingEveryone(channel)) {
        continue;
      }

      await this.updateOneById({
        id: channel.id!,
        data: {
          addedToEveryonesRulesAt: null,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      await this.enqueueAddToEveryonesRules(channel.id);
    }

    return onUpdate;
  }

  /*
   * The rules that page through a channel go with it. The foreign key would
   * delete them anyway; deleting them here, through the rule service, keeps
   * that in the one place rules are deleted.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const channels: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
      },
    );

    for (const channel of channels) {
      await UserNotificationRuleService.deleteBy({
        query: {
          customNotificationChannelId: channel.id!,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: null,
    };
  }

  /*
   * The channels people may pick in their rules: the ones that are on, by
   * name. Their id and name only, so nothing else of a channel ever reaches a
   * project member (CustomNotificationChannel).
   */
  @CaptureSpan()
  public async getChannelsThatAreOn(): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        isEnabled: true,
      },
      select: {
        _id: true,
        name: true,
        pageEveryoneByDefault: true,
      },
      sort: {
        name: "ASC",
      } as any,
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The channels a person joining a project gets in their rules: on, and
   * paging everyone.
   */
  @CaptureSpan()
  public async getChannelsPagingEveryone(): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        isEnabled: true,
        pageEveryoneByDefault: true,
      },
      select: {
        _id: true,
        name: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  // A channel's name, trimmed, and refused when there is nothing left.
  private readName(value: unknown): string {
    const name: string = typeof value === "string" ? value.trim() : "";

    if (!name) {
      throw new BadDataException(
        "A name is required: it is what people see in their notification methods and on-call rules.",
      );
    }

    return name;
  }

  /*
   * Two channels with one name would be two identical entries in everybody's
   * rules, with nothing to tell them apart. Compared without regard to case,
   * as people read them.
   */
  private async assertNameIsFree(data: {
    name: string;
    exceptIds?: Array<ObjectID> | undefined;
  }): Promise<void> {
    const channels: Array<Model> = await this.findBy({
      query: {
        name: QueryHelper.findWithSameText(data.name),
      },
      select: {
        _id: true,
        name: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const exceptIds: Set<string> = new Set<string>(
      (data.exceptIds || []).map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    const taken: Model | undefined = channels.find(
      (channel: Model): boolean => {
        return (
          !exceptIds.has(channel.id?.toString() || "") &&
          (channel.name || "").trim().toLowerCase() === data.name.toLowerCase()
        );
      },
    );

    if (taken) {
      throw new BadDataException(
        `A custom channel named ${data.name} already exists. Give this one another name, so people can tell them apart.`,
      );
    }
  }

  /*
   * Ring the worker's bell (AddCustomChannelToEveryonesRules). Adding a
   * channel to every member's rules in every project is far too slow for the
   * request that saved it, so the worker owns the work. Best effort on
   * purpose: the job also sweeps on its own schedule every channel still to
   * do, so a dropped enqueue costs minutes, not coverage.
   */
  private async enqueueAddToEveryonesRules(
    channelId: ObjectID | null | undefined,
  ): Promise<void> {
    try {
      await Queue.addJob(
        QueueName.Worker,
        `${ADD_CUSTOM_CHANNEL_TO_EVERYONES_RULES_JOB_NAME}-${channelId?.toString() || ""}`,
        ADD_CUSTOM_CHANNEL_TO_EVERYONES_RULES_JOB_NAME,
        {
          customNotificationChannelId: channelId?.toString() || "",
        },
        {
          // One run covers every channel still to do.
          deduplication: {
            id: ADD_CUSTOM_CHANNEL_TO_EVERYONES_RULES_JOB_NAME,
            keepLastIfActive: true,
          },
        },
      );
    } catch (err) {
      logger.error(
        "Could not enqueue adding a custom channel to everyone's on-call rules. The scheduled sweep will still pick it up.",
      );
      logger.error(err);
    }
  }
}

export default new Service();
