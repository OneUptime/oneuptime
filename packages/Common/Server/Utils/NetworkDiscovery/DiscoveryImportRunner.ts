import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryImport from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryImport";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  ACTIVE_DISCOVERY_IMPORT_STATUSES,
  DISCOVERY_IMPORT_VIEW_RESULT_LIMIT,
  DiscoveryImportAlerting,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportHostResult,
  DiscoveryImportMonitorOutcome,
  DiscoveryImportProgress,
  DiscoveryImportSettings,
  DiscoveryImportStatus,
  DiscoveryImportView,
  MAX_HOSTS_PER_DISCOVERY_IMPORT,
  getRetryableHostResults,
  isDiscoveryImportActive,
  readDiscoveryImportHostResults,
  readDiscoveryImportProgress,
  readDiscoveryImportSettings,
  summarizeDiscoveryImportResults,
} from "../../../Types/NetworkDevice/DiscoveryImport";
import { NetworkDeviceMonitoringMethodUtil } from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";
import NetworkDeviceMonitorTemplateUtil from "../../../Utils/Monitor/NetworkDeviceMonitorTemplateUtil";
import {
  buildDeviceName,
  buildFallbackDeviceName,
  buildNetworkDeviceFromDiscoveredHost,
} from "../../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import { normalizeDiscoveredHosts } from "../../../Utils/NetworkDiscovery/DiscoveredHostUtil";
import { isPingOnlyDiscoveredHost } from "../../../Utils/NetworkDiscovery/DiscoveryImportEligibility";
import {
  DISCOVERY_SCAN_STARTED_MESSAGE,
  DiscoveryScanStatus,
} from "../../../Utils/NetworkDiscovery/DiscoveryScanStatus";
import Queue, { QueueName } from "../../Infrastructure/Queue";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import MonitorService from "../../Services/MonitorService";
import MonitorTemplateService from "../../Services/MonitorTemplateService";
import { AUTO_IMPORT_SCAN_BUILDER_SELECT } from "../../Services/NetworkDeviceAutoImportRuleEngineService";
import NetworkDeviceDiscoveryImportService from "../../Services/NetworkDeviceDiscoveryImportService";
import NetworkDeviceDiscoveryScanService from "../../Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import Includes from "../../../Types/BaseDatabase/Includes";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import ModelPermission from "../../Types/Database/Permissions/Index";
import ActiveMonitorLimit from "../Billing/ActiveMonitorLimit";
import CallerPlan from "../Billing/CallerPlan";
import logger, { LogAttributes } from "../Logger";
import RuleRecordScope from "../Rules/RuleRecordScope";
import WorkspaceActionAuthorization from "../Workspace/WorkspaceActionAuthorization";

/*
 * THE IMPORT OF DISCOVERED HOSTS AS NETWORK DEVICES, ON THE SERVER.
 *
 *   start    the Review dialog asks for an import: the hosts the person
 *            ticked and how they are monitored. Everything that can be
 *            refused is refused here, at once and in one sentence - no
 *            right to create devices or monitors, a scan the person cannot
 *            read, a template that is not a Network Device one, a plan with
 *            no room for another monitor - and the import is recorded and
 *            queued.
 *   (worker) creates each host's device, then its monitor, acting as the
 *            person, and writes what happened to every host as it goes, so
 *            the dialog shows progress anyone can trust, and a person who
 *            closed it sees where the import stands when they come back.
 *   stop     stops it before its next hosts; what it created stays.
 *   retry    a new import of the hosts that failed, and only those. Nothing
 *            is ever created twice: a device is looked up at its address
 *            before it is created, and a monitor by the (device, template)
 *            pair every monitor made from a template carries.
 *
 * ONE IMPORT OF A PROJECT RUNS AT A TIME. The worker's job is "run this
 * project's imports", queued once per project (the queue folds repeats into
 * one waiting job) and run under the project's lock, oldest import first. A
 * second import asked for meanwhile waits as Queued, so two imports never
 * race each other for the same addresses, and a project's database sees one
 * import's writes at a time however many people press Import.
 *
 * AS THE PERSON. Every device is created with the person's own permissions,
 * read from the database at the time, so someone who lost the right to
 * create devices half-way stops creating them half-way. A monitor is made as
 * OneUptime itself, because only OneUptime may write the provenance a
 * template's monitor carries (which device, which template) - but only after
 * the same check a person's own create would pass, on the very monitor it is
 * about to create. The scan, its credentials included, is read as the
 * person: someone who may not read the credentials could not import the
 * devices that need them before, and cannot now.
 */

export const DISCOVERY_IMPORT_JOB: string =
  "NetworkDeviceDiscovery:RunDiscoveryImports";

// The worker's limit for one job; a job hands over to a fresh one before it.
export const DISCOVERY_IMPORT_JOB_TIMEOUT_MS: number = 60 * 60 * 1000;

/*
 * How long one job works before it queues a fresh job to carry on and ends,
 * well inside the worker's limit, so a long import is never killed mid-host.
 */
export const DISCOVERY_IMPORT_JOB_BUDGET_MS: number = 45 * 60 * 1000;

/*
 * A Running import that has written nothing for this long has lost its
 * worker (a deploy, a crash): the sweep picks it up again where it stopped.
 * A healthy one writes every couple of seconds.
 */
export const DISCOVERY_IMPORT_STALE_RUNNING_MS: number = 5 * 60 * 1000;

// A Queued import whose job never ran is queued again after this long.
export const DISCOVERY_IMPORT_STALE_QUEUED_MS: number = 2 * 60 * 1000;

/*
 * How many times one import is picked up again before it is failed instead:
 * an import that kills its worker every time it runs must not do it for
 * ever.
 */
export const MAX_DISCOVERY_IMPORT_RESUMES: number = 3;

// An import still waiting to start after this long is failed.
export const DISCOVERY_IMPORT_MAX_QUEUED_MS: number = 6 * 60 * 60 * 1000;

// Results and progress are written at most this often while hosts are imported.
export const DISCOVERY_IMPORT_FLUSH_INTERVAL_MS: number = 1500;

/*
 * How long the person's permissions are trusted before they are read again,
 * so a permission taken away during an import is held to within this long.
 */
export const DISCOVERY_IMPORT_PERMISSION_REFRESH_MS: number = 30 * 1000;

/*
 * Monitor creates that may fail with the same reason, one after another,
 * before the import stops trying: a plan with no more room, a template whose
 * criteria name a status that no longer exists. Every device still imports;
 * the rest of the monitors are failed with that reason, so retrying them
 * after the cause is fixed is one press. Any success resets the count.
 */
export const MAX_CONSECUTIVE_IDENTICAL_MONITOR_FAILURES: number = 10;

// How long a reason may be in a result: it is shown in a list.
export const MAX_DISCOVERY_IMPORT_REASON_LENGTH: number = 500;

const LOCK_NAMESPACE: string = "NetworkDeviceDiscoveryImport";

// The project's lock is kept alive while held; a dead holder's lapses after this.
const PROJECT_LOCK_TIMEOUT_MS: number = 2 * 60 * 1000;

