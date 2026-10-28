import { jest } from "@jest/globals";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicyUserOverride from "../../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleService, {
  CurrentOnCallInSchedule,
  NextInRotationInSchedule,
} from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyUserOverrideService from "../../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import UserNotificationRuleService from "../../../../Server/Services/UserNotificationRuleService";
import ProjectMembership from "../../../../Server/Utils/TeamMember/ProjectMembership";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../../Types/UserNotification/UserNotificationExecutionStatus";
import PassOnWorld, {
  INCIDENT_ID,
  NAMES,
  POLICY_ID,
  PROJECT_ID,
  RUN_ID,
  RuleSetup,
} from "./PassOnWorld";

/*
 * AN ON-CALL POLICY WITH LEVELS THAT HAVE NOBODY TO PAGE, IN MEMORY, DRIVEN
 * THROUGH THE REAL CODE (Types/OnCallDutyPolicy/OnCallEmptyLevel).
 *
 * PassOnWorld's run - its timeline, its people's logs, its rules and the
 * one claim that moves it on - with everything a level can find nobody in:
 * schedules (somebody on call, nobody on call, nobody next in the
 * rotation), people away with nobody named to cover, people who have left
 * the project, and people a page cannot reach - opted out of the severity,
 * or with no way to be reached at all, which their own notification log
 * writes onto their line as the page goes out (UserOnCallLogService).
 *
 * Runs start as OneUptime starts them (OnCallDutyPolicyExecutionLogService:
 * a run created for its record, a run that waited for working hours, a page
 * again), so what happens at the first level - moving on at once from it -
 * is the service's own. The clock is the world's: nothing waits, and every
 * page records the minute it went out.
 */

export const ALERT_ID: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-000000000010",
);
export const ALERT_EPISODE_ID: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-000000000011",
);
export const INCIDENT_EPISODE_ID: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-000000000012",
);

export const PRIMARY: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000005a1",
);
export const SECONDARY: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000005b1",
);
export const EMPTY_TEAM: ObjectID = new ObjectID(
  "0f500000-0000-4000-8000-0000000006a1",
);

// How a person's page goes, once it is sent to them.
export enum Reach {
  // It goes out: their own rules, or the fallback, send it.
  Reachable = "Reachable",
  // Nothing can carry it: no rule for the severity, no verified method.
  NoWayToReach = "NoWayToReach",
  // They turned this severity off for themselves.
  OptedOut = "OptedOut",
}

// What a person's log writes onto their line, for a page that cannot go out.
export const NO_WAY_TO_REACH_MESSAGE: string =
  "This responder has no verified notification method, so this page could not be delivered. Ask them to add one in User Settings > Notification Methods.";
export const OPTED_OUT_MESSAGE: string =
  "You have opted out of notifications for Sev4 incidents.";

// What a run is about: an incident, an alert, or an episode of either.
export enum Trigger {
  Incident = "incident",
  Alert = "alert",
  AlertEpisode = "alert episode",
  IncidentEpisode = "incident episode",
}

export interface LevelSetup extends RuleSetup {
  // Schedules whose on-call person it pages, or the next in their rotation.
  schedules?:
    | Array<{ scheduleId: ObjectID; nextInRotation?: boolean | undefined }>
    | undefined;
}

// A page as it was sent: to whom, by which rule, about what, and when.
export interface SentPage {
  userId: string;
  ruleId: string | null;
  eventType: UserNotificationEventType | undefined;
  at: Date;
}

type AnyFunction = (...args: Array<any>) => any;

export default class EmptyLevelWorld extends PassOnWorld {
  public ruleSchedules: Record<
    string,
    Array<{ scheduleId: ObjectID; pageNextInRotation: boolean }>
  > = {};
  // Whoever is on call in a schedule now; null (or absent) for nobody.
  public onCall: Record<string, CurrentOnCallInSchedule | null> = {};
  // The next person in a schedule's rotation; null (or absent) for nobody on call.
  public nextInRotation: Record<string, NextInRotationInSchedule | null> = {};
  // People away with nobody named to cover, until when.
  public away: Record<string, Date> = {};
  // The project's members: null for everybody the world knows.
  public members: Set<string> | null = null;
  // How each person's page goes; Reachable when not said.
  public reach: Record<string, Reach> = {};
  public sent: Array<SentPage> = [];
  // Called as each line of the run's timeline is written.
  public onLineWritten:
    | ((line: OnCallDutyPolicyExecutionLogTimeline) => void)
    | null = null;

