import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudOffHoursSchedule from "../../../Models/DatabaseModels/CloudOffHoursSchedule";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudSavingsAction from "../../../Models/DatabaseModels/CloudSavingsAction";
import Label from "../../../Models/DatabaseModels/Label";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_OFF_HOURS_DEFAULT_TIMEZONE,
  CloudOffHoursHours,
  getNextCloudOffHoursChange,
  isWithinCloudWorkingHours,
} from "../../../Types/Cloud/CloudOffHours";
import {
  CloudResourceEnvironment,
  CloudResourceEnvironmentReading,
  CloudResourceEnvironmentReadings,
  getCloudResourceEnvironmentReadings,
  isNonProductionOnlyByLabels,
} from "../../../Types/Cloud/CloudResourceEnvironment";
import {
  CloudSavingsActionKind,
  CloudSavingsActionOrigin,
  CloudSavingsActionStatus,
  CloudSavingsActionUndo,
  CloudSavingsTarget,
  getCloudSavingsActionsAccess,
  isCloudSavingsActionAllowed,
  readAwsSavingsTarget,
  readAzureSavingsTarget,
  readGcpSavingsTarget,
} from "../../../Types/Cloud/CloudSavingsAction";
import {
  CloudOffHoursPreview,
  CloudOffHoursPreviewResource,
  CloudOffHoursSkipReason,
} from "../../../Types/Cloud/CloudSavingsApiTypes";
import { getCloudSavingsScheduledHoursThisMonth } from "../../../Types/Cloud/CloudSavingsMeasure";
import { SAVINGS_ACTIONS_FIELD_KEY } from "../../../Types/CloudConnection/CloudConnectionCatalog";
import ColumnLength from "../../../Types/Database/ColumnLength";
import OneUptimeDate from "../../../Types/Date";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import CloudAccountService from "../../Services/CloudAccountService";
import CloudConnectionService from "../../Services/CloudConnectionService";
import CloudOffHoursScheduleService from "../../Services/CloudOffHoursScheduleService";
import CloudResourceService from "../../Services/CloudResourceService";
import CloudSavingsActionService from "../../Services/CloudSavingsActionService";
import logger from "../Logger";
import CloudSavingsActionRunner, {
  CloudSavingsRunnerOptions,
  clampText,
} from "./CloudSavingsActionRunner";

/*
 * OFF-HOURS SCHEDULES (#11010): stop non-production instances and
 * databases outside working hours, and start them again.
 *
 * Every few minutes each enabled schedule (CloudOffHoursSchedule) is read
 * against its hours (Types/Cloud/CloudOffHours). It acts at the moments
 * its hours change, as AWS's Instance Scheduler does - never in between:
 *
 *   - when working hours end (or the first time it runs outside them), it
 *     stops every running resource its tag picks that is known not to be
 *     production, through the account's connection - one change each, on
 *     the resource's timeline;
 *   - when they begin, it starts again what it stopped itself, and only
 *     that: a resource someone stopped by hand stays stopped, and one
 *     someone started in the evening to work late is not stopped again
 *     until the next evening.
 *
 * A resource it picks that is production, or whose environment nothing
 * says (Types/Cloud/CloudResourceEnvironment), is never stopped: the
 * schedule says so on its page. Its environment is read as a change nobody
 * approves reads it (#11347): non-production only from its cloud tags or
 * its account's setting, so a resource only its OneUptime labels call
 * non-production is left running too, and a label that says production
 * keeps one running. Each stop reads it again when it is made
 * (CloudSavingsActionRunner). Nor is one stopped whose account's
 * connection does not allow Savings actions. A stop that ended saves the
 * hours the resource did not run (CloudSavingsAction.savedHours).
 *
 * A stop is never left for good because its schedule went: a schedule
 * turned off stops nothing more, and starts what it stopped when its
 * working hours begin, as it would have; what a deleted schedule stopped
 * is started at once (startLeftStops).
 */

