import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  OnCallPageCoverKind,
  OnCallPageCoverName,
  getOnCallPageCoverKind,
  isOnCallPageACover,
  isOnCallPageMergeable,
  readOnCallPageMergedLine,
} from "../../../Types/OnCallDutyPolicy/OnCallPageMerge";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import OnCallDutyPolicyExecutionLogService from "../../Services/OnCallDutyPolicyExecutionLogService";
import UserOnCallLogService from "../../Services/UserOnCallLogService";
import UserService from "../../Services/UserService";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * ONE PAGE FOR SOMEBODY TWO PAGES REACH ABOUT ONE RECORD, ON THE SERVER
 * (issues #7837, #8859).
 *
 * What a merged page is, which pages merge and into which, and why, is in
 * Types/OnCallDutyPolicy/OnCallPageMerge. This reads and writes it:
 *
 *   - findCovers: as a level - or a workflow's direct page - pages its
 *     people (OnCallDutyPolicyEscalationRuleService), the open page each of
 *     them has from another run about the same record, which their page in
 *     this run is merged into - one read for the level;
 *   - readMergedPage: each minute (UserOnCallLog:ExecutePendingExecutions),
 *     where the page a merged page stands on is: still open, answered by its
 *     person, or over without their answer - and then what it sent, which
 *     the merged page counts as sent when it takes the page over;
 *   - findMergedPagesToAnswer: as a person answers a page
 *     (UserOnCallLogTimelineService.acknowledgePage), their merged pages
 *     about the same record, answered with it.
 *
 * Every read is best effort: one that fails merges nothing, and the person
 * is paged as they were before pages were merged - a second set of
 * notifications is better than a page lost to a read.
 */

// A record a page is about, by the column of a person's page that names it.
export interface OnCallPageMergeRecord {
  column:
    | "triggeredByIncidentId"
    | "triggeredByAlertId"
    | "triggeredByAlertEpisodeId"
    | "triggeredByIncidentEpisodeId";
  id: ObjectID;
}

// What names a page's record and its kind: a run's page, or a person's log of it.
export interface OnCallPageMergeRecordOf {
  triggeredByIncidentId?: ObjectID | undefined | null;
  triggeredByAlertId?: ObjectID | undefined | null;
  triggeredByAlertEpisodeId?: ObjectID | undefined | null;
  triggeredByIncidentEpisodeId?: ObjectID | undefined | null;
}

/*
 * A person's open page from another run, which their page in this run is
 * merged into.
 */
export interface OnCallPageCover {
  // Its log: the page a merged page stands on.
  userOnCallLogId: ObjectID;
  // Its run.
  executionLogId: ObjectID;
  /*
   * What the merged page's line names it by: its policy - with no name for
   * one that has none - the person who sent it from a chat, or the workflow
   * whose direct page it is (#8859).
   */
  by: OnCallPageCoverName;
}

// Where the page a merged page stands on is, read each minute.
export enum OnCallMergedPageStanding {
  // Still open: its notifications stand for both. The merged page waits.
  Waits = "Waits",
  // Its person answered it: the merged page is answered with it.
  Answered = "Answered",
  /*
   * Over without their answer - escalated, failed, its run stopped, or gone:
   * the merged page takes the page over and pages them itself.
   */
  TakesOver = "TakesOver",
}

export interface OnCallMergedPageReading {
  standing: OnCallMergedPageStanding;
  // Answered: when they answered it.
  acknowledgedAt?: Date | undefined;
  /*
   * TakesOver: what the other page sent - its On-Call Rules and their
   * repeats, by claim key, as its log keeps them (executedNotificationRules)
   * - which the merged page counts as sent. None when it failed: all of it
   * is sent again, rather than risk a page that never reached them.
   */
  claimsSent: JSONObject;
  /*
   * What the other page is, for the line of a page that takes it over: its
   * policy, or who or which workflow sent it (#8859) - read from the page
   * itself, or, when it is gone, from what the merged page's own line named
   * it. Null when neither says.
   */
  by: OnCallPageCoverName | null;
}

// The statuses of a person's page whose notifications are still going out.
const SENDING_STATUSES: Array<UserNotificationExecutionStatus> = [
  UserNotificationExecutionStatus.Scheduled,
  UserNotificationExecutionStatus.Started,
  UserNotificationExecutionStatus.Executing,
];

// The statuses of a run that is still paging.
const PAGING_RUN_STATUSES: Array<OnCallDutyPolicyStatus> = [
  OnCallDutyPolicyStatus.Scheduled,
  OnCallDutyPolicyStatus.Started,
  OnCallDutyPolicyStatus.Executing,
];

// What tells the kinds of page apart, read with a run (OnCallPageMergeRun).
const RUN_KIND_SELECT: Select<OnCallDutyPolicyExecutionLog> = {
  _id: true,
  status: true,
  onCallDutyPolicyId: true,
  pageAgainNumber: true,
  triggeredByUserId: true,
  triggeredByWorkflowId: true,
  isObserverPage: true,
  userNotificationEventType: true,
};

/*
 * A run read as a page that may stand for another: its kind, and the name a
 * workflow's direct page is named by (#8859), as the run recorded it. Who
 * sent a page from a chat is read apart (readPagerNames): a read joins one
 * relation deep, and the run is already one.
 */
const COVER_RUN_SELECT: Select<OnCallDutyPolicyExecutionLog> = {
  ...RUN_KIND_SELECT,
  triggeredByWorkflowName: true,
};

// A page that may still stand for another, read with its run and policy.
const COVER_SELECT: Select<UserOnCallLog> = {
  _id: true,
  userId: true,
  status: true,
  createdAt: true,
  acknowledgedAt: true,
  userNotificationEventType: true,
  onCallDutyPolicyExecutionLogId: true,
  onCallDutyPolicy: {
    name: true,
  },
  onCallDutyPolicyExecutionLog: COVER_RUN_SELECT,
};

export default class OnCallPageMerge {
  // The record a page is about; null for a page about none (a test page).
  public static getRecord(
    page: OnCallPageMergeRecordOf,
  ): OnCallPageMergeRecord | null {
    if (page.triggeredByIncidentId) {
      return {
        column: "triggeredByIncidentId",
        id: page.triggeredByIncidentId,
      };
    }

    if (page.triggeredByAlertId) {
      return { column: "triggeredByAlertId", id: page.triggeredByAlertId };
    }

    if (page.triggeredByAlertEpisodeId) {
      return {
        column: "triggeredByAlertEpisodeId",
        id: page.triggeredByAlertEpisodeId,
      };
    }

    if (page.triggeredByIncidentEpisodeId) {
      return {
        column: "triggeredByIncidentEpisodeId",
        id: page.triggeredByIncidentEpisodeId,
      };
    }

    return null;
  }

  // A person's id as the reads key it.
  public static getUserKey(userId: ObjectID | string): string {
    return userId.toString().toLowerCase();
  }

  /*
   * What a merged page's line names a page by, read with its run and policy
   * (COVER_SELECT): its policy's name; for a direct page (#8859), who sent it
   * from a chat - by `pagerNames`, read for the pages at once
   * (readPagerNames) - or the workflow whose step sent it. Null as the name
   * when there is none to read.
   */
  public static getCoverName(
    page: UserOnCallLog,
    pagerNames?: Map<string, string> | undefined,
  ): OnCallPageCoverName {
    const run: OnCallDutyPolicyExecutionLog | undefined =
      page.onCallDutyPolicyExecutionLog;

    const kind: OnCallPageCoverKind = run
      ? getOnCallPageCoverKind(run)
      : OnCallPageCoverKind.Policy;

    if (kind === OnCallPageCoverKind.PersonPage) {
      return {
        kind: kind,
        name:
          (run?.triggeredByUserId &&
            pagerNames?.get(this.getUserKey(run.triggeredByUserId))) ||
          null,
      };
    }

    if (kind === OnCallPageCoverKind.WorkflowPage) {
      return {
        kind: kind,
        name: run?.triggeredByWorkflowName?.toString().trim() || null,
      };
    }

    return {
      kind: kind,
      name: page.onCallDutyPolicy?.name?.toString().trim() || null,
    };
  }

  /*
   * Who sent each of these pages from a chat (#8859), by their user id: their
   * name, or else their email address. One read for them all, as OneUptime;
   * none for no page sent from a chat. Throws as the database does.
   */
  public static async readPagerNames(
    pages: Array<UserOnCallLog>,
  ): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();
    const userIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const page of pages) {
      const run: OnCallDutyPolicyExecutionLog | undefined =
        page.onCallDutyPolicyExecutionLog;

      if (
        run?.triggeredByUserId &&
        getOnCallPageCoverKind(run) === OnCallPageCoverKind.PersonPage
      ) {
        userIds.set(
          this.getUserKey(run.triggeredByUserId),
          new ObjectID(run.triggeredByUserId.toString()),
        );
      }
    }

    if (userIds.size === 0) {
      return names;
    }

    const users: Array<User> = await UserService.findBy({
      query: {
        _id: QueryHelper.any([...userIds.values()]),
      },
      select: {
        _id: true,
        name: true,
        email: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    for (const user of users) {
      const name: string =
        user.name?.toString().trim() || user.email?.toString().trim() || "";

      if (user.id && name) {
        names.set(this.getUserKey(user.id), name);
      }
    }

    return names;
  }

  /*
   * Whether a person's page, read with its run, is open (see
   * OnCallPageMerge's header): not answered, not escalated and not failed,
   * and its notifications still going out, or its run still paging.
   */
  public static isOpen(page: UserOnCallLog): boolean {
    if (page.acknowledgedAt) {
      return false;
    }

    if (
      SENDING_STATUSES.includes(page.status as UserNotificationExecutionStatus)
    ) {
      return true;
    }

    return (
      page.status === UserNotificationExecutionStatus.Completed &&
      PAGING_RUN_STATUSES.includes(
        page.onCallDutyPolicyExecutionLog?.status as OnCallDutyPolicyStatus,
      )
    );
  }

  /*
   * THE OPEN PAGES A LEVEL MERGES ITS PEOPLE'S PAGES INTO, BY PERSON.
   *
   * For a run whose pages may be merged (isOnCallPageMergeable): each of
   * `userIds` who has an open page (isOpen) from another run about the same
   * record, of the same kind, that may stand for theirs here
   * (isOnCallPageACover) - their first, when they have two. A direct page
   * that names nobody who sent it is passed over: the merged page's line
   * would have nobody to name (#8859). Nobody for any other run, a page
   * about no record, or when a read fails.
   */
  @CaptureSpan()
  public static async findCovers(data: {
    projectId: ObjectID;
    executionLogId: ObjectID;
    userNotificationEventType: UserNotificationEventType;
    record: OnCallPageMergeRecordOf;
    userIds: Array<ObjectID>;
  }): Promise<Map<string, OnCallPageCover>> {
    const covers: Map<string, OnCallPageCover> = new Map<
      string,
      OnCallPageCover
    >();

    const record: OnCallPageMergeRecord | null = this.getRecord(data.record);

    if (!record || data.userIds.length === 0) {
      return covers;
    }

    try {
      const run: OnCallDutyPolicyExecutionLog | null =
        await OnCallDutyPolicyExecutionLogService.findOneById({
          id: data.executionLogId,
          select: RUN_KIND_SELECT,
          props: {
            isRoot: true,
          },
        });

      if (!isOnCallPageMergeable(run)) {
        return covers;
      }

      const pages: Array<UserOnCallLog> = await UserOnCallLogService.findBy({
        query: {
          projectId: data.projectId,
          userId: QueryHelper.any(data.userIds),
          [record.column]: record.id,
          status: QueryHelper.any([
            ...SENDING_STATUSES,
            UserNotificationExecutionStatus.Completed,
          ]),
          acknowledgedAt: QueryHelper.isNull(),
        },
        select: COVER_SELECT,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      // The person's first page first.
      const byFirst: Array<UserOnCallLog> = [...pages].sort(
        (a: UserOnCallLog, b: UserOnCallLog): number => {
          return (
            new Date(a.createdAt || 0).getTime() -
            new Date(b.createdAt || 0).getTime()
          );
        },
      );

      const runKey: string = data.executionLogId.toString().toLowerCase();

      // Who sent the pages among them sent from a chat (#8859): one read.
      const pagerNames: Map<string, string> = await this.readPagerNames(pages);

      for (const page of byFirst) {
        if (!page.id || !page.userId || !page.onCallDutyPolicyExecutionLogId) {
          continue;
        }

        const userKey: string = this.getUserKey(page.userId);

        if (covers.has(userKey)) {
          continue;
        }

        // Another run's page: this run's own pages of them are its own.
        if (
          page.onCallDutyPolicyExecutionLogId.toString().toLowerCase() ===
          runKey
        ) {
          continue;
        }

        if (page.userNotificationEventType !== data.userNotificationEventType) {
          continue;
        }

        if (
          !page.onCallDutyPolicyExecutionLog ||
          !isOnCallPageACover(page.onCallDutyPolicyExecutionLog) ||
          !this.isOpen(page)
        ) {
          continue;
        }

        const by: OnCallPageCoverName = this.getCoverName(page, pagerNames);

        if (by.kind !== OnCallPageCoverKind.Policy && !by.name) {
          continue;
        }

        covers.set(userKey, {
          userOnCallLogId: page.id,
          executionLogId: page.onCallDutyPolicyExecutionLogId,
          by: by,
        });
      }

      return covers;
    } catch (err) {
      logger.error(
        `Could not read the open pages execution log ${data.executionLogId.toString()} could merge its pages into; paging everybody as before.`,
        {
          projectId: data.projectId.toString(),
        } as LogAttributes,
      );
      logger.error(
        err as Error,
        {
          projectId: data.projectId.toString(),
        } as LogAttributes,
      );

      return new Map<string, OnCallPageCover>();
    }
  }

  /*
   * WHERE THE PAGE A MERGED PAGE STANDS ON IS, each minute: still open, so
   * the merged page waits; answered by its person, so the merged page is
   * answered with it; or over without their answer, so the merged page
   * takes the page over - counting as sent what the other page sent, unless
   * it failed. A page that cannot be found is over: the merged page pages
   * its person itself, from the start. Throws as the database does: the
   * worker tries again.
   *
   * What the other page is named by, for the line of a take-over: its
   * policy's name as it is now, a workflow's as its run recorded it - and,
   * for a page sent from a chat, or one that is gone, what the merged page's
   * own line named it as it was merged (#8859): nothing more is read for it.
   */
  @CaptureSpan()
  public static async readMergedPage(
    page: UserOnCallLog,
  ): Promise<OnCallMergedPageReading> {
    const cover: UserOnCallLog | null = page.mergedIntoUserOnCallLogId
      ? await UserOnCallLogService.findOneById({
          id: page.mergedIntoUserOnCallLogId,
          select: {
            _id: true,
            status: true,
            acknowledgedAt: true,
            executedNotificationRules: true,
            onCallDutyPolicy: {
              name: true,
            },
            onCallDutyPolicyExecutionLog: COVER_RUN_SELECT,
          },
          props: {
            isRoot: true,
          },
        })
      : null;

    /*
     * Gone, or never named: what the merged page's own line named it by is
     * what the line of its take-over names (#8859).
     */
    if (!cover) {
      return {
        standing: OnCallMergedPageStanding.TakesOver,
        claimsSent: {},
        by: readOnCallPageMergedLine(page.statusMessage),
      };
    }

    const read: OnCallPageCoverName = this.getCoverName(cover);
    const by: OnCallPageCoverName = read.name
      ? read
      : readOnCallPageMergedLine(page.statusMessage) || read;

    if (cover.acknowledgedAt) {
      return {
        standing: OnCallMergedPageStanding.Answered,
        acknowledgedAt: new Date(cover.acknowledgedAt),
        claimsSent: {},
        by: by,
      };
    }

    if (this.isOpen(cover)) {
      return {
        standing: OnCallMergedPageStanding.Waits,
        claimsSent: {},
        by: by,
      };
    }

    return {
      standing: OnCallMergedPageStanding.TakesOver,
      claimsSent:
        cover.status === UserNotificationExecutionStatus.Error
          ? {}
          : {
              ...((cover.executedNotificationRules as JSONObject | undefined) ||
                {}),
            },
      by: by,
    };
  }

  /*
   * A person's merged pages about a record (status Already Paged), to be
   * answered with the page they just answered: every run they stand for is
   * answered by them. Throws as the database does.
   */
  @CaptureSpan()
  public static async findMergedPagesToAnswer(data: {
    // The page's project, when the answer knows it: a record's id names one.
    projectId?: ObjectID | undefined;
    userId: ObjectID;
    record: OnCallPageMergeRecordOf;
  }): Promise<Array<UserOnCallLog>> {
    const record: OnCallPageMergeRecord | null = this.getRecord(data.record);

    if (!record) {
      return [];
    }

    return await UserOnCallLogService.findBy({
      query: {
        ...(data.projectId ? { projectId: data.projectId } : {}),
        userId: data.userId,
        [record.column]: record.id,
        status: UserNotificationExecutionStatus.AlreadyPaged,
      },
      select: {
        _id: true,
        onCallDutyPolicyExecutionLogId: true,
        onCallDutyPolicyExecutionLogTimelineId: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
        triggeredByAlertEpisodeId: true,
        triggeredByIncidentEpisodeId: true,
        userNotificationEventType: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });
  }
}
