import RunCron from "../../Utils/Cron";
import { forEachKeysetPage } from "../../Utils/BatchedWork";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import User from "Common/Models/DatabaseModels/User";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import { AppVersion } from "Common/Server/EnvironmentConfig";
import ProbeService from "Common/Server/Services/ProbeService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import ProbeMajorReleaseNotification, {
  ProbeMajorReleaseNotificationContent,
} from "Common/Server/Utils/Probe/ProbeMajorReleaseNotification";
import { DocsRoute } from "Common/ServiceRoute";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import ObjectID from "Common/Types/ObjectID";
import ProbeMajorReleaseNoticeUtil, {
  ProbeMajorReleaseNoticeAction,
  ProbeMajorReleaseNoticeDecision,
  ProbeMajorReleaseNoticeRead,
  readNotifiedFor,
} from "Common/Types/Probe/ProbeMajorReleaseNotice";
import ProbeReportedVersionUtil, {
  ProbeFeature,
  ProbeMajorReleaseLag,
  UPDATE_A_PROBE_DOCS_PATH,
} from "Common/Types/Probe/ProbeReportedVersion";
import { EVERY_DAY } from "Common/Utils/CronTime";
import VersionUtil, { ParsedVersion } from "Common/Utils/VersionUtil";

/*
 * TELLING A CUSTOM PROBE'S OWNERS ONCE WHEN IT FALLS A MAJOR RELEASE BEHIND
 * THE ONEUPTIME IT REPORTS TO (OneUptime issue #9977).
 *
 * Once a day, every connected custom probe, a page at a time, is read
 * against this OneUptime's release (APP_VERSION), by the rules
 * Types/Probe/ProbeMajorReleaseNotice keeps:
 *
 *   - one a major release or more behind, whose owners were not told of
 *     OneUptime's major release yet, has them told - which probe, how far
 *     behind it is, what it misses until it is updated and how to update it
 *     (Server/Utils/Probe/ProbeMajorReleaseNotification) - and that release
 *     kept on it (Probe.majorVersionBehindNotifiedFor), so it is not told of
 *     again the next day;
 *   - one that runs OneUptime's major release again has what was told
 *     forgotten, so it is told again when it next falls behind;
 *   - nothing at all while this OneUptime runs a test or pre-release build,
 *     and never a global probe.
 *
 * Who is told: the probe's owners - its owner users, and the members of its
 * owner teams (ProbeService.getOwners) - or, when it has none, the project's
 * owners in their place, as every owner notification of OneUptime does
 * (OwnerNotificationDeliveries.planForOwnersOf), the probe's connection
 * status included: a probe nobody owns is the one most likely to be left
 * behind, and its page and Custom Probes say it either way. The email says
 * which they are. Each under their "Probe a major release behind" setting,
 * on every channel it has on; it starts on by email, and is seeded for a
 * member who joined before it existed.
 *
 * Told once, however the worker stops (OwnerNotificationDeliveries): whom it
 * is to tell is written first, then the probe is taken - its major release
 * kept, by a compare-and-set, so of two runs at once only one tells - then
 * each owner is told. A run that stops part way leaves its owners to the
 * next run, which takes them up before anything else (resume). Each notice
 * is the probe's on the day it went out (its occurrence), so a probe that
 * falls behind again, after it was forgotten, is a notice of its own. A
 * probe whose owners - and project's owners - cannot be read, or are
 * nobody, is not taken: it is tried again the next day.
 */

export const PROBE_MAJOR_RELEASE_JOB_NAME: string =
  "Probe:NotifyMajorReleaseBehind";

// How many probes a page reads.
export const PROBE_MAJOR_RELEASE_PAGE_SIZE: number = 500;

const MILLISECONDS_IN_A_DAY: number = 24 * 60 * 60 * 1000;

// What a probe is read with: its release, what was told, and what the notice names.
const PROBE_SELECT: Select<Probe> = {
  _id: true,
  name: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
  isGlobalProbe: true,
  reportedVersion: true,
  lastAlive: true,
  majorVersionBehindNotifiedFor: true,
};