// The resource types a schedule stops, and the change it makes to each.
export const CLOUD_OFF_HOURS_RESOURCE_TYPES: ReadonlyArray<{
  provider: CloudProvider;
  type: string;
  kind: CloudSavingsActionKind;
}> = [
  {
    provider: CloudProvider.AWS,
    type: "AWS::EC2::Instance",
    kind: CloudSavingsActionKind.StopInstance,
  },
  {
    provider: CloudProvider.AWS,
    type: "AWS::RDS::DBInstance",
    kind: CloudSavingsActionKind.StopDatabase,
  },
  {
    provider: CloudProvider.Azure,
    type: "Microsoft.Compute/virtualMachines",
    kind: CloudSavingsActionKind.StopInstance,
  },
  {
    provider: CloudProvider.GCP,
    type: "gce_instance",
    kind: CloudSavingsActionKind.StopInstance,
  },
];

// The resources a schedule reads in one run, at most.
export const CLOUD_OFF_HOURS_MAX_RESOURCES: number = 500;

// The schedules run in one pass, at most.
export const CLOUD_OFF_HOURS_SCHEDULES_PER_RUN: number = 200;

// What a schedule's run kept, for its page (CloudOffHoursSchedule.lastRunSummary).
export interface CloudOffHoursRunSummary {
  runningNow: boolean;
  matched: number;
  stopped: number;
  started: number;
  skippedProduction: number;
  skippedNotKnown: number;
  skippedNoAccess: number;
  failed: number;
  hoursThisMonth: number;
  nextChangeAt?: string | undefined;
}

// A resource a schedule's tag picks, and what the schedule does with it.
interface PickedResource {
  resource: CloudResource;
  kind: CloudSavingsActionKind;
  target: CloudSavingsTarget | null;
  // Every sign, labels' names included: what the schedule's page shows.
  environment: CloudResourceEnvironmentReading;
  // What the schedule acts on: never a label's non-production (#11347).
  unattendedEnvironment: CloudResourceEnvironmentReading;
  account: CloudAccount | undefined;
  skipReason?: CloudOffHoursSkipReason | undefined;
}

/*
 * Why a schedule leaves a resource running for its environment, or nothing
 * when it may stop it: production on any sign; otherwise it must be known
 * not to be production as a change nobody approves reads it - by its cloud
 * tags or its account's setting, never its labels alone (#11347).
 */
export function getCloudOffHoursEnvironmentSkip(
  readings: CloudResourceEnvironmentReadings,
): CloudOffHoursSkipReason | undefined {
  if (
    readings.reading.environment === CloudResourceEnvironment.Production ||
    readings.unattended.environment === CloudResourceEnvironment.Production
  ) {
    return CloudOffHoursSkipReason.Production;
  }

  if (
    readings.unattended.environment === CloudResourceEnvironment.NonProduction
  ) {
    return undefined;
  }

  return isNonProductionOnlyByLabels(readings.reading)
    ? CloudOffHoursSkipReason.OnlyLabelsSayNonProduction
    : CloudOffHoursSkipReason.EnvironmentNotKnown;
}

const SCHEDULE_SELECT: { [key: string]: true } = {
  _id: true,
  projectId: true,
  name: true,
  isEnabled: true,
  cloudAccountId: true,
  tagKey: true,
  tagValue: true,
  timezone: true,
  workingDays: true,
  startTime: true,
  stopTime: true,
  stopsInstances: true,
  stopsDatabases: true,
  lastRunSummary: true,
};

function hoursOf(schedule: CloudOffHoursSchedule): CloudOffHoursHours {
  return {
    timezone: schedule.timezone || CLOUD_OFF_HOURS_DEFAULT_TIMEZONE,
    workingDays: schedule.workingDays,
    startTime: schedule.startTime || "",
    stopTime: schedule.stopTime || "",
  };
}

// The target a resource is changed at, from the id OneUptime holds it by.
export function readCloudResourceTarget(
  resource: CloudResource,
): CloudSavingsTarget | null {
  const id: string = resource.providerResourceId || "";

  switch (resource.cloudProvider) {
    case CloudProvider.AWS:
      return readAwsSavingsTarget({
        resourceId: id,
        region: resource.cloudRegion || "",
        account: resource.cloudAccountId || "",
      });
    case CloudProvider.Azure:
      return readAzureSavingsTarget(id);
    case CloudProvider.GCP:
      return readGcpSavingsTarget(id);
    default:
      return null;
  }
}

