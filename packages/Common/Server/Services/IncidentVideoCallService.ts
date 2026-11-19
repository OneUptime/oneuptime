import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import BadDataException from "../../Types/Exception/BadDataException";
import CountBy from "../Types/Database/CountBy";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import ModelPermission from "../Types/Database/Permissions/Index";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/IncidentVideoCall";
import { applyIncidentRelatedRecordPrivacyFilter } from "../Utils/Incident/IncidentPrivacyFilter";
import EventVideoCall, {
  VideoCallCarryForward,
  VideoCallEvent,
  VideoCallEventType,
  VideoCallFields,
} from "../Utils/VideoCall/EventVideoCall";
import ProjectReferenceCheck from "../Utils/Database/ProjectReferenceCheck";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import IncidentCallTranscriptFetch from "../Utils/VideoCall/Transcripts/IncidentCallTranscriptFetch";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { CallTranscriptFetchStatus } from "../../Types/VideoCall/CallTranscriptAutoFetch";
import { CallSummaryStatus } from "../../Types/VideoCall/CallSummary";
import CallSummaryPosts, {
  CallSummaryPost,
} from "../../Types/VideoCall/CallSummaryPosts";
import VideoCallProvider from "../../Types/VideoCall/VideoCallProvider";
import { VideoCallTranscriptSource } from "../../Types/VideoCall/VideoCallTranscript";
import QueryHelper from "../Types/Database/QueryHelper";
import IncidentVideoCallTranscriptWrite, {
  IncidentVideoCallTranscriptColumns,
} from "../Utils/VideoCall/Transcripts/IncidentVideoCallTranscriptWrite";
import IncidentCallTranscriptRemoval from "../Utils/VideoCall/Transcripts/IncidentCallTranscriptRemoval";
import {
  EntityManager,
  FindOptionsWhere,
  Repository,
  UpdateResult,
} from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

/*
 * What taking a call's transcript off for removal took
 * (takeTranscriptForRemoval): the call as it was, whether its transcript
 * went, and the posts of what OneUptime AI read in it, to delete next.
 */
export interface TakenTranscript {
  call: Model;
  removedTranscript: boolean;
  posts: Array<CallSummaryPost>;
  /*
   * The removed transcript had a reading posted before OneUptime kept where
   * readings go (CallSummaryPosts): its feed item and messages are found by
   * what it said (IncidentCallTranscriptRemoval).
   */
  untrackedReading: boolean;
}

// The columns a removal reads of the call it takes the transcript off.
const TAKEN_CALL_COLUMNS: Array<string> = [
  "_id",
  "projectId",
  "incidentId",
  "provider",
  "title",
  "videoCallConnectionId",
  "transcriptSource",
  "transcriptInfo",
  "transcriptAddedAt",
  "callSummary",
  "callSummaryStatus",
  "callSummaryPosts",
  "transcriptSignInAccountId",
];