  public override install(): void {
    super.install();

    this.installSchedules();
    this.installAway();
    this.installMembers();
    this.installReach();
    this.installLineHook();
    this.installRunStarts();
  }

  private installSchedules(): void {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockImplementation((async (data: {
        query: Record<string, unknown>;
      }) => {
        const ruleId: string = String(
          data.query["onCallDutyPolicyEscalationRuleId"],
        );

        return (this.ruleSchedules[ruleId] || []).map(
          (row: { scheduleId: ObjectID; pageNextInRotation: boolean }) => {
            return {
              onCallDutyPolicyScheduleId: row.scheduleId,
              pageNextInRotation: row.pageNextInRotation,
            };
          },
        );
      }) as never);

    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getCurrentOnCallInSchedule")
      .mockImplementation((async (scheduleId: ObjectID) => {
        return this.onCall[scheduleId.toString()] || null;
      }) as never);

    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getNextInRotationInSchedule")
      .mockImplementation((async (scheduleId: ObjectID) => {
        return this.nextInRotation[scheduleId.toString()] || null;
      }) as never);
  }

  // Away with nobody named to cover: a user override that skips them.
  private installAway(): void {
    jest
      .spyOn(OnCallDutyPolicyUserOverrideService, "findBy")
      .mockImplementation((async (data: {
        query: Record<string, unknown>;
      }) => {
        const userId: string = String(data.query["overrideUserId"] || "");
        const until: Date | undefined = this.away[userId];

        if (!until) {
          return [];
        }

        const override: OnCallDutyPolicyUserOverride =
          new OnCallDutyPolicyUserOverride();
        override.startsAt = new Date(this.clock.getTime() - 60 * 60 * 1000);
        override.endsAt = until;

        return [override];
      }) as never);
  }

  private installMembers(): void {
    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation((async (data: { userIds: Array<ObjectID> }) => {
        return new Set<string>(
          data.userIds
            .map((userId: ObjectID): string => {
              return userId.toString().toLowerCase();
            })
            .filter((userId: string): boolean => {
              return !this.members || this.members.has(userId);
            }),
        );
      }) as never);
  }

  /*
   * A page, as a person's notification log carries it out: PassOnWorld's
   * log is written, and a page that cannot go out says so on the person's
   * line straight away, as UserOnCallLogService does as the log is created.
   */
  private installReach(): void {
    const base: AnyFunction | undefined = (
      UserNotificationRuleService.startUserNotificationRulesExecution as unknown as {
        getMockImplementation: () => AnyFunction | undefined;
      }
    ).getMockImplementation();

    jest
      .spyOn(UserNotificationRuleService, "startUserNotificationRulesExecution")
      .mockImplementation((async (
        userId: ObjectID,
        options: {
          userNotificationEventType: UserNotificationEventType;
          onCallPolicyEscalationRuleId?: ObjectID | undefined;
          onCallDutyPolicyExecutionLogTimelineId: ObjectID;
        },
      ) => {
        await base!(userId, options);

        this.sent.push({
          userId: userId.toString(),
          ruleId: options.onCallPolicyEscalationRuleId?.toString() || null,
          eventType: options.userNotificationEventType,
          at: new Date(this.clock),
        });

        const reach: Reach = this.reach[userId.toString()] || Reach.Reachable;

        if (reach === Reach.Reachable) {
          return;
        }

        const log: UserOnCallLog | undefined = this.logs[this.logs.length - 1];
        const line: OnCallDutyPolicyExecutionLogTimeline | undefined =
          this.steps.find((step: OnCallDutyPolicyExecutionLogTimeline) => {
            return (
              step.id?.toString() ===
              options.onCallDutyPolicyExecutionLogTimelineId.toString()
            );
          });

        if (reach === Reach.NoWayToReach) {
          log!.status = UserNotificationExecutionStatus.Error;
          line!.status = OnCallDutyExecutionLogTimelineStatus.Error;
          line!.statusMessage = NO_WAY_TO_REACH_MESSAGE;
          return;
        }

        log!.status = UserNotificationExecutionStatus.Completed;
        line!.status = OnCallDutyExecutionLogTimelineStatus.Skipped;
        line!.statusMessage = OPTED_OUT_MESSAGE;
      }) as never);
  }