export default class CloudOffHoursScheduler {
  // Every enabled schedule, run. Returns how many acted.
  public static async runAll(
    options: CloudSavingsRunnerOptions = {},
  ): Promise<number> {
    const schedules: Array<CloudOffHoursSchedule> =
      await CloudOffHoursScheduleService.findBy({
        query: { isEnabled: true },
        select: SCHEDULE_SELECT,
        skip: 0,
        limit: CLOUD_OFF_HOURS_SCHEDULES_PER_RUN,
        props: { isRoot: true },
      });
    let acted: number = 0;

    for (const schedule of schedules) {
      try {
        const summary: CloudOffHoursRunSummary | null =
          await CloudOffHoursScheduler.runSchedule({ schedule, options });

        if (summary && (summary.stopped > 0 || summary.started > 0)) {
          acted++;
        }
      } catch (error) {
        logger.error(
          `Off-hours schedule ${schedule.id?.toString()} could not run: ${error}`,
        );
      }
    }

    try {
      acted += await CloudOffHoursScheduler.startLeftStops(options);
    } catch (error) {
      logger.error(
        `Off-hours schedules: stops whose schedule went could not be started: ${error}`,
      );
    }

    return acted;
  }

  /*
   * The stops no enabled schedule will start: those of a schedule turned
   * off, started when its working hours begin, and those of a deleted
   * schedule, started at once. Returns how many were started.
   */
  public static async startLeftStops(
    options: CloudSavingsRunnerOptions = {},
  ): Promise<number> {
    const now: Date = options.now || OneUptimeDate.getCurrentDate();
    let started: number = 0;

    const orphans: Array<CloudSavingsAction> =
      await CloudSavingsActionService.findBy({
        query: {
          origin: CloudSavingsActionOrigin.Schedule,
          status: CloudSavingsActionStatus.Applied,
          cloudOffHoursScheduleId: new IsNull(),
        },
        select: { _id: true },
        skip: 0,
        limit: CLOUD_OFF_HOURS_MAX_RESOURCES,
        props: { isRoot: true },
      });

    started += await CloudOffHoursScheduler.startStops({
      stops: orphans,
      now,
      options,
    });

    const turnedOff: Array<CloudOffHoursSchedule> =
      await CloudOffHoursScheduleService.findBy({
        query: { isEnabled: false },
        select: SCHEDULE_SELECT,
        skip: 0,
        limit: CLOUD_OFF_HOURS_SCHEDULES_PER_RUN,
        props: { isRoot: true },
      });

    for (const schedule of turnedOff) {
      if (!schedule.id || !isWithinCloudWorkingHours(hoursOf(schedule), now)) {
        continue;
      }

      started += await CloudOffHoursScheduler.startStops({
        stops: await CloudOffHoursScheduler.readStops(schedule),
        now,
        options,
      });
    }

    return started;
  }

  // The stops a schedule made that still stand.
  private static async readStops(
    schedule: CloudOffHoursSchedule,
  ): Promise<Array<CloudSavingsAction>> {
    return await CloudSavingsActionService.findBy({
      query: {
        projectId: schedule.projectId!,
        cloudOffHoursScheduleId: schedule.id!,
        origin: CloudSavingsActionOrigin.Schedule,
        status: CloudSavingsActionStatus.Applied,
      },
      select: { _id: true },
      skip: 0,
      limit: CLOUD_OFF_HOURS_MAX_RESOURCES,
      props: { isRoot: true },
    });
  }