/*
 * Incident video calls. A create fills the call in before it is saved -
 * starting the meeting at the provider when it comes from a connection (see
 * EventVideoCall) - and announces it once it is, wherever the incident's
 * updates go. Reads, updates and deletes see only the calls of incidents
 * the caller may see, as every incident child table does.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyIncidentRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyIncidentRelatedRecordPrivacyFilter(
      countBy.query,
      countBy.props,
    );
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    updateBy.query = applyIncidentRelatedRecordPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );
    return { updateBy, carryForward: null };
  }

  /*
   * A call that goes takes its transcript with it, and what OneUptime AI
   * read in it: its posts in the incident's feed and channels are deleted
   * once the call is (onDeleteSuccess), as Remove transcript deletes them.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = applyIncidentRelatedRecordPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );

    const calls: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        incidentId: true,
        provider: true,
        title: true,
        videoCallConnectionId: true,
        transcriptAddedAt: true,
        transcriptInfo: true,
        callSummary: true,
        callSummaryStatus: true,
        callSummaryPosts: true,
      },
    );

    return {
      deleteBy,
      carryForward: {
        callsWithTranscripts: calls.filter((call: Model): boolean => {
          return (
            Boolean(call.transcriptAddedAt) || Boolean(call.callSummaryPosts)
          );
        }),
      },
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const result: OnDelete<Model> = await super.onDeleteSuccess(
      onDelete,
      itemIdsBeforeDelete,
    );

    const calls: Array<Model> =
      (
        onDelete.carryForward as {
          callsWithTranscripts?: Array<Model>;
        } | null
      )?.callsWithTranscripts || [];

    for (const call of calls) {
      await IncidentCallTranscriptRemoval.takeBackDeletedCall({
        call,
        userId:
          onDelete.deleteBy.deletedByUser?.id ||
          onDelete.deleteBy.props.userId ||
          undefined,
      });
    }

    return result;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Model = createBy.data;
    const isServerWrite: boolean = ProjectReferenceCheck.isServerWrite(
      createBy.props,
    );

    if (!data.incidentId) {
      throw new BadDataException("Incident ID is required.");
    }

    /*
     * Everything a person may not do is refused before a meeting is started
     * at the provider: what they may write, and which incidents they may
     * see.
     */
    if (!createBy.props.isRoot && !createBy.props.isMasterAdmin) {
      ModelPermission.checkCreatePermissions(
        this.modelType,
        data,
        createBy.props,
      );
    }

    await EventVideoCall.assertCallerCanSeeEvent({
      type: VideoCallEventType.Incident,
      id: data.incidentId,
      props: createBy.props,
    });

    const event: VideoCallEvent = await EventVideoCall.getEvent({
      type: VideoCallEventType.Incident,
      id: data.incidentId,
    });

    /*
     * The connection and the rule are each one column with two names, the
     * relation and its ID column: a write that names one by its relation
     * is read like one that names its ID column, and a write that names
     * two different records under the two names is refused.
     */
    const videoCallConnectionId: ObjectID | null =
      RelationIdUtil.readIntoIdColumn(
        data as unknown as Record<string, unknown>,
        ["videoCallConnectionId", "videoCallConnection"],
        "Video Call Connection",
      );
    const workspaceNotificationRuleId: ObjectID | null =
      RelationIdUtil.readConsistent(
        data as unknown as Record<string, unknown>,
        ["workspaceNotificationRuleId", "workspaceNotificationRule"],
        "Workspace Notification Rule",
      );

    const prepared: {
      fields: VideoCallFields;
      carryForward: VideoCallCarryForward;
    } = await EventVideoCall.prepare({
      event,
      isServerWrite,
      fields: {
        provider: data.provider,
        videoCallConnectionId: videoCallConnectionId || undefined,
        title: data.title,
        joinUrl: data.joinUrl,
        externalMeetingId: data.externalMeetingId,
        workspaceNotificationRuleId: workspaceNotificationRuleId || undefined,
      },
    });

    EventVideoCall.applyFields(data, prepared.fields);

    /*
     * The relations of the fields above are OneUptime's to set too: a
     * request that named the rule or the meeting by its relation instead
     * of its id is not let through that way.
     */
    delete data.workspaceNotificationRule;

    if (!prepared.fields.videoCallConnectionId) {
      delete data.videoCallConnection;
    }

    return {
      createBy: createBy,
      carryForward: prepared.carryForward,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const carryForward: VideoCallCarryForward =
      (onCreate.carryForward as VideoCallCarryForward | undefined) || {};

    if (createdItem.incidentId && createdItem.provider && createdItem.joinUrl) {
      await EventVideoCall.announce({
        eventType: VideoCallEventType.Incident,
        eventId: createdItem.incidentId,
        provider: createdItem.provider,
        joinUrl: createdItem.joinUrl,
        title: createdItem.title,
        connectionName: carryForward.connectionName,
        workspaceNotificationRuleId: createdItem.workspaceNotificationRuleId,
        userId:
          createdItem.createdByUserId ||
          createdItem.createdByUser?.id ||
          undefined,
        recordsAndTranscribes: carryForward.recordsAndTranscribes,
      });
    }

    /*
     * A call the provider records and transcribes: OneUptime gets its
     * transcript once it is over (IncidentCallTranscriptFetch). One the
     * provider could not be set up to record says why on its card.
     */
    if (carryForward.recordsAndTranscribes) {
      await IncidentCallTranscriptFetch.watchNewCall(createdItem);
    } else if (carryForward.notRecordedReason) {
      await IncidentCallTranscriptFetch.markNotRecorded({
        call: createdItem,
        reason: carryForward.notRecordedReason,
      });
    }

    return createdItem;
  }

  /*
   * Takes a call the transcript job is due to ask about, so that two runs
   * of the job never ask about it at once: one UPDATE that moves its next
   * attempt on, and only while the call is still Waiting at the attempt
   * the job read. 1 when this run took it, 0 when another run did, or the
   * call stopped waiting meanwhile (a person added its transcript).
   */
  @CaptureSpan()
  public async claimTranscriptFetch(data: {
    callId: ObjectID;
    // The next attempt the job read, which it is due for.
    dueAt: Date;
    // Where the next attempt moves to while this run asks.
    nextAttemptAt: Date;
  }): Promise<number> {
    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set({
        transcriptFetchNextAttemptAt: data.nextAttemptAt,
      } as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.callId.toString() })
      .andWhere('"transcriptFetchStatus" = :status', {
        status: CallTranscriptFetchStatus.Waiting,
      })
      .andWhere('"transcriptFetchNextAttemptAt" = :dueAt', {
        dueAt: data.dueAt,
      })
      .andWhere('"deletedAt" IS NULL')
      .execute();

    return result.affected || 0;
  }

  /*
   * Takes a call whose transcript the job just got from the provider, for
   * storing it: one UPDATE that ends the waiting, only while the call still
   * waits and has no transcript. 1 when the job may store it, 0 when a
   * person got or added one meanwhile - theirs stands, and is not stored,
   * read and posted twice.
   */
  @CaptureSpan()
  public async takeTranscriptFetchForSaving(data: {
    callId: ObjectID;
    // When the job asked the provider.
    checkedAt: Date;
  }): Promise<number> {
    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set({
        transcriptFetchStatus: null,
        transcriptFetchReason: null,
        transcriptFetchNextAttemptAt: null,
        transcriptFetchCheckedAt: data.checkedAt,
      } as unknown as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.callId.toString() })
      .andWhere('"transcriptFetchStatus" = :status', {
        status: CallTranscriptFetchStatus.Waiting,
      })
      .andWhere('"transcriptAddedAt" IS NULL')
      .andWhere('"deletedAt" IS NULL')
      .execute();

    return result.affected || 0;
  }

  /*
   * Writes what a reading of the call's transcript came to, only while it
   * is still the call's reading (its run id is the call summary's): one
   * UPDATE, so a transcript removed or replaced - or read again - while the
   * reading ran is never followed by what that reading found. Whether it
   * was written.
   */
  @CaptureSpan()
  public async writeReadingIfCurrent(data: {
    callId: ObjectID;
    runId: string;
    columns: IncidentVideoCallTranscriptColumns;
  }): Promise<boolean> {
    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set(data.columns as unknown as QueryDeepPartialEntity<Model>)
      .where('"_id" = :id', { id: data.callId.toString() })
      .andWhere(`"callSummary" ->> 'runId' = :runId`, { runId: data.runId })
      .andWhere('"deletedAt" IS NULL')
      .execute();

    return (result.affected || 0) > 0;
  }

  /*
   * Keeps where a reading was posted (CallSummaryPosts), only while the
   * transcript it read is still the call's (its transcriptAddedAt): one
   * UPDATE, so a post made while the transcript was being removed is never
   * kept on a call that no longer has it - the caller deletes it instead.
   * Whether it was kept.
   */
  @CaptureSpan()
  public async keepCallSummaryPost(data: {
    callId: ObjectID;
    transcriptAddedAt: Date;
    post: CallSummaryPost;
  }): Promise<boolean> {
    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set({
        callSummaryPosts: (): string => {
          return `jsonb_build_object('posts', COALESCE("callSummaryPosts" -> 'posts', CAST('[]' AS jsonb)) || CAST(:post AS jsonb))`;
        },
      } as unknown as QueryDeepPartialEntity<Model>)
      .setParameter(
        "post",
        JSON.stringify([CallSummaryPosts.toPostJSON(data.post)]),
      )
      .where('"_id" = :id', { id: data.callId.toString() })
      .andWhere('"transcriptAddedAt" = :addedAt', {
        addedAt: data.transcriptAddedAt,
      })
      .andWhere('"deletedAt" IS NULL')
      .execute();

    return (result.affected || 0) > 0;
  }

  /*
   * Takes a call's transcript off, with the posts of what OneUptime AI read
   * in it, for IncidentCallTranscriptRemoval to delete: in one transaction
   * with the call's row locked, so a reading that keeps its post at the
   * same moment either lands first, and is taken, or finds the transcript
   * gone, and deletes its post itself (keepCallSummaryPost).
   *
   * A person removing it takes everything. The account whose sign-in read
   * it removing OneUptime takes what was read through that sign-in: the
   * transcript when it was read from the provider through it, and the posts
   * of what was read in such transcripts. A transcript a person added stays,
   * and so do its posts. Null when there is no such call.
   *
   * The posts are taken here and deleted right after, outside the
   * transaction, since deleting a channel message is a request to its
   * workspace that no row lock should wait on: the feed items first, then
   * the messages.
   */
  @CaptureSpan()
  public async takeTranscriptForRemoval(data: {
    callId: ObjectID;
    // Only what this account's sign-in read. Left out, everything.
    signInAccountId?: string | undefined;
  }): Promise<TakenTranscript | null> {
    return await this.executeTransaction(
      async (manager: EntityManager): Promise<TakenTranscript | null> => {
        const repository: Repository<Model> =
          manager.getRepository<Model>(Model);

        const call: Model | null = await repository
          .createQueryBuilder("call")
          .select(
            TAKEN_CALL_COLUMNS.map((column: string): string => {
              return `call.${column}`;
            }),
          )
          .where("call._id = :id", { id: data.callId.toString() })
          .andWhere("call.deletedAt IS NULL")
          .setLock("pessimistic_write")
          .getOne();

        if (!call || !call._id) {
          return null;
        }

        const posts: Array<CallSummaryPost> = CallSummaryPosts.read(
          call.callSummaryPosts,
        );
        const hasTranscript: boolean = Boolean(call.transcriptAddedAt);
        const isEverything: boolean = data.signInAccountId === undefined;
        const signInAccountId: string = data.signInAccountId || "";

        const removedTranscript: boolean = isEverything
          ? hasTranscript
          : hasTranscript &&
            call.transcriptSource === VideoCallTranscriptSource.Provider &&
            call.transcriptSignInAccountId === signInAccountId;

        const split: {
          readThroughSignIn: Array<CallSummaryPost>;
          rest: Array<CallSummaryPost>;
        } = isEverything
          ? { readThroughSignIn: posts, rest: [] }
          : CallSummaryPosts.splitBySignIn(posts, signInAccountId);

        /*
         * Nothing else read through the account's sign-in is left: a
         * call's transcript is read only through the account that hosts it.
         */
        const signInCleared: boolean =
          isEverything ||
          !call.transcriptSignInAccountId ||
          call.transcriptSignInAccountId === signInAccountId;

        const columns: IncidentVideoCallTranscriptColumns = {
          ...(removedTranscript
            ? IncidentVideoCallTranscriptWrite.noTranscript()
            : {}),
          callSummaryPosts: CallSummaryPosts.toValue(split.rest),
          ...(signInCleared
            ? IncidentVideoCallTranscriptWrite.noSignIn()
            : { transcriptSignInRemovedAt: null }),
        };

        await repository.update(
          { _id: call._id } as FindOptionsWhere<Model>,
          columns as unknown as QueryDeepPartialEntity<Model>,
        );

        return {
          call,
          removedTranscript,
          posts: split.readThroughSignIn,
          untrackedReading:
            removedTranscript &&
            call.callSummaryStatus === CallSummaryStatus.Ready &&
            !CallSummaryPosts.isKept(call.callSummaryPosts),
        };
      },
    );
  }

  /*
   * Marks every call whose transcript was read through the account's
   * sign-in for what was read through it to be deleted, now that the
   * account removed OneUptime at the provider (Zoom's app_deauthorized):
   * one UPDATE, quick enough to answer the provider's event within the
   * seconds it waits. The Workers job deletes them
   * (DeleteTranscriptsOfRemovedSignIns). A call marked already keeps when
   * it was first marked, so an event sent twice changes nothing. How many.
   */
  @CaptureSpan()
  public async markTranscriptsOfRemovedSignIn(data: {
    provider: VideoCallProvider;
    accountId: string;
  }): Promise<number> {
    if (!data.accountId) {
      return 0;
    }

    const result: UpdateResult = await this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set({
        transcriptSignInRemovedAt: (): string => {
          return 'COALESCE("transcriptSignInRemovedAt", now())';
        },
      } as unknown as QueryDeepPartialEntity<Model>)
      .where('"provider" = :provider', { provider: data.provider })
      .andWhere('"transcriptSignInAccountId" = :accountId', {
        accountId: data.accountId,
      })
      .andWhere('"deletedAt" IS NULL')
      .execute();

    return result.affected || 0;
  }

  /*
   * The calls waiting for what was read through a removed sign-in to be
   * deleted (markTranscriptsOfRemovedSignIn), the longest waiting first.
   * Read as root.
   */
  @CaptureSpan()
  public async getCallsOfRemovedSignIns(limit: number): Promise<Array<Model>> {
    return await this.findBy({
      query: { transcriptSignInRemovedAt: QueryHelper.notNull() },
      select: {
        _id: true,
        transcriptSignInAccountId: true,
        transcriptSignInRemovedAt: true,
      },
      sort: { transcriptSignInRemovedAt: SortOrder.Ascending },
      skip: 0,
      limit: limit,
      props: { isRoot: true },
    });
  }

  // Every call of an incident, oldest first. Read as root.
  @CaptureSpan()
  public async getCallsForIncident(
    incidentId: ObjectID,
  ): Promise<Array<Model>> {
    return await this.findBy({
      query: { incidentId: incidentId },
      select: {
        _id: true,
        provider: true,
        joinUrl: true,
        videoCallConnectionId: true,
        workspaceNotificationRuleId: true,
      },
      sort: { createdAt: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  }
}

export default new Service();