/*
 * The scan columns an import reads, as the person: the hosts and the scan's
 * state when it starts, the builder's columns (the credentials, and how the
 * scan names devices) when it creates each device. The builder's select is
 * the one the auto-import engine reads with, pinned against the builder's
 * own shape (AutoImportScanCredentialSelect), so the two import paths build
 * the same device from the same host.
 */
export const DISCOVERY_IMPORT_SCAN_SELECT: { [key: string]: boolean } = {
  _id: true,
  projectId: true,
  name: true,
  cidr: true,
  status: true,
  statusMessage: true,
  ...AUTO_IMPORT_SCAN_BUILDER_SELECT,
};

const IMPORT_SELECT: { [key: string]: boolean | { [key: string]: boolean } } = {
  _id: true,
  projectId: true,
  networkDeviceDiscoveryScanId: true,
  status: true,
  settings: true,
  hosts: true,
  results: true,
  progress: true,
  monitorTemplateName: true,
  error: true,
  stopRequestedAt: true,
  resumeCount: true,
  retryOfImportId: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true,
};

// What the API reads to describe an import: everything but the hosts.
export const DISCOVERY_IMPORT_VIEW_SELECT: {
  [key: string]: boolean | { [key: string]: boolean };
} = {
  _id: true,
  projectId: true,
  networkDeviceDiscoveryScanId: true,
  status: true,
  settings: true,
  results: true,
  progress: true,
  monitorTemplateName: true,
  error: true,
  stopRequestedAt: true,
  retryOfImportId: true,
  createdByUserId: true,
  createdByUser: {
    name: true,
    email: true,
  },
  createdAt: true,
  startedAt: true,
  completedAt: true,
};

/*
 * Why a host's monitor was not made, said once, in the words the progress
 * view lists them under.
 */
export const MONITOR_SKIPPED_DEVICE_NOT_IMPORTED: string =
  "The device was not imported, so it has no monitor.";
export const MONITOR_SKIPPED_MONITOR_BACKED: string =
  "This device takes its status from a monitor bound to it, so a Network Device monitor would have nothing to read.";
export const DEVICE_NOT_REACHED_STOPPED: string =
  "The import was stopped before it reached this host.";
export const DEVICE_NOT_REACHED_FAILED: string =
  "The import stopped before it reached this host.";

// The state one worker keeps while it imports one import's hosts.
interface ImportRunState {
  row: NetworkDeviceDiscoveryImport;
  projectId: ObjectID;
  userId: ObjectID;
  settings: DiscoveryImportSettings;
  hosts: Array<DiscoveredNetworkDevice>;
  results: Array<DiscoveryImportHostResult>;
  scan: NetworkDeviceDiscoveryScan;
  template: MonitorTemplate | null;
  props: DatabaseCommonInteractionProps;
  propsReadAt: number;
  lastFlushAt: number;
  // Devices this run created or found, by id: their names and methods.
  devicesById: Map<string, NetworkDevice>;
  consecutiveMonitorFailures: number;
  lastMonitorFailure: string;
  // Set once monitors stop being tried: the reason every one left fails with.
  monitorHaltReason: string | null;
}

export type DiscoveryImportFinish = "done" | "stopped" | "handover";

const WHITESPACE_RUNS: RegExp = /\s+/g;

function toText(error: unknown): string {
  const message: string =
    error instanceof Error ? error.message || "" : String(error ?? "");

  const text: string = message.replace(WHITESPACE_RUNS, " ").trim();

  return (text || "Something went wrong.").substring(
    0,
    MAX_DISCOVERY_IMPORT_REASON_LENGTH,
  );
}