  /*
   * Starts each stop again: claimed (Applied to Undoing) so a person's
   * Undo at the same moment and this never both act, then stepped.
   * Returns how many started, or are starting.
   */
  private static async startStops(data: {
    stops: Array<CloudSavingsAction>;
    now: Date;
    options: CloudSavingsRunnerOptions;
    summary?: CloudOffHoursRunSummary | undefined;
  }): Promise<number> {
    let started: number = 0;

    for (const stop of data.stops) {
      if (!stop.id) {
        continue;
      }

      const claimed: number = await CloudSavingsActionService.attemptTransition(
        {
          actionId: stop.id,
          fromStatuses: [CloudSavingsActionStatus.Applied],
          set: {
            status: CloudSavingsActionStatus.Undoing,
            undoProgress: { from: CloudSavingsActionStatus.Applied },
            nextStepAt: data.now,
          },
        },
      );

      if (claimed === 0) {
        continue;
      }

      await CloudSavingsActionRunner.advance(stop.id, data.options);

      const after: CloudSavingsAction | null =
        await CloudSavingsActionService.findOneById({
          id: stop.id,
          select: { status: true },
          props: { isRoot: true },
        });

      if (
        after?.status === CloudSavingsActionStatus.Ended ||
        after?.status === CloudSavingsActionStatus.Undoing
      ) {
        started++;

        if (data.summary) {
          data.summary.started++;
        }
      } else if (data.summary) {
        data.summary.failed++;
      }
    }

    return started;
  }