// What one run did.
export interface ProbeMajorReleaseRun {
  // Connected custom probes read.
  read: number;
  // Probes whose owners this run set out to tell.
  told: number;
  // Probes whose earlier notice this run forgot: they run OneUptime's major release again.
  forgotten: number;
  // Whether this OneUptime runs a release it can compare probes with.
  isServerRelease: boolean;
}

/*
 * The day a notice goes out, as its occurrence: days since 1970-01-01, UTC.
 * A probe is told at most once a day, and each time it falls behind is a
 * notice of its own - which OneUptime's major release alone would not tell
 * apart, for a probe rolled back after it was updated.
 */
export function getNoticeOccurrence(now: Date): number {
  return Math.floor(now.getTime() / MILLISECONDS_IN_A_DAY);
}

// Whether a release is one probes are compared with: a release, not a test or pre-release build.
export function isComparableServerRelease(serverVersion: unknown): boolean {
  const server: ParsedVersion | null = VersionUtil.parse(serverVersion);

  return Boolean(server && !server.prerelease);
}

// The docs' Update a probe section, on this installation's own docs.
async function getUpdateProbeDocsUrl(): Promise<string> {
  const docs: string = URL.fromString(
    (await DatabaseConfig.getHomeUrl()).toString(),
  )
    .addRoute(DocsRoute.toString())
    .toString()
    .replace(/\/+$/, "");

  return `${docs}${UPDATE_A_PROBE_DOCS_PATH}`;
}

function toRead(
  probe: Probe,
  serverVersion: string,
): ProbeMajorReleaseNoticeRead {
  return {
    isGlobalProbe: probe.isGlobalProbe,
    reportedVersion: probe.reportedVersion,
    lastAlive: probe.lastAlive,
    serverVersion,
    majorVersionBehindNotifiedFor: probe.majorVersionBehindNotifiedFor,
  };
}

/*
 * Takes the probe for its notice: keeps OneUptime's major release on it,
 * only if what is kept is still what was read. False when another run took
 * it first: that run tells its owners.
 */
async function takeProbe(data: {
  probe: Probe;
  serverMajor: number;
}): Promise<boolean> {
  return await ProbeService.compareAndSetColumnsByIdWithoutHooks({
    id: data.probe.id!,
    data: {
      majorVersionBehindNotifiedFor: data.serverMajor,
    },
    expectedData: {
      majorVersionBehindNotifiedFor: readNotifiedFor(
        data.probe.majorVersionBehindNotifiedFor,
      ) as number,
    },
    skipUpdateDateColumn: true,
  });
}

// Forgets the probe's notice, only if what is kept is still what was read.
async function forgetNotice(probe: Probe): Promise<boolean> {
  return await ProbeService.compareAndSetColumnsByIdWithoutHooks({
    id: probe.id!,
    data: {
      majorVersionBehindNotifiedFor: null as unknown as number,
    },
    expectedData: {
      majorVersionBehindNotifiedFor: readNotifiedFor(
        probe.majorVersionBehindNotifiedFor,
      ) as number,
    },
    skipUpdateDateColumn: true,
  });
}

// What one run reads once: the docs link, and each project's owners.
class RunReads {
  private updateProbeDocsUrl: Promise<string> | null = null;
  private projectOwners: Map<string, Promise<Array<User>>> = new Map();

  public getUpdateProbeDocsUrl(): Promise<string> {
    if (!this.updateProbeDocsUrl) {
      this.updateProbeDocsUrl = getUpdateProbeDocsUrl();
    }

    return this.updateProbeDocsUrl;
  }

  public getProjectOwners(projectId: ObjectID): Promise<Array<User>> {
    const key: string = projectId.toString();
    let owners: Promise<Array<User>> | undefined = this.projectOwners.get(key);

    if (!owners) {
      owners = ProjectService.getOwners(projectId);
      // A failed read is not kept: the next probe of the project reads again.
      owners.catch((): void => {
        this.projectOwners.delete(key);
      });
      this.projectOwners.set(key, owners);
    }

    return owners;
  }
}

/*
 * Tells a delivery's owners of the probe's lag, each once
 * (OwnerNotificationDelivery.tell): their setting seeded first for one who
 * joined before it existed, then sent on every channel it has on.
 */