function isRefusalOfThePerson(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

export default class DiscoveryImportRunner {
  /*
   * The clock the runner reads for its write cadence, its permission
   * refreshes and its time budget. A seam for tests.
   */
  public static now: () => number = (): number => {
    return Date.now();
  };

  // ---- Asked for through the API.

  /*
   * Record an import and queue it. Returns the new row. Every refusal is a
   * BadDataException (or NotAuthorizedException) whose message the dialog
   * shows as it stands.
   */
  public static async start(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    scanId: unknown;
    ipAddresses: unknown;
    settings: unknown;
  }): Promise<NetworkDeviceDiscoveryImport> {
    const userId: ObjectID | undefined = data.props.userId;

    if (!userId) {
      throw new NotAuthorizedException(
        "An import acts as the person who asks for it, so it needs a person signed in to the project.",
      );
    }

    const scanId: ObjectID = this.readId(
      data.scanId,
      "Pick the discovery scan to import from.",
    );
    const settings: DiscoveryImportSettings = readDiscoveryImportSettings(
      data.settings,
    );
    const addresses: Array<string> = this.readAddresses(data.ipAddresses);

    this.assertCanCreateDevices(data.props);

    if (settings.alerting === DiscoveryImportAlerting.MonitorTemplate) {
      this.assertCanCreateMonitors(data.props);
    }

    const scan: NetworkDeviceDiscoveryScan = await this.readScanAsPerson({
      scanId: scanId,
      projectId: data.projectId,
      props: data.props,
      withHosts: true,
    });

    this.assertScanHasResults(scan);

    const hosts: Array<DiscoveredNetworkDevice> = this.pickHosts({
      scan: scan,
      addresses: addresses,
    });

    if (hosts.length === 0) {
      throw new BadDataException(
        "None of the selected hosts are in this scan's results any more. Close this window and open Review Results again to see what the scan has found.",
      );
    }

    let monitorTemplateName: string | undefined = undefined;

    if (settings.alerting === DiscoveryImportAlerting.MonitorTemplate) {
      const template: MonitorTemplate = await this.readTemplateAsPerson({
        templateId: new ObjectID(settings.monitorTemplateId!),
        projectId: data.projectId,
        props: data.props,
      });

      monitorTemplateName = template.templateName || undefined;

      /*
       * A plan with no room for even one more monitor would refuse every
       * one of them: said now, once, rather than as five hundred failures
       * after the devices are in. With some room, the import goes ahead
       * and the creates past it are refused one by one, in the limit's own
       * words, each device imported all the same.
       */
      await ActiveMonitorLimit.assertRoomFor({
        projectId: data.projectId,
      });
    }

    const row: NetworkDeviceDiscoveryImport =
      new NetworkDeviceDiscoveryImport();
    row.projectId = data.projectId;
    row.networkDeviceDiscoveryScanId = scanId;
    row.status = DiscoveryImportStatus.Queued;
    row.settings = settings as unknown as JSONObject;
    row.hosts = hosts;
    const results: Array<DiscoveryImportHostResult> = this.initialResults({
      hosts: hosts,
      scan: scan,
      settings: settings,
    });
    row.results = results as unknown as Array<JSONObject>;
    row.progress = summarizeDiscoveryImportResults(
      results,
    ) as unknown as JSONObject;
    row.createdByUserId = userId;
    row.resumeCount = 0;

    if (monitorTemplateName) {
      row.monitorTemplateName = monitorTemplateName.substring(0, 100);
    }

    const created: NetworkDeviceDiscoveryImport =
      await NetworkDeviceDiscoveryImportService.create({
        data: row,
        props: { isRoot: true },
      });

    await this.enqueue(data.projectId);

    return created;
  }

  /*
   * A new import of the hosts an earlier one did not finish: devices that
   * failed or were never reached, and devices whose monitor failed. Asked
   * for by anyone who may import - it acts as them - with the earlier
   * import's settings.
   */
  public static async retry(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    importId: ObjectID;
  }): Promise<NetworkDeviceDiscoveryImport> {
    const userId: ObjectID | undefined = data.props.userId;

    if (!userId) {
      throw new NotAuthorizedException(
        "An import acts as the person who asks for it, so it needs a person signed in to the project.",
      );
    }

    const earlier: NetworkDeviceDiscoveryImport = await this.findImport({
      importId: data.importId,
      projectId: data.projectId,
    });

    if (isDiscoveryImportActive(earlier.status)) {
      throw new BadDataException(
        "This import is still running. Its failed hosts can be tried again once it finishes.",
      );
    }

    const settings: DiscoveryImportSettings = readDiscoveryImportSettings(
      earlier.settings,
    );

    this.assertCanCreateDevices(data.props);

    if (settings.alerting === DiscoveryImportAlerting.MonitorTemplate) {
      this.assertCanCreateMonitors(data.props);
    }

    const earlierHosts: Array<DiscoveredNetworkDevice> =
      normalizeDiscoveredHosts(earlier.hosts || []);
    const retryable: Set<string> = new Set<string>(
      getRetryableHostResults(
        readDiscoveryImportHostResults(earlier.results),
      ).map((result: DiscoveryImportHostResult): string => {
        return result.ipAddress;
      }),
    );

    const hosts: Array<DiscoveredNetworkDevice> = earlierHosts.filter(
      (host: DiscoveredNetworkDevice): boolean => {
        return retryable.has(host.ipAddress);
      },
    );

    if (hosts.length === 0) {
      throw new BadDataException(
        "Every host of this import was imported, so there is nothing to try again.",
      );
    }

    /*
     * The scan is read again, as the person: it is where the credentials
     * live, and the person retrying must be able to read them as much as
     * the person who started the import.
     */
    const scan: NetworkDeviceDiscoveryScan = await this.readScanAsPerson({
      scanId: earlier.networkDeviceDiscoveryScanId!,
      projectId: data.projectId,
      props: data.props,
      withHosts: false,
    });

    let monitorTemplateName: string | undefined =
      earlier.monitorTemplateName || undefined;

    if (settings.alerting === DiscoveryImportAlerting.MonitorTemplate) {
      const template: MonitorTemplate = await this.readTemplateAsPerson({
        templateId: new ObjectID(settings.monitorTemplateId!),
        projectId: data.projectId,
        props: data.props,
      });

      monitorTemplateName = template.templateName || monitorTemplateName;
    }

    const row: NetworkDeviceDiscoveryImport =
      new NetworkDeviceDiscoveryImport();
    row.projectId = data.projectId;
    row.networkDeviceDiscoveryScanId = earlier.networkDeviceDiscoveryScanId!;
    row.status = DiscoveryImportStatus.Queued;
    row.settings = settings as unknown as JSONObject;
    row.hosts = hosts;
    const results: Array<DiscoveryImportHostResult> = this.initialResults({
      hosts: hosts,
      scan: scan,
      settings: settings,
    });
    row.results = results as unknown as Array<JSONObject>;
    row.progress = summarizeDiscoveryImportResults(
      results,
    ) as unknown as JSONObject;
    row.createdByUserId = userId;
    row.retryOfImportId = earlier.id!;
    row.resumeCount = 0;

    if (monitorTemplateName) {
      row.monitorTemplateName = monitorTemplateName.substring(0, 100);
    }

    const created: NetworkDeviceDiscoveryImport =
      await NetworkDeviceDiscoveryImportService.create({
        data: row,
        props: { isRoot: true },
      });

    await this.enqueue(data.projectId);

    return created;
  }

  /*
   * Stop an import. A queued one stops at once; a running one stops before
   * its next hosts, within a couple of seconds. What it created stays.
   * Anyone who may import may stop one: a colleague's wrong template must
   * not have to run to the end.
   */
  public static async stop(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    importId: ObjectID;
  }): Promise<NetworkDeviceDiscoveryImport> {
    this.assertCanCreateDevices(data.props);

    const row: NetworkDeviceDiscoveryImport = await this.findImport({
      importId: data.importId,
      projectId: data.projectId,
    });

    if (!isDiscoveryImportActive(row.status)) {
      return row;
    }

    if (row.status === DiscoveryImportStatus.Queued) {
      const results: Array<DiscoveryImportHostResult> = this.markNotReached(
        readDiscoveryImportHostResults(row.results),
        DEVICE_NOT_REACHED_STOPPED,
      );

      await NetworkDeviceDiscoveryImportService.updateOneById({
        id: row.id!,
        data: {
          status: DiscoveryImportStatus.Stopped,
          stopRequestedAt: new Date(),
          completedAt: new Date(),
          results: results as never,
          progress: summarizeDiscoveryImportResults(results) as never,
        },
        props: { isRoot: true },
      });
    } else {
      await NetworkDeviceDiscoveryImportService.updateOneById({
        id: row.id!,
        data: {
          stopRequestedAt: new Date(),
        },
        props: { isRoot: true },
      });
    }

    return await this.findImport({
      importId: data.importId,
      projectId: data.projectId,
    });
  }

  // ---- The worker's side.

  /*
   * Run the project's imports, oldest first, until none is waiting. Called
   * by the queue job; returns when there is nothing left to do, or when the
   * job's time is up (having queued a fresh job to carry on).
   */
  public static async runProjectImports(projectId: ObjectID): Promise<void> {
    let lock: SemaphoreMutex;

    try {
      lock = await Semaphore.lock({
        namespace: LOCK_NAMESPACE,
        key: projectId.toString(),
        lockTimeout: PROJECT_LOCK_TIMEOUT_MS,
        acquireTimeout: 1000,
        acquireAttemptsLimit: 1,
      });
    } catch (error) {
      /*
       * Another job holds the project: it runs every import that is
       * waiting, this one's included, and the sweep re-queues anything
       * left behind.
       */
      logger.debug(
        `Discovery import: project ${projectId.toString()} is already being imported: ${error}`,
      );
      return;
    }

    const jobStartedAt: number = this.now();

    try {
      for (;;) {
        const next: NetworkDeviceDiscoveryImport | null =
          await this.findNextImport(projectId);

        if (!next) {
          return;
        }

        const finish: DiscoveryImportFinish = await this.processImport({
          importId: next.id!,
          deadline: jobStartedAt + DISCOVERY_IMPORT_JOB_BUDGET_MS,
        });

        if (finish === "handover") {
          await this.enqueue(projectId);
          return;
        }
      }
    } finally {
      try {
        await Semaphore.release(lock);
      } catch {
        logger.error(
          "Discovery import: a project lock could not be released and will expire on its own.",
        );
      }
    }
  }

  /*
   * Import one import's hosts that are not done yet. Picks up where an
   * earlier worker stopped: a host whose device and monitor are settled is
   * not touched again.
   */
  public static async processImport(data: {
    importId: ObjectID;
    deadline: number;
  }): Promise<DiscoveryImportFinish> {
    const row: NetworkDeviceDiscoveryImport | null =
      await NetworkDeviceDiscoveryImportService.findOneById({
        id: data.importId,
        select: IMPORT_SELECT as never,
        props: { isRoot: true },
      });

    if (!row || !row.projectId || !isDiscoveryImportActive(row.status)) {
      return "done";
    }

    const logAttributes: LogAttributes = {
      projectId: row.projectId.toString(),
    } as LogAttributes;

    let state: ImportRunState;

    try {
      state = await this.prepare(row);
    } catch (error) {
      await this.failImport(row, this.describeStartFailure(error));
      return "done";
    }

    if (row.status === DiscoveryImportStatus.Queued) {
      await NetworkDeviceDiscoveryImportService.updateOneById({
        id: row.id!,
        data: {
          status: DiscoveryImportStatus.Running,
          startedAt: new Date(),
        },
        props: { isRoot: true },
      });
    }

    for (let index: number = 0; index < state.hosts.length; index++) {
      const result: DiscoveryImportHostResult = state.results[index]!;

      if (
        result.device !== DiscoveryImportDeviceOutcome.Pending &&
        result.monitor !== DiscoveryImportMonitorOutcome.Pending
      ) {
        continue;
      }

      if (this.now() >= data.deadline) {
        await this.flush(state, true);
        return "handover";
      }

      if (await this.isStopRequested(state)) {
        state.results = this.markNotReached(
          state.results,
          DEVICE_NOT_REACHED_STOPPED,
        );
        await this.complete(state, DiscoveryImportStatus.Stopped);
        return "stopped";
      }

      try {
        await this.refreshPropsIfDue(state);
      } catch (error) {
        await this.flush(state, true);
        await this.failImport(state.row, this.describeStartFailure(error), {
          results: this.markNotReached(
            state.results,
            DEVICE_NOT_REACHED_FAILED,
          ),
        });
        return "done";
      }

      try {
        await this.importHost(state, index);
      } catch (error) {
        /*
         * importHost settles its own failures; anything that escapes it is
         * unexpected, and is this host's failure rather than the import's.
         */
        logger.error(
          `Discovery import ${row.id?.toString()}: unexpected failure importing ${result.ipAddress}: ${error}`,
          logAttributes,
        );

        if (result.device === DiscoveryImportDeviceOutcome.Pending) {
          result.device = DiscoveryImportDeviceOutcome.Failed;
          result.deviceError = toText(error);
        }

        if (result.monitor === DiscoveryImportMonitorOutcome.Pending) {
          result.monitor = DiscoveryImportMonitorOutcome.Skipped;
          result.monitorError = MONITOR_SKIPPED_DEVICE_NOT_IMPORTED;
        }
      }

      await this.flush(state, false);
    }

    await this.complete(state, DiscoveryImportStatus.Completed);

    return "done";
  }

  /*
   * Picks up imports a dead worker left behind, re-queues ones whose job
   * never ran, and fails ones that cannot go on. Called on a schedule.
   */
  public static async sweep(now: Date = new Date()): Promise<void> {
    const stale: Array<NetworkDeviceDiscoveryImport> =
      await NetworkDeviceDiscoveryImportService.findBy({
        query: {
          status: new Includes([...ACTIVE_DISCOVERY_IMPORT_STATUSES]),
          updatedAt: new LessThan(
            new Date(now.getTime() - DISCOVERY_IMPORT_STALE_QUEUED_MS),
          ),
        },
        select: {
          _id: true,
          projectId: true,
          status: true,
          resumeCount: true,
          createdAt: true,
          updatedAt: true,
          results: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    const projectsToRun: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const row of stale) {
      if (!row.id || !row.projectId) {
        continue;
      }

      const updatedAt: number = row.updatedAt
        ? new Date(row.updatedAt).getTime()
        : 0;
      const createdAt: number = row.createdAt
        ? new Date(row.createdAt).getTime()
        : 0;

      if (row.status === DiscoveryImportStatus.Running) {
        if (now.getTime() - updatedAt < DISCOVERY_IMPORT_STALE_RUNNING_MS) {
          continue;
        }

        if ((row.resumeCount || 0) >= MAX_DISCOVERY_IMPORT_RESUMES) {
          await this.failImport(
            row,
            "The import stopped before it finished, more often than it is picked up again. What it created is kept: try the hosts it did not reach again.",
            {
              results: this.markNotReached(
                readDiscoveryImportHostResults(row.results),
                DEVICE_NOT_REACHED_FAILED,
              ),
            },
          );
          continue;
        }

        await NetworkDeviceDiscoveryImportService.updateOneById({
          id: row.id,
          data: { resumeCount: (row.resumeCount || 0) + 1 },
          props: { isRoot: true },
        });

        projectsToRun.set(row.projectId.toString(), row.projectId);
        continue;
      }

      // Queued.
      if (now.getTime() - createdAt > DISCOVERY_IMPORT_MAX_QUEUED_MS) {
        await this.failImport(
          row,
          "The import waited too long to start. Nothing was imported: start it again.",
          {
            results: this.markNotReached(
              readDiscoveryImportHostResults(row.results),
              DEVICE_NOT_REACHED_FAILED,
            ),
          },
        );
        continue;
      }

      projectsToRun.set(row.projectId.toString(), row.projectId);
    }

    for (const projectId of projectsToRun.values()) {
      try {
        await this.enqueue(projectId);
      } catch (error) {
        logger.error(
          `Discovery import: could not queue project ${projectId.toString()} again: ${error}`,
        );
      }
    }
  }

  // ---- Reading imports, for the API.

  public static async findImport(data: {
    importId: ObjectID;
    projectId: ObjectID;
    select?: { [key: string]: boolean | { [key: string]: boolean } };
  }): Promise<NetworkDeviceDiscoveryImport> {
    const row: NetworkDeviceDiscoveryImport | null =
      await NetworkDeviceDiscoveryImportService.findOneBy({
        query: {
          _id: data.importId.toString(),
          projectId: data.projectId,
        },
        select: (data.select || IMPORT_SELECT) as never,
        props: { isRoot: true },
      });

    if (!row) {
      throw new BadDataException("This import was not found.");
    }

    return row;
  }

  /*
   * An import as the Dashboard draws it. By default it carries the hosts
   * worth a line of their own - failures, hosts not reached, monitors
   * skipped for a reason - up to DISCOVERY_IMPORT_VIEW_RESULT_LIMIT; with
   * `allResults`, every host, for the finished summary's full list.
   */
  public static toView(data: {
    row: NetworkDeviceDiscoveryImport;
    userId?: ObjectID | undefined;
    allResults?: boolean | undefined;
  }): DiscoveryImportView {
    const row: NetworkDeviceDiscoveryImport = data.row;
    const results: Array<DiscoveryImportHostResult> =
      readDiscoveryImportHostResults(row.results);

    let settings: DiscoveryImportSettings;

    try {
      settings = readDiscoveryImportSettings(row.settings);
    } catch {
      settings = readDiscoveryImportSettings({});
    }

    const progress: DiscoveryImportProgress =
      results.length > 0
        ? summarizeDiscoveryImportResults(results)
        : readDiscoveryImportProgress(row.progress);

    const view: DiscoveryImportView = {
      id: row.id!.toString(),
      scanId: row.networkDeviceDiscoveryScanId?.toString() || "",
      status: row.status!,
      settings: settings,
      progress: progress,
      createdAt: (row.createdAt
        ? new Date(row.createdAt)
        : new Date()
      ).toISOString(),
      isMine: Boolean(
        data.userId &&
          row.createdByUserId?.toString() === data.userId.toString(),
      ),
    };

    if (row.monitorTemplateName) {
      view.monitorTemplateName = row.monitorTemplateName;
    }

    if (row.startedAt) {
      view.startedAt = new Date(row.startedAt).toISOString();
    }

    if (row.completedAt) {
      view.completedAt = new Date(row.completedAt).toISOString();
    }

    const userName: string =
      row.createdByUser?.name?.toString() ||
      row.createdByUser?.email?.toString() ||
      "";

    if (userName) {
      view.createdByUserName = userName;
    }

    if (row.error) {
      view.error = row.error;
    }

    if (row.retryOfImportId) {
      view.retryOfImportId = row.retryOfImportId.toString();
    }

    if (row.stopRequestedAt && isDiscoveryImportActive(row.status)) {
      view.isStopRequested = true;
    }

    const listed: Array<DiscoveryImportHostResult> = data.allResults
      ? results
      : results.filter(DiscoveryImportRunner.isWorthListing);

    view.results = listed.slice(
      0,
      data.allResults ? results.length : DISCOVERY_IMPORT_VIEW_RESULT_LIMIT,
    );

    if (view.results.length < listed.length) {
      view.hasMoreResults = true;
    }

    return view;
  }

  /*
   * A host with a line of its own in the progress view: its device failed
   * or was never reached, or its monitor failed or was skipped (a skip of a
   * device that was imported says why - a bound monitor - and one of a
   * device that was not is already listed by the device).
   */
  public static isWorthListing(result: DiscoveryImportHostResult): boolean {
    return (
      result.device === DiscoveryImportDeviceOutcome.Failed ||
      result.device === DiscoveryImportDeviceOutcome.NotReached ||
      result.monitor === DiscoveryImportMonitorOutcome.Failed ||
      result.monitor === DiscoveryImportMonitorOutcome.Skipped
    );
  }

  // ---- Permissions.

  public static assertCanCreateDevices(
    props: DatabaseCommonInteractionProps,
  ): void {
    try {
      ModelPermission.checkCreatePermissions(
        NetworkDevice,
        new NetworkDevice(),
        props,
      );
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        throw new NotAuthorizedException(
          "You may not create network devices in this project, so you cannot import them. Ask a project owner or admin.",
        );
      }

      throw error;
    }
  }

  public static assertCanCreateMonitors(
    props: DatabaseCommonInteractionProps,
  ): void {
    try {
      ModelPermission.checkCreatePermissions(Monitor, new Monitor(), props);
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        throw new NotAuthorizedException(
          "You may not create monitors in this project, so the import cannot give each device a monitor. Import them without monitors, or ask a project owner or admin.",
        );
      }

      throw error;
    }
  }

  // ---- Internals.

  private static readId(value: unknown, message: string): ObjectID {
    if (typeof value !== "string" || !ObjectID.isValidUUID(value.trim())) {
      throw new BadDataException(message);
    }

    return new ObjectID(value.trim());
  }

  /*
   * The addresses the person ticked: strings, trimmed, each once, in the
   * order sent. Refused when there are none or more than an import carries.
   */
  public static readAddresses(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      throw new BadDataException("Select the hosts to import.");
    }

    const addresses: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of value) {
      if (typeof item !== "string") {
        continue;
      }

      const address: string = item.trim();

      if (!address || address.length > 100 || seen.has(address)) {
        continue;
      }

      seen.add(address);
      addresses.push(address);
    }

    if (addresses.length === 0) {
      throw new BadDataException("Select the hosts to import.");
    }

    if (addresses.length > MAX_HOSTS_PER_DISCOVERY_IMPORT) {
      throw new BadDataException(
        `One import brings in up to ${MAX_HOSTS_PER_DISCOVERY_IMPORT.toLocaleString("en-US")} hosts, and ${addresses.length.toLocaleString("en-US")} are selected. Import them in parts: filter to a group, or search for a subnet, and import each.`,
      );
    }

    return addresses;
  }

  private static async readScanAsPerson(data: {
    scanId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    withHosts: boolean;
  }): Promise<NetworkDeviceDiscoveryScan> {
    let scan: NetworkDeviceDiscoveryScan | null;

    try {
      scan = await NetworkDeviceDiscoveryScanService.findOneBy({
        query: {
          _id: data.scanId,
          projectId: data.projectId,
        },
        select: {
          ...DISCOVERY_IMPORT_SCAN_SELECT,
          ...(data.withHosts ? { discoveredDevices: true } : {}),
        } as never,
        props: data.props,
      });
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        throw new NotAuthorizedException(
          "You may not read this scan's results and SNMP credentials, which the imported devices are created with. Ask a project owner or admin to import them.",
        );
      }

      throw error;
    }

    if (!scan) {
      throw new BadDataException(
        "This discovery scan was not found. It may have been deleted.",
      );
    }

    return scan;
  }

  /*
   * The same scans the Review dialog offers Import for: a finished scan, a
   * running one that has reported hosts, and a failed one that reported
   * some before it stopped. A scan waiting for its probe has none.
   */
  private static assertScanHasResults(scan: NetworkDeviceDiscoveryScan): void {
    const isWaitingForFirstProgress: boolean =
      scan.status === DiscoveryScanStatus.InProgress &&
      scan.statusMessage === DISCOVERY_SCAN_STARTED_MESSAGE;

    if (
      scan.status === DiscoveryScanStatus.Pending ||
      isWaitingForFirstProgress ||
      !(
        scan.status === DiscoveryScanStatus.Completed ||
        scan.status === DiscoveryScanStatus.InProgress ||
        scan.status === DiscoveryScanStatus.Failed
      )
    ) {
      throw new BadDataException(
        "This scan has no results to import yet. Wait for it to report the hosts it finds.",
      );
    }
  }

  /*
   * The hosts asked for, as the scan describes them, in the scan's order -
   * the order devices are created in, whatever order the boxes were ticked
   * in. A host the scan no longer lists is left out; an address listed
   * twice is one host (the first row, which names the device).
   */
  private static pickHosts(data: {
    scan: NetworkDeviceDiscoveryScan;
    addresses: Array<string>;
  }): Array<DiscoveredNetworkDevice> {
    const wanted: Set<string> = new Set<string>(data.addresses);
    const picked: Array<DiscoveredNetworkDevice> = [];
    const seen: Set<string> = new Set<string>();

    for (const host of normalizeDiscoveredHosts(
      (data.scan.discoveredDevices as Array<DiscoveredNetworkDevice>) || [],
    )) {
      const address: string = host.ipAddress;

      if (!address || !wanted.has(address) || seen.has(address)) {
        continue;
      }

      seen.add(address);
      picked.push(host);
    }

    return picked;
  }

  private static async readTemplateAsPerson(data: {
    templateId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<MonitorTemplate> {
    let template: MonitorTemplate | null;

    try {
      template = await MonitorTemplateService.findOneBy({
        query: {
          _id: data.templateId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          templateName: true,
          monitorType: true,
        },
        props: data.props,
      });
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        throw new NotAuthorizedException(
          "You may not read this project's monitor templates, so you cannot pick one for the imported devices.",
        );
      }

      throw error;
    }

    if (!template) {
      throw new BadDataException(
        "The monitor template was not found. It may have been deleted: pick another one.",
      );
    }

    if (template.monitorType !== MonitorType.NetworkDevice) {
      throw new BadDataException(
        "Pick a Network Device monitor template: it is the kind of monitor that reads each device's own polls.",
      );
    }

    return template;
  }

  private static initialResults(data: {
    hosts: Array<DiscoveredNetworkDevice>;
    scan: NetworkDeviceDiscoveryScan;
    settings: DiscoveryImportSettings;
  }): Array<DiscoveryImportHostResult> {
    const wantsMonitors: boolean =
      data.settings.alerting === DiscoveryImportAlerting.MonitorTemplate;

    return data.hosts.map(
      (host: DiscoveredNetworkDevice): DiscoveryImportHostResult => {
        return {
          ipAddress: host.ipAddress,
          name: buildDeviceName(host, data.scan) || host.ipAddress,
          isPingOnly: isPingOnlyDiscoveredHost(host),
          device: DiscoveryImportDeviceOutcome.Pending,
          monitor: wantsMonitors
            ? DiscoveryImportMonitorOutcome.Pending
            : DiscoveryImportMonitorOutcome.NotRequested,
        };
      },
    );
  }

  private static async enqueue(projectId: ObjectID): Promise<void> {
    await Queue.addJob(
      QueueName.Worker,
      `discovery-import-${projectId.toString()}-${ObjectID.generate().toString()}`,
      DISCOVERY_IMPORT_JOB,
      { projectId: projectId.toString() },
      {
        attempts: 1,
        skipExistenceCheck: true,
        deduplication: {
          id: `discovery-import-${projectId.toString()}`,
          keepLastIfActive: true,
        },
      },
    );
  }

  private static async findNextImport(
    projectId: ObjectID,
  ): Promise<NetworkDeviceDiscoveryImport | null> {
    const running: NetworkDeviceDiscoveryImport | null =
      await NetworkDeviceDiscoveryImportService.findOneBy({
        query: {
          projectId: projectId,
          status: DiscoveryImportStatus.Running,
        },
        select: { _id: true },
        sort: { createdAt: SortOrder.Ascending },
        props: { isRoot: true },
      });

    if (running) {
      return running;
    }

    return await NetworkDeviceDiscoveryImportService.findOneBy({
      query: {
        projectId: projectId,
        status: DiscoveryImportStatus.Queued,
      },
      select: { _id: true },
      sort: { createdAt: SortOrder.Ascending },
      props: { isRoot: true },
    });
  }

  /*
   * What a worker needs to import the hosts: the person's permissions, read
   * now; the scan, read as them; the template, with its labels, read as
   * OneUptime (its monitors are made as OneUptime, after the person's own
   * check on each).
   */
  private static async prepare(
    row: NetworkDeviceDiscoveryImport,
  ): Promise<ImportRunState> {
    if (!row.createdByUserId) {
      throw new NotAuthorizedException(
        "The person who asked for this import is no longer a user, so it was stopped.",
      );
    }

    const settings: DiscoveryImportSettings = readDiscoveryImportSettings(
      row.settings,
    );
    const props: DatabaseCommonInteractionProps = await this.readPersonProps(
      row.createdByUserId,
      row.projectId!,
    );

    this.assertCanCreateDevices(props);

    if (settings.alerting === DiscoveryImportAlerting.MonitorTemplate) {
      this.assertCanCreateMonitors(props);
    }

    const scan: NetworkDeviceDiscoveryScan = await this.readScanAsPerson({
      scanId: row.networkDeviceDiscoveryScanId!,
      projectId: row.projectId!,
      props: props,
      withHosts: false,
    });

    let template: MonitorTemplate | null = null;

    if (settings.alerting === DiscoveryImportAlerting.MonitorTemplate) {
      template = await this.loadTemplate({
        templateId: new ObjectID(settings.monitorTemplateId!),
        projectId: row.projectId!,
      });
    }

    const hosts: Array<DiscoveredNetworkDevice> = normalizeDiscoveredHosts(
      row.hosts || [],
    );
    const stored: Array<DiscoveryImportHostResult> =
      readDiscoveryImportHostResults(row.results);

    /*
     * One result per host, in the hosts' order. A row whose results do not
     * line up with its hosts (written by an older build, or by hand) is
     * rebuilt from the hosts, keeping what it says about each address.
     */
    const storedByAddress: Map<string, DiscoveryImportHostResult> = new Map<
      string,
      DiscoveryImportHostResult
    >(
      stored.map(
        (
          result: DiscoveryImportHostResult,
        ): [string, DiscoveryImportHostResult] => {
          return [result.ipAddress, result];
        },
      ),
    );
    const initial: Array<DiscoveryImportHostResult> = this.initialResults({
      hosts: hosts,
      scan: scan,
      settings: settings,
    });
    const results: Array<DiscoveryImportHostResult> = initial.map(
      (result: DiscoveryImportHostResult): DiscoveryImportHostResult => {
        return storedByAddress.get(result.ipAddress) || result;
      },
    );

    return {
      row: row,
      projectId: row.projectId!,
      userId: row.createdByUserId,
      settings: settings,
      hosts: hosts,
      results: results,
      scan: scan,
      template: template,
      props: props,
      propsReadAt: this.now(),
      lastFlushAt: this.now(),
      devicesById: new Map<string, NetworkDevice>(),
      consecutiveMonitorFailures: 0,
      lastMonitorFailure: "",
      monitorHaltReason: null,
    };
  }

  private static async readPersonProps(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<DatabaseCommonInteractionProps> {
    return await CallerPlan.withPlan(
      await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: projectId,
      }),
    );
  }

  private static async refreshPropsIfDue(state: ImportRunState): Promise<void> {
    if (
      this.now() - state.propsReadAt <
      DISCOVERY_IMPORT_PERMISSION_REFRESH_MS
    ) {
      return;
    }

    state.props = await this.readPersonProps(state.userId, state.projectId);
    state.propsReadAt = this.now();

    this.assertCanCreateDevices(state.props);

    if (state.template) {
      this.assertCanCreateMonitors(state.props);
    }
  }

  private static async loadTemplate(data: {
    templateId: ObjectID;
    projectId: ObjectID;
  }): Promise<MonitorTemplate> {
    const template: MonitorTemplate | null =
      await MonitorTemplateService.findOneBy({
        query: {
          _id: data.templateId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          projectId: true,
          templateName: true,
          monitorName: true,
          monitorDescription: true,
          monitorType: true,
          monitorSteps: true,
          monitoringInterval: true,
          minimumProbeAgreement: true,
          customFields: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!template || template.monitorType !== MonitorType.NetworkDevice) {
      throw new BadDataException(
        "The monitor template this import uses was deleted, or is no longer a Network Device template. Start the import again with another template.",
      );
    }

    /*
     * Monitors made from it carry its labels, and MonitorService takes only
     * the project's own: a template saved before its labels were checked can
     * still name another project's label. Leave that one out rather than
     * fail every monitor (the auto-import engine does the same).
     */
    template.labels = await RuleRecordScope.keepRecordsInProject({
      projectId: data.projectId,
      records: template.labels,
      modelType: Label,
      description: `labels of monitor template ${data.templateId.toString()}`,
      logAttributes: {
        projectId: data.projectId.toString(),
      } as LogAttributes,
    });

    return template;
  }

  private static async importHost(
    state: ImportRunState,
    index: number,
  ): Promise<void> {
    const host: DiscoveredNetworkDevice = state.hosts[index]!;
    const result: DiscoveryImportHostResult = state.results[index]!;

    let device: NetworkDevice | null = null;

    if (result.device === DiscoveryImportDeviceOutcome.Pending) {
      device = await this.ensureDevice(state, host, result);
    } else if (
      result.deviceId &&
      (result.device === DiscoveryImportDeviceOutcome.Created ||
        result.device === DiscoveryImportDeviceOutcome.AlreadyAdded)
    ) {
      device = await this.readDevice(state, result.deviceId);
    }

    if (result.monitor !== DiscoveryImportMonitorOutcome.Pending) {
      return;
    }

    if (!device) {
      result.monitor = DiscoveryImportMonitorOutcome.Skipped;
      result.monitorError = MONITOR_SKIPPED_DEVICE_NOT_IMPORTED;
      return;
    }

    await this.ensureMonitor(state, device, result);
  }

  private static async readDevice(
    state: ImportRunState,
    deviceId: string,
  ): Promise<NetworkDevice | null> {
    const cached: NetworkDevice | undefined = state.devicesById.get(deviceId);

    if (cached) {
      return cached;
    }

    const device: NetworkDevice | null = await NetworkDeviceService.findOneBy({
      query: {
        _id: deviceId,
        projectId: state.projectId,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        hostname: true,
        monitoringMethod: true,
      },
      props: { isRoot: true },
    });

    if (device?.id) {
      state.devicesById.set(device.id.toString(), device);
    }

    return device;
  }

  private static async findDeviceAt(
    state: ImportRunState,
    address: string,
  ): Promise<NetworkDevice | null> {
    const found: Map<string, NetworkDevice> =
      await NetworkDeviceService.getDevicesByHostnames({
        projectId: state.projectId,
        hostnames: [address],
        select: {
          _id: true,
          projectId: true,
          name: true,
          hostname: true,
          monitoringMethod: true,
        },
        props: { isRoot: true },
      });

    return found.get(address) || null;
  }

  /*
   * One host's device: found at its address, or created - under the name
   * the dialog showed, then once more with the address added when another
   * device already has that name (two hosts sharing a name is ordinary: a
   * wildcard reverse zone, a cloned config). A refusal names its reason.
   */
  private static async ensureDevice(
    state: ImportRunState,
    host: DiscoveredNetworkDevice,
    result: DiscoveryImportHostResult,
  ): Promise<NetworkDevice | null> {
    const existing: NetworkDevice | null = await this.findDeviceAt(
      state,
      host.ipAddress,
    );

    if (existing?.id) {
      result.device = DiscoveryImportDeviceOutcome.AlreadyAdded;
      result.deviceId = existing.id.toString();
      result.name = existing.name || result.name;
      state.devicesById.set(existing.id.toString(), existing);
      return existing;
    }

    const build: (name?: string) => NetworkDevice = (
      name?: string,
    ): NetworkDevice => {
      return buildNetworkDeviceFromDiscoveredHost({
        projectId: state.projectId,
        name: name,
        autoApplyVendorHealthTemplate: state.settings.applyVendorTemplates,
        pollingIntervalInMinutes: state.settings.pollingIntervalInMinutes,
        host: host,
        scan: state.scan,
      });
    };

    let created: NetworkDevice;
    let attempted: NetworkDevice = build();

    try {
      created = await NetworkDeviceService.create({
        data: attempted,
        props: state.props,
      });
    } catch (firstError) {
      /*
       * A refusal of the person is the same for every name: it is not
       * retried under another one.
       */
      if (isRefusalOfThePerson(firstError)) {
        result.device = DiscoveryImportDeviceOutcome.Failed;
        result.deviceError = toText(firstError);
        return null;
      }

      // Another import, a rule or a person created it meanwhile.
      const meanwhile: NetworkDevice | null = await this.findDeviceAt(
        state,
        host.ipAddress,
      );

      if (meanwhile?.id) {
        result.device = DiscoveryImportDeviceOutcome.AlreadyAdded;
        result.deviceId = meanwhile.id.toString();
        result.name = meanwhile.name || result.name;
        state.devicesById.set(meanwhile.id.toString(), meanwhile);
        return meanwhile;
      }

      attempted = build(buildFallbackDeviceName(host, state.scan));

      try {
        created = await NetworkDeviceService.create({
          data: attempted,
          props: state.props,
        });
      } catch {
        // The first refusal says why; the second is usually its consequence.
        result.device = DiscoveryImportDeviceOutcome.Failed;
        result.deviceError = toText(firstError);
        return null;
      }
    }

    const device: NetworkDevice = created || attempted;

    if (!device.id) {
      result.device = DiscoveryImportDeviceOutcome.Failed;
      result.deviceError =
        "The device was created but its id did not come back, so its monitor could not be made. Try this host again: the device will be found, not created twice.";
      return null;
    }

    result.device = DiscoveryImportDeviceOutcome.Created;
    result.deviceId = device.id.toString();
    result.name = device.name || attempted.name || result.name;

    const cached: NetworkDevice = new NetworkDevice();
    cached.id = device.id;
    cached.projectId = state.projectId;
    cached.name = device.name || attempted.name || result.name;
    cached.hostname = host.ipAddress;

    const monitoringMethod: string | undefined =
      device.monitoringMethod || attempted.monitoringMethod;

    if (monitoringMethod) {
      cached.monitoringMethod = monitoringMethod;
    }

    state.devicesById.set(device.id.toString(), cached);

    return cached;
  }

  /*
   * One device's monitor from the template: found by the (device, template)
   * pair if it is there - an alert policy using the same template may have
   * made it the moment the device was created - else created. The person's
   * own check runs on the monitor itself first; OneUptime then writes it,
   * provenance and all.
   */
  private static async ensureMonitor(
    state: ImportRunState,
    device: NetworkDevice,
    result: DiscoveryImportHostResult,
  ): Promise<void> {
    const template: MonitorTemplate | null = state.template;

    if (!template?.id) {
      result.monitor = DiscoveryImportMonitorOutcome.NotRequested;
      return;
    }

    if (
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(device.monitoringMethod)
    ) {
      result.monitor = DiscoveryImportMonitorOutcome.Skipped;
      result.monitorError = MONITOR_SKIPPED_MONITOR_BACKED;
      return;
    }

    const existing: Monitor | null = await this.findTemplateMonitor(
      state,
      device.id!,
      template.id,
    );

    if (existing?.id) {
      result.monitor = DiscoveryImportMonitorOutcome.AlreadyThere;
      result.monitorId = existing.id.toString();
      return;
    }

    if (state.monitorHaltReason) {
      result.monitor = DiscoveryImportMonitorOutcome.Failed;
      result.monitorError = state.monitorHaltReason;
      return;
    }

    let monitor: Monitor;

    try {
      monitor = NetworkDeviceMonitorTemplateUtil.buildMonitor({
        template: template,
        networkDevice: device,
      });
    } catch (error) {
      this.recordMonitorFailure(state, result, error);
      return;
    }

    /*
     * The person's own check, on this monitor - its table, its columns and
     * its labels - with the provenance left out: only OneUptime writes
     * that, and it is the one thing the person's own create could not
     * carry.
     */
    try {
      const asThePerson: Monitor =
        NetworkDeviceMonitorTemplateUtil.buildMonitor({
          template: template,
          networkDevice: device,
        });
      // A column left undefined is not checked: see checkDataColumnPermissions.
      (asThePerson as unknown as Record<string, unknown>)[
        "autoProvisionedNetworkDeviceId"
      ] = undefined;
      ModelPermission.checkCreatePermissions(Monitor, asThePerson, state.props);
    } catch (error) {
      if (isRefusalOfThePerson(error)) {
        result.monitor = DiscoveryImportMonitorOutcome.Failed;
        result.monitorError = toText(error);
        state.monitorHaltReason = result.monitorError;
        return;
      }

      throw error;
    }

    monitor.createdByUserId = state.userId;

    try {
      const created: Monitor = await MonitorService.create({
        data: monitor,
        props: {
          isRoot: true,
          tenantId: state.projectId,
        },
      });

      result.monitor = DiscoveryImportMonitorOutcome.Created;
      result.monitorId = (created?.id || monitor.id)?.toString() || undefined;
      state.consecutiveMonitorFailures = 0;
      state.lastMonitorFailure = "";
    } catch (error) {
      // Made by someone else meanwhile: the unique (device, template) pair.
      const meanwhile: Monitor | null = await this.findTemplateMonitor(
        state,
        device.id!,
        template.id,
      );

      if (meanwhile?.id) {
        result.monitor = DiscoveryImportMonitorOutcome.AlreadyThere;
        result.monitorId = meanwhile.id.toString();
        return;
      }

      this.recordMonitorFailure(state, result, error);
    }
  }

  private static recordMonitorFailure(
    state: ImportRunState,
    result: DiscoveryImportHostResult,
    error: unknown,
  ): void {
    const reason: string = toText(error);

    result.monitor = DiscoveryImportMonitorOutcome.Failed;
    result.monitorError = reason;

    if (reason === state.lastMonitorFailure) {
      state.consecutiveMonitorFailures++;
    } else {
      state.lastMonitorFailure = reason;
      state.consecutiveMonitorFailures = 1;
    }

    if (
      state.consecutiveMonitorFailures >=
      MAX_CONSECUTIVE_IDENTICAL_MONITOR_FAILURES
    ) {
      state.monitorHaltReason = reason;
    }
  }

  private static async findTemplateMonitor(
    state: ImportRunState,
    deviceId: ObjectID,
    templateId: ObjectID,
  ): Promise<Monitor | null> {
    return await MonitorService.findOneBy({
      query: {
        projectId: state.projectId,
        monitorTemplateId: templateId,
        autoProvisionedNetworkDeviceId: deviceId,
      },
      select: {
        _id: true,
      },
      props: { isRoot: true },
    });
  }

  private static async isStopRequested(
    state: ImportRunState,
  ): Promise<boolean> {
    const row: NetworkDeviceDiscoveryImport | null =
      await NetworkDeviceDiscoveryImportService.findOneById({
        id: state.row.id!,
        select: {
          _id: true,
          stopRequestedAt: true,
          status: true,
        },
        props: { isRoot: true },
      });

    return Boolean(
      !row || row.stopRequestedAt || !isDiscoveryImportActive(row.status),
    );
  }

  private static async flush(
    state: ImportRunState,
    force: boolean,
  ): Promise<void> {
    if (
      !force &&
      this.now() - state.lastFlushAt < DISCOVERY_IMPORT_FLUSH_INTERVAL_MS
    ) {
      return;
    }

    state.lastFlushAt = this.now();

    await NetworkDeviceDiscoveryImportService.updateOneById({
      id: state.row.id!,
      data: {
        results: state.results as never,
        progress: summarizeDiscoveryImportResults(state.results) as never,
      },
      props: { isRoot: true },
    });
  }

  private static async complete(
    state: ImportRunState,
    status: DiscoveryImportStatus,
  ): Promise<void> {
    await NetworkDeviceDiscoveryImportService.updateOneById({
      id: state.row.id!,
      data: {
        status: status,
        results: state.results as never,
        progress: summarizeDiscoveryImportResults(state.results) as never,
        completedAt: new Date(),
      },
      props: { isRoot: true },
    });
  }

  /*
   * Every host not reached is listed as such, and its monitor with it, so
   * the counts add up and Retry picks them up.
   */
  public static markNotReached(
    results: Array<DiscoveryImportHostResult>,
    reason: string,
  ): Array<DiscoveryImportHostResult> {
    return results.map(
      (result: DiscoveryImportHostResult): DiscoveryImportHostResult => {
        if (result.device === DiscoveryImportDeviceOutcome.Pending) {
          return {
            ...result,
            device: DiscoveryImportDeviceOutcome.NotReached,
            deviceError: reason,
            monitor:
              result.monitor === DiscoveryImportMonitorOutcome.Pending
                ? DiscoveryImportMonitorOutcome.Skipped
                : result.monitor,
            ...(result.monitor === DiscoveryImportMonitorOutcome.Pending
              ? { monitorError: MONITOR_SKIPPED_DEVICE_NOT_IMPORTED }
              : {}),
          };
        }

        if (result.monitor === DiscoveryImportMonitorOutcome.Pending) {
          return {
            ...result,
            monitor: DiscoveryImportMonitorOutcome.Failed,
            monitorError: reason,
          };
        }

        return result;
      },
    );
  }

  private static async failImport(
    row: NetworkDeviceDiscoveryImport,
    message: string,
    options?: { results?: Array<DiscoveryImportHostResult> | undefined },
  ): Promise<void> {
    const results: Array<DiscoveryImportHostResult> =
      options?.results ||
      this.markNotReached(
        readDiscoveryImportHostResults(row.results),
        DEVICE_NOT_REACHED_FAILED,
      );

    try {
      await NetworkDeviceDiscoveryImportService.updateOneById({
        id: row.id!,
        data: {
          status: DiscoveryImportStatus.Failed,
          error: message,
          results: results as never,
          progress: summarizeDiscoveryImportResults(results) as never,
          completedAt: new Date(),
        },
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Discovery import ${row.id?.toString()}: could not record that it failed: ${error}`,
      );
    }
  }

  private static describeStartFailure(error: unknown): string {
    if (
      error instanceof NotAuthorizedException &&
      error.message ===
        WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE
    ) {
      return "The person who asked for this import is no longer a member of the project, so it was stopped. What it created is kept.";
    }

    return toText(error);
  }
}