  /*
   * The resources a schedule's tag picks, each with whether the schedule
   * stops it, and why not.
   */
  public static async pick(data: {
    schedule: CloudOffHoursSchedule;
  }): Promise<{ picked: Array<PickedResource>; isCapped: boolean }> {
    const schedule: CloudOffHoursSchedule = data.schedule;
    const projectId: ObjectID = schedule.projectId!;
    const accounts: Array<CloudAccount> = await CloudAccountService.findBy({
      query: {
        projectId,
        ...(schedule.cloudAccountId ? { _id: schedule.cloudAccountId } : {}),
      },
      select: {
        _id: true,
        provider: true,
        accountId: true,
        environment: true,
        cloudConnectionId: true,
      },
      skip: 0,
      limit: 1000,
      props: { isRoot: true },
    });
    const accountByKey: Map<string, CloudAccount> = new Map();

    for (const account of accounts) {
      accountByKey.set(
        `${account.provider}|${(account.accountId || "").toLowerCase()}`,
        account,
      );
    }

    const types: Array<string> = CLOUD_OFF_HOURS_RESOURCE_TYPES.filter(
      (entry: { kind: CloudSavingsActionKind }): boolean => {
        return entry.kind === CloudSavingsActionKind.StopDatabase
          ? schedule.stopsDatabases !== false
          : schedule.stopsInstances !== false;
      },
    ).map((entry: { type: string }): string => {
      return entry.type;
    });

    if (types.length === 0 || accounts.length === 0) {
      return { picked: [], isCapped: false };
    }

    const resources: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId,
        isArchived: false,
        cloudResourceType: new Includes(types),
      },
      select: {
        _id: true,
        name: true,
        cloudProvider: true,
        cloudResourceType: true,
        cloudAccountId: true,
        cloudRegion: true,
        providerResourceId: true,
        cloudTags: true,
        labels: { name: true },
      },
      skip: 0,
      limit: CLOUD_OFF_HOURS_MAX_RESOURCES * 4,
      props: { isRoot: true },
    });
    const connections: Map<string, CloudConnection | null> = new Map();
    const picked: Array<PickedResource> = [];
    const tagKey: string = (schedule.tagKey || "").trim().toLowerCase();
    const tagValue: string = (schedule.tagValue || "").trim();

    for (const resource of resources) {
      const tags: Record<string, string> = resource.cloudTags || {};
      const value: string | undefined = Object.entries(tags).find(
        ([key]: [string, string]): boolean => {
          return key.trim().toLowerCase() === tagKey;
        },
      )?.[1];

      if (value === undefined || value.trim() !== tagValue) {
        continue;
      }

      const account: CloudAccount | undefined = accountByKey.get(
        `${resource.cloudProvider}|${(resource.cloudAccountId || "").toLowerCase()}`,
      );

      // A resource of another account than the schedule's.
      if (!account) {
        continue;
      }

      if (picked.length >= CLOUD_OFF_HOURS_MAX_RESOURCES) {
        return { picked, isCapped: true };
      }

      const kind: CloudSavingsActionKind =
        CLOUD_OFF_HOURS_RESOURCE_TYPES.find(
          (entry: { type: string }): boolean => {
            return entry.type === resource.cloudResourceType;
          },
        )?.kind || CloudSavingsActionKind.StopInstance;
      const readings: CloudResourceEnvironmentReadings =
        getCloudResourceEnvironmentReadings({
          tags,
          accountEnvironment: account.environment,
          labelNames: (resource.labels || []).map(
            (label: Label): string | undefined => {
              return label.name;
            },
          ),
        });
      const connection: CloudConnection | null =
        await CloudOffHoursScheduler.readConnection(account, connections);
      const allowed: boolean =
        Boolean(connection?.id) &&
        connection?.isEnabled !== false &&
        isCloudSavingsActionAllowed(
          getCloudSavingsActionsAccess(
            connection?.config
              ? connection.config[SAVINGS_ACTIONS_FIELD_KEY]
              : undefined,
          ),
          kind,
        );
      const target: CloudSavingsTarget | null =
        readCloudResourceTarget(resource);
      const skipReason: CloudOffHoursSkipReason | undefined =
        getCloudOffHoursEnvironmentSkip(readings) ||
        (!allowed || !target
          ? CloudOffHoursSkipReason.SavingsActionsOff
          : undefined);

      picked.push({
        resource,
        kind,
        target,
        environment: readings.reading,
        unattendedEnvironment: readings.unattended,
        account,
        ...(skipReason ? { skipReason } : {}),
      });
    }

    return { picked, isCapped: false };
  }

  private static async readConnection(
    account: CloudAccount,
    cache: Map<string, CloudConnection | null>,
  ): Promise<CloudConnection | null> {
    const key: string = account.cloudConnectionId?.toString() || "";

    if (!key) {
      return null;
    }

    if (!cache.has(key)) {
      cache.set(
        key,
        await CloudConnectionService.findOneById({
          id: account.cloudConnectionId!,
          select: { _id: true, config: true, isEnabled: true },
          props: { isRoot: true },
        }),
      );
    }

    return cache.get(key) || null;
  }

  // What a schedule picks now, for its page: never changes anything.
  public static async preview(data: {
    projectId: ObjectID;
    scheduleId: ObjectID;
    now: Date;
  }): Promise<CloudOffHoursPreview> {
    const schedule: CloudOffHoursSchedule | null =
      await CloudOffHoursScheduleService.findOneBy({
        query: { _id: data.scheduleId, projectId: data.projectId },
        select: SCHEDULE_SELECT,
        props: { isRoot: true },
      });

    if (!schedule?.id) {
      throw new NotFoundException("This schedule was not found.");
    }

    const { picked, isCapped } = await CloudOffHoursScheduler.pick({
      schedule,
    });
    const next: { at: Date; running: boolean } | null =
      getNextCloudOffHoursChange(hoursOf(schedule), data.now);

    return {
      resources: picked.map(
        (entry: PickedResource): CloudOffHoursPreviewResource => {
          return {
            cloudResourceId: entry.resource.id!.toString(),
            name:
              entry.resource.name || entry.resource.providerResourceId || "",
            resourceType: entry.resource.cloudResourceType || "",
            provider: entry.resource.cloudProvider as CloudProvider,
            environment: entry.environment.environment,
            ...(entry.skipReason ? { skipReason: entry.skipReason } : {}),
          };
        },
      ),
      runningNow: isWithinCloudWorkingHours(hoursOf(schedule), data.now),
      ...(next ? { nextChangeAt: next.at.toISOString() } : {}),
      isCapped,
    };
  }

  /*
   * A schedule's run: at the moment its hours change, it stops or starts
   * what it picks; in between, it only keeps its page's summary.
   */
  public static async runSchedule(data: {
    schedule: CloudOffHoursSchedule;
    options?: CloudSavingsRunnerOptions | undefined;
  }): Promise<CloudOffHoursRunSummary | null> {
    const schedule: CloudOffHoursSchedule = data.schedule;
    const options: CloudSavingsRunnerOptions = data.options || {};
    const now: Date = options.now || OneUptimeDate.getCurrentDate();

    if (!schedule.id || !schedule.projectId) {
      return null;
    }

    // A schedule turned off is startLeftStops' to finish.
    if (schedule.isEnabled === false) {
      return null;
    }

    const hours: CloudOffHoursHours = hoursOf(schedule);
    const runningNow: boolean = isWithinCloudWorkingHours(hours, now);
    const last: JSONObject = (schedule.lastRunSummary || {}) as JSONObject;
    const wasRunning: boolean | undefined =
      typeof last["runningNow"] === "boolean"
        ? (last["runningNow"] as boolean)
        : undefined;
    const summary: CloudOffHoursRunSummary = {
      runningNow,
      matched: Number(last["matched"]) || 0,
      stopped: 0,
      started: 0,
      skippedProduction: Number(last["skippedProduction"]) || 0,
      skippedNotKnown: Number(last["skippedNotKnown"]) || 0,
      skippedNoAccess: Number(last["skippedNoAccess"]) || 0,
      failed: 0,
      hoursThisMonth: 0,
    };

    // Working hours ended (or the schedule's first run is outside them): stop.
    if (!runningNow && wasRunning !== false) {
      await CloudOffHoursScheduler.stopPicked({
        schedule,
        summary,
        now,
        options,
      });
    }

    // Working hours began: start what this schedule stopped.
    if (runningNow && wasRunning === false) {
      await CloudOffHoursScheduler.startStopped({
        schedule,
        summary,
        now,
        options,
      });
    }

    summary.hoursThisMonth = await CloudOffHoursScheduler.getHoursThisMonth({
      scheduleId: schedule.id,
      now,
    });

    const next: { at: Date; running: boolean } | null =
      getNextCloudOffHoursChange(hours, now);

    if (next) {
      summary.nextChangeAt = next.at.toISOString();
    }

    await CloudOffHoursScheduleService.updateOneById({
      id: schedule.id,
      data: {
        lastRunAt: now,
        lastRunSummary: summary as unknown as JSONObject,
      } as never,
      props: { isRoot: true, ignoreHooks: true },
    });

    return summary;
  }

  private static async stopPicked(data: {
    schedule: CloudOffHoursSchedule;
    summary: CloudOffHoursRunSummary;
    now: Date;
    options: CloudSavingsRunnerOptions;
  }): Promise<void> {
    const { picked } = await CloudOffHoursScheduler.pick({
      schedule: data.schedule,
    });

    data.summary.matched = picked.length;
    data.summary.skippedProduction = 0;
    data.summary.skippedNotKnown = 0;
    data.summary.skippedNoAccess = 0;

    for (const entry of picked) {
      if (entry.skipReason === CloudOffHoursSkipReason.Production) {
        data.summary.skippedProduction++;
        continue;
      }

      // Nothing a schedule reads says it is not production: its labels alone do not.
      if (
        entry.skipReason === CloudOffHoursSkipReason.EnvironmentNotKnown ||
        entry.skipReason === CloudOffHoursSkipReason.OnlyLabelsSayNonProduction
      ) {
        data.summary.skippedNotKnown++;
        continue;
      }

      if (entry.skipReason || !entry.target || !entry.account?.id) {
        data.summary.skippedNoAccess++;
        continue;
      }

      /*
       * A resource being changed - by anyone - or already stopped by a
       * schedule is left to that change.
       */
      const changing: CloudSavingsAction | null =
        await CloudSavingsActionService.findOneBy({
          query: {
            projectId: data.schedule.projectId!,
            cloudResourceId: entry.resource.id!,
            status: new Includes([
              CloudSavingsActionStatus.Applying,
              CloudSavingsActionStatus.Undoing,
            ]),
          },
          select: { _id: true },
          props: { isRoot: true },
        });
      const stoppedByASchedule: CloudSavingsAction | null = changing?.id
        ? null
        : await CloudSavingsActionService.findOneBy({
            query: {
              projectId: data.schedule.projectId!,
              cloudResourceId: entry.resource.id!,
              status: CloudSavingsActionStatus.Applied,
              origin: CloudSavingsActionOrigin.Schedule,
            },
            select: { _id: true },
            props: { isRoot: true },
          });

      if (changing?.id || stoppedByASchedule?.id) {
        continue;
      }

      const action: CloudSavingsAction = new CloudSavingsAction();
      action.projectId = data.schedule.projectId!;
      action.cloudAccountId = entry.account.id;

      if (entry.account.cloudConnectionId) {
        action.cloudConnectionId = entry.account.cloudConnectionId;
      }

      action.cloudResourceId = entry.resource.id!;
      action.cloudOffHoursScheduleId = data.schedule.id!;
      action.provider = entry.resource.cloudProvider as CloudProvider;
      action.kind = entry.kind;
      action.status = CloudSavingsActionStatus.Applying;
      action.origin = CloudSavingsActionOrigin.Schedule;
      action.environment = entry.environment.environment;
      action.resourceId = clampText(
        entry.resource.providerResourceId || "",
        ColumnLength.LongText,
      );
      action.resourceName = clampText(
        entry.resource.name || entry.target.id,
        ColumnLength.ShortText,
      );
      action.resourceType = clampText(
        entry.resource.cloudResourceType || "",
        ColumnLength.ShortText,
      );
      action.region = clampText(
        entry.resource.cloudRegion || "",
        ColumnLength.ShortText,
      );
      action.finalSnapshot = false;
      action.undo = CloudSavingsActionUndo.Undoable;
      action.monthlySavings = 0;
      action.currency = "USD";
      action.target = entry.target as unknown as JSONObject;
      action.progress = {};
      action.undoProgress = {};
      action.nextStepAt = data.now;

      const created: CloudSavingsAction =
        await CloudSavingsActionService.create({
          data: action,
          props: { isRoot: true },
        });

      await CloudSavingsActionRunner.advance(created.id!, data.options);

      const after: CloudSavingsAction | null =
        await CloudSavingsActionService.findOneById({
          id: created.id!,
          select: { status: true, environment: true },
          props: { isRoot: true },
        });

      if (after?.status === CloudSavingsActionStatus.Failed) {
        data.summary.failed++;
      } else if (
        after?.status === CloudSavingsActionStatus.Applied ||
        after?.status === CloudSavingsActionStatus.Applying
      ) {
        data.summary.stopped++;
      } else if (
        after?.status === CloudSavingsActionStatus.Expired &&
        after.environment !== CloudResourceEnvironment.NonProduction
      ) {
        /*
         * Read again as it was about to be stopped, it was no longer known
         * not to be production: the runner keeps what it read then. A stop
         * of something already stopped expires with the environment it was
         * made with: non-production.
         */
        if (after.environment === CloudResourceEnvironment.Production) {
          data.summary.skippedProduction++;
        } else {
          data.summary.skippedNotKnown++;
        }
      }
    }
  }

  private static async startStopped(data: {
    schedule: CloudOffHoursSchedule;
    summary: CloudOffHoursRunSummary;
    now: Date;
    options: CloudSavingsRunnerOptions;
  }): Promise<void> {
    await CloudOffHoursScheduler.startStops({
      stops: await CloudOffHoursScheduler.readStops(data.schedule),
      now: data.now,
      options: data.options,
      summary: data.summary,
    });
  }

  // The hours the schedule's stops stand for this month, ended or standing.
  public static async getHoursThisMonth(data: {
    scheduleId: ObjectID;
    now: Date;
  }): Promise<number> {
    const stops: Array<CloudSavingsAction> =
      await CloudSavingsActionService.findBy({
        query: {
          cloudOffHoursScheduleId: data.scheduleId,
          status: new Includes([
            CloudSavingsActionStatus.Applied,
            CloudSavingsActionStatus.Undoing,
            CloudSavingsActionStatus.Ended,
          ]),
        },
        select: { appliedAt: true, endedAt: true },
        skip: 0,
        limit: 5000,
        props: { isRoot: true },
      });
    let hours: number = 0;

    for (const stop of stops) {
      if (!stop.appliedAt) {
        continue;
      }

      hours += getCloudSavingsScheduledHoursThisMonth({
        appliedAt: new Date(stop.appliedAt),
        endedAt: stop.endedAt ? new Date(stop.endedAt) : null,
        now: data.now,
      });
    }

    return Math.round(hours * 10) / 10;
  }
}