async function tellOwners(data: {
  probe: Probe;
  lag: ProbeMajorReleaseLag;
  delivery: OwnerNotificationDelivery;
  reads: RunReads;
}): Promise<void> {
  if (!data.delivery.hasWorkToDo) {
    return;
  }

  const probe: Probe = data.probe;
  const projectId: ObjectID = probe.projectId!;
  const missedFeatures: Array<ProbeFeature> =
    ProbeReportedVersionUtil.getMissedFeatures({
      isGlobalProbe: probe.isGlobalProbe,
      reportedVersion: probe.reportedVersion,
      lastAlive: probe.lastAlive,
    });
  const viewProbeLink: string = (
    await ProbeService.getLinkInDashboard(projectId, probe.id!)
  ).toString();
  const updateProbeDocsUrl: string = await data.reads.getUpdateProbeDocsUrl();
  const eventType: typeof ProbeMajorReleaseNotification.EVENT_TYPE =
    ProbeMajorReleaseNotification.EVENT_TYPE;

  for (const user of data.delivery.owners) {
    await data.delivery.tell(user, async (): Promise<void> => {
      await UserNotificationSettingService.ensureSettingExistsForUser({
        userId: user.id!,
        projectId,
        eventType,
      });

      const content: ProbeMajorReleaseNotificationContent =
        ProbeMajorReleaseNotification.buildContent({
          probeName: probe.name || "Probe",
          probeDescription: probe.description,
          projectName: probe.project?.name || "Project",
          lag: data.lag,
          missedFeatures,
          viewProbeLink,
          updateProbeDocsUrl,
          isOwner: !data.delivery.isProjectOwners,
        });

      await UserNotificationSettingService.sendUserNotification({
        userId: user.id!,
        projectId,
        eventType,
        emailEnvelope: content.emailEnvelope,
        smsMessage: content.smsMessage,
        callRequestMessage: content.callRequestMessage,
        pushNotificationMessage: content.pushNotificationMessage,
        // Through its own approved template (#10913).
        whatsAppMessage: content.whatsAppMessage,
      });
    });
  }
}

/*
 * A probe whose owners are to be told: whom, written down first; then the
 * probe taken; then each told. Returns whether this run set out to tell.
 */
async function noticeProbe(data: {
  probe: Probe;
  lag: ProbeMajorReleaseLag;
  occurrence: number;
  reads: RunReads;
}): Promise<boolean> {
  const probe: Probe = data.probe;
  const projectId: ObjectID = probe.projectId!;

  const delivery: OwnerNotificationDelivery =
    await OwnerNotificationDeliveries.planForOwnersOf({
      notification: {
        kind: OwnerNotificationKind.ProbeMajorReleaseBehind,
        projectId,
        resourceId: probe.id!,
        eventId: probe.id!,
        occurrence: data.occurrence,
      },
      findOwners: (): Promise<Array<User>> => {
        return ProbeService.getOwners(probe.id!);
      },
      findProjectOwners: (): Promise<Array<User>> => {
        return data.reads.getProjectOwners(projectId);
      },
      writesFeedItem: false,
    });

  // Nobody to tell - or nobody who could be read: tried again tomorrow.
  if (delivery.owners.length === 0 && delivery.toldEarlier.length === 0) {
    logger.debug(
      `${PROBE_MAJOR_RELEASE_JOB_NAME}: nobody to tell that probe ${probe.id!.toString()} is ${data.lag.majorReleasesBehind} major release(s) behind; it is read again tomorrow.`,
      { projectId: projectId.toString() },
    );
    return false;
  }

  if (!(await takeProbe({ probe, serverMajor: data.lag.serverMajor }))) {
    return false;
  }

  await tellOwners({ probe, lag: data.lag, delivery, reads: data.reads });

  return true;
}

/*
 * One run: what a stopped run left untold first, then every connected
 * custom probe. Exported for tests, with the release and the time a test
 * gives in place of this OneUptime's.
 */