  private installLineHook(): void {
    const base: AnyFunction | undefined = (
      OnCallDutyPolicyExecutionLogTimelineService.create as unknown as {
        getMockImplementation: () => AnyFunction | undefined;
      }
    ).getMockImplementation();

    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "create")
      .mockImplementation((async (data: {
        data: OnCallDutyPolicyExecutionLogTimeline;
      }) => {
        const line: OnCallDutyPolicyExecutionLogTimeline = await base!(data);

        if (this.onLineWritten) {
          this.onLineWritten(line);
        }

        return line;
      }) as never);
  }

  /*
   * What starting a run reads and writes beyond its own row: the policy,
   * for a link in the record's feed (none here: the feed is the timeline
   * service's, tested on its own), a page again's run created, and a
   * waiting run's claim to start - one atomic UPDATE in Postgres.
   */
  private installRunStarts(): void {
    jest
      .spyOn(OnCallDutyPolicyService, "findOneById")
      .mockResolvedValue(null as never);

    jest
      .spyOn(OnCallDutyPolicyExecutionLogService, "create")
      .mockImplementation((async (data: {
        data: OnCallDutyPolicyExecutionLog;
      }) => {
        const run: OnCallDutyPolicyExecutionLog = data.data;
        run.id = RUN_ID;
        run.createdAt = new Date(this.clock);
        run.onCallPolicyExecutionRepeatCount = 1;
        run.onCallDutyPolicy = this.getPolicySettings();
        this.runs.push(run);

        return run;
      }) as never);

    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService as unknown as Record<
          string,
          AnyFunction
        >,
        "claimWaitingRun",
      )
      .mockImplementation((async (data: {
        executionLogId: ObjectID;
        status: OnCallDutyPolicyStatus;
        statusMessage: string;
      }) => {
        const run: OnCallDutyPolicyExecutionLog | undefined = this.runs.find(
          (candidate: OnCallDutyPolicyExecutionLog) => {
            return candidate.id?.toString() === data.executionLogId.toString();
          },
        );

        if (!run || run.status !== OnCallDutyPolicyStatus.Waiting) {
          return false;
        }

        run.status = data.status;
        run.statusMessage = data.statusMessage;
        this.runStatuses.push(data.status);

        return true;
      }) as never);
  }

  private getPolicySettings(): OnCallDutyPolicyExecutionLog["onCallDutyPolicy"] {
    return {
      name: "Payments",
      repeatPolicyIfNoOneAcknowledges: this.repeatsAllowed > 0,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: this.repeatsAllowed,
    } as never;
  }

  // ---- building the policy --------------------------------------------

  public addLevel(setup: LevelSetup): OnCallDutyPolicyEscalationRule {
    const rule: OnCallDutyPolicyEscalationRule = this.addRule(setup);

    this.ruleSchedules[rule.id!.toString()] = (setup.schedules || []).map(
      (row: { scheduleId: ObjectID; nextInRotation?: boolean | undefined }) => {
        return {
          scheduleId: row.scheduleId,
          pageNextInRotation: Boolean(row.nextInRotation),
        };
      },
    );

    return rule;
  }

  // ---- running it -------------------------------------------------------

  // A new run of the policy, for a record, not started yet.
  public newRun(
    trigger: Trigger = Trigger.Incident,
  ): OnCallDutyPolicyExecutionLog {
    const run: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    run.id = RUN_ID;
    run.projectId = PROJECT_ID;
    run.onCallDutyPolicyId = POLICY_ID;
    run.status = OnCallDutyPolicyStatus.Scheduled;
    run.onCallPolicyExecutionRepeatCount = 1;
    run.createdAt = new Date(this.clock);
    run.onCallDutyPolicy = this.getPolicySettings();

    switch (trigger) {
      case Trigger.Alert:
        run.triggeredByAlertId = ALERT_ID;
        run.userNotificationEventType = UserNotificationEventType.AlertCreated;
        break;
      case Trigger.AlertEpisode:
        run.triggeredByAlertEpisodeId = ALERT_EPISODE_ID;
        run.userNotificationEventType =
          UserNotificationEventType.AlertEpisodeCreated;
        break;
      case Trigger.IncidentEpisode:
        run.triggeredByIncidentEpisodeId = INCIDENT_EPISODE_ID;
        run.userNotificationEventType =
          UserNotificationEventType.IncidentEpisodeCreated;
        break;
      case Trigger.Incident:
      default:
        run.triggeredByIncidentId = INCIDENT_ID;
        run.userNotificationEventType =
          UserNotificationEventType.IncidentCreated;
        break;
    }

    this.runs.push(run);

    return run;
  }

  /*
   * A run started as OneUptime starts one once it is created - by hand, by
   * its incident, alert or episode, by a workflow: its first rule pages,
   * and the service moves it on from there if that rule reached nobody.
   */
  public async startAsOneUptimeDoes(
    trigger: Trigger = Trigger.Incident,
  ): Promise<void> {
    const run: OnCallDutyPolicyExecutionLog = this.newRun(trigger);

    await (
      OnCallDutyPolicyExecutionLogService as unknown as Record<
        string,
        AnyFunction
      >
    )["startFirstEscalationRule"]!.call(OnCallDutyPolicyExecutionLogService, run);
  }

  // A run that waited for working hours, starting now that they began.
  public async startWaitingRun(): Promise<boolean> {
    const run: OnCallDutyPolicyExecutionLog = this.newRun();
    run.status = OnCallDutyPolicyStatus.Waiting;

    return await OnCallDutyPolicyExecutionLogService.startWaitingRun({
      run: run,
      now: new Date(this.clock),
    });
  }

  // A page again about an incident acknowledged by `acknowledgedBy`.
  public async startPageAgain(data: {
    startAtRule: OnCallDutyPolicyEscalationRule;
    acknowledgedBy: ObjectID;
  }): Promise<void> {
    await OnCallDutyPolicyExecutionLogService.startPageAgain({
      projectId: PROJECT_ID,
      onCallDutyPolicyId: POLICY_ID,
      triggeredByIncidentId: INCIDENT_ID,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
      pageAgainNumber: 1,
      minutes: 30,
      recordKind: "incident",
      startAtRuleId: data.startAtRule.id!,
      acknowledgedByUserId: data.acknowledgedBy,
    });
  }

  // ---- reading what happened -------------------------------------------

  // Every page sent, by person and minute since the start: "Bob Smith @ 0".
  public sentAt(start: Date): Array<string> {
    return this.sent.map((page: SentPage): string => {
      return `${this.nameOf(page.userId)} @ ${Math.round(
        (page.at.getTime() - start.getTime()) / 60000,
      )}`;
    });
  }

  // The run's timeline lines a level wrote about itself and about nobody.
  public linesAbout(
    rule: OnCallDutyPolicyEscalationRule,
  ): Array<{ status: string; message: string; person: string | null }> {
    return this.steps
      .filter((step: OnCallDutyPolicyExecutionLogTimeline) => {
        return (
          step.onCallDutyPolicyEscalationRuleId?.toString() ===
          rule.id!.toString()
        );
      })
      .map((step: OnCallDutyPolicyExecutionLogTimeline) => {
        return {
          status: String(step.status),
          message: step.statusMessage || "",
          person: step.alertSentToUserId
            ? this.nameOf(step.alertSentToUserId.toString())
            : null,
        };
      });
  }

  public nameOf(userId: string): string {
    return NAMES[userId.toLowerCase()] || userId;
  }
}