export async function notifyProbesMajorReleaseBehind(options?: {
  serverVersion?: string | undefined;
  now?: Date | undefined;
  deadline?: JobDeadline | undefined;
}): Promise<ProbeMajorReleaseRun> {
  const serverVersion: string =
    options?.serverVersion === undefined ? AppVersion : options.serverVersion;
  const now: Date = options?.now || OneUptimeDate.getCurrentDate();
  const reads: RunReads = new RunReads();
  const run: ProbeMajorReleaseRun = {
    read: 0,
    told: 0,
    forgotten: 0,
    isServerRelease: isComparableServerRelease(serverVersion),
  };

  /*
   * The owners a run that stopped part way left untold, told first,
   * exactly them, from the probe as it is now - while it is still a major
   * release behind (OwnerNotificationDeliveries).
   */
  await OwnerNotificationDeliveries.resume({
    kinds: [OwnerNotificationKind.ProbeMajorReleaseBehind],
    notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
      const probe: Probe | null = await ProbeService.findOneById({
        id: delivery.notification.resourceId,
        select: PROBE_SELECT,
        props: {
          isRoot: true,
        },
      });

      if (!probe || !probe.id || !probe.projectId) {
        await delivery.giveUp("the probe is gone");
        return;
      }

      const lag: ProbeMajorReleaseLag | null =
        ProbeReportedVersionUtil.getMajorReleaseLag(
          toRead(probe, serverVersion),
        );

      if (!lag) {
        await delivery.giveUp(
          "the probe is no longer a major release behind, or that can no longer be told",
        );
        return;
      }

      const notifiedFor: number | null = readNotifiedFor(
        probe.majorVersionBehindNotifiedFor,
      );

      // Taken by the run that stopped, or taken now.
      if (notifiedFor === null || notifiedFor < lag.serverMajor) {
        await takeProbe({ probe, serverMajor: lag.serverMajor });
      }

      await tellOwners({ probe, lag, delivery, reads });
    },
  });

  if (!run.isServerRelease) {
    logger.debug(
      `${PROBE_MAJOR_RELEASE_JOB_NAME}: this OneUptime runs ${serverVersion || "no release"}, a build probes are not compared with; nobody is told and nothing is forgotten.`,
    );
    return run;
  }

  const occurrence: number = getNoticeOccurrence(now);

  await forEachKeysetPage<Probe>({
    jobName: PROBE_MAJOR_RELEASE_JOB_NAME,
    pageSize: PROBE_MAJOR_RELEASE_PAGE_SIZE,
    deadline: options?.deadline,
    readPage: (afterId: ObjectID | null): Promise<Array<Probe>> => {
      return ProbeService.findBy({
        query: {
          isGlobalProbe: false,
          connectionStatus: ProbeConnectionStatus.Connected,
          ...(afterId ? { _id: QueryHelper.greaterThan(afterId) } : {}),
        },
        select: PROBE_SELECT,
        sort: {
          _id: SortOrder.Ascending,
        },
        skip: 0,
        limit: PROBE_MAJOR_RELEASE_PAGE_SIZE,
        props: {
          isRoot: true,
        },
      });
    },
    getId: (probe: Probe): ObjectID | null => {
      return probe.id;
    },
    onPage: async (probes: Array<Probe>): Promise<void> => {
      for (const probe of probes) {
        if (options?.deadline?.hasPassed()) {
          return;
        }

        run.read++;

        if (!probe.id || !probe.projectId || probe.isGlobalProbe) {
          continue;
        }

        try {
          const decision: ProbeMajorReleaseNoticeDecision =
            ProbeMajorReleaseNoticeUtil.decide(toRead(probe, serverVersion));

          if (
            decision.action === ProbeMajorReleaseNoticeAction.Tell &&
            decision.lag
          ) {
            if (
              await noticeProbe({
                probe,
                lag: decision.lag,
                occurrence,
                reads,
              })
            ) {
              run.told++;
            }
          } else if (decision.action === ProbeMajorReleaseNoticeAction.Forget) {
            if (await forgetNotice(probe)) {
              run.forgotten++;
            }
          }
        } catch (error) {
          // One probe that fails costs only itself: it is read again tomorrow.
          logger.error(
            `${PROBE_MAJOR_RELEASE_JOB_NAME}: could not tell the owners of probe ${probe.id.toString()} that it is behind: ${error}`,
            { projectId: probe.projectId.toString() },
          );
          logger.error(error, { projectId: probe.projectId.toString() });
        }
      }
    },
  });

  return run;
}

RunCron(
  PROBE_MAJOR_RELEASE_JOB_NAME,
  { schedule: EVERY_DAY, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    await notifyProbesMajorReleaseBehind({ deadline });
  },
);
