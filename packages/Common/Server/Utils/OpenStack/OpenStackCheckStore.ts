import { IsBillingEnabled } from "../../EnvironmentConfig";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../../Types/Date";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OpenStackCollectionErrorCode, {
  OpenStackCollectionErrorUtil,
} from "../../../Types/OpenStack/OpenStackCollectionError";
import OpenStackCollectionMethod from "../../../Types/OpenStack/OpenStackCollectionMethod";
import {
  DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES,
  DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
  OPENSTACK_LIFECYCLE_RUNS_KEPT,
  OpenStackApiCheckJob,
  OpenStackApiCheckOutcome,
  OpenStackApiCheckResult,
  OpenStackApiServiceResult,
  OpenStackCertificateResult,
  OpenStackCheckFault,
  OpenStackCheckFaultSource,
  OpenStackCheckRemovedResource,
  OpenStackCheckReport,
  OpenStackCheckResourceKind,
  OpenStackLifecycleCheckJob,
  OpenStackLifecycleCheckOptions,
  OpenStackLifecycleJanitorResult,
  OpenStackLifecyclePhase,
  OpenStackLifecyclePhaseVerdict,
  OpenStackLifecycleRecords,
  OpenStackLifecycleRegionRecord,
  OpenStackLifecycleRun,
  OpenStackLifecycleRunBrief,
  OpenStackLifecycleRunStatus,
  OpenStackLifecycleStep,
  OpenStackLifecycleStepResult,
  isOpenStackLifecycleVerdict,
} from "../../../Types/OpenStack/OpenStackCheck";
import { OpenStackCredential } from "../../../Types/OpenStack/OpenStackProbeCollection";
import {
  OpenStackCheckConnection,
  getOpenStackCheckBindingRefusal,
  getOpenStackCheckConnection,
  normalizeOpenStackLifecycleOptions,
  readOpenStackCheckCredential,
} from "../../../Utils/OpenStack/OpenStackCheckSettings";
import {
  getOpenStackApiCheckPoints,
  getOpenStackLifecycleCheckPoints,
  toOpenStackCheckResourceMetrics,
} from "../../../Utils/OpenStack/OpenStackCheckMetrics";
import OpenStackCollectionSettings from "../../../Utils/OpenStack/OpenStackCollectionSettings";
import OpenStackProbeCollectionStore, {
  OpenStackSqlManager,
} from "./OpenStackProbeCollectionStore";
import {
  SetAsideCounts,
  getClaimSetAsideParameters,
  getClaimSetAsideStatement,
  getMakeDueNowParameters,
  getMakeDueNowStatement,
  readSetAsideCounts,
  setAsideAfterClaim,
} from "../Probe/ClaimSetAside";
import crypto from "crypto";

/*
 * THE DATABASE HALF OF THE CHECKS: which of them a probe runs now, and what it found. It is the
 * collection's store (OpenStackProbeCollectionStore), for the same reasons.
 *
 * Claiming is one statement (FOR NO KEY UPDATE SKIP LOCKED) that moves each claimed check's next
 * time an interval on, so two work requests never hand one check out twice, and no claim holds a
 * check longer than that statement runs. The checks a probe says it is still
 * running are left out, so a run slower than its interval is skipped, not stacked: that is the first
 * of the two things that keep a run from starting while one is going. The other is on the cloud
 * itself, for a probe that restarted (OpenStackLifecycleCheck).
 *
 * Only a probe that may run a check is ever handed one: the check names it, or the cloud does, and
 * it is the project's own probe, or on a self-hosted install one of the instance's own. The claim
 * holds rows written before the rules were to them too, so a stale row can be made uncheckable but
 * never hand its credential to the wrong probe.
 *
 * A check's own credential is only ever handed out for what it was entered for
 * (getOpenStackCheckBindingRefusal), and the lifecycle check is never handed the cloud's.
 *
 * Everything a probe reports is bounded and read as the shape it should be before it is stored,
 * because it goes on a page and in an incident. Text in it came from a cloud.
 */

// What the store reads of a check, and the cloud's columns it can stand on.
export interface OpenStackCheckRecord {
  _id?: string | undefined;
  id?: ObjectID | null | undefined;
  projectId?: ObjectID | undefined;
  openStackCloudId?: ObjectID | undefined;
  probeId?: ObjectID | undefined;
  authUrl?: string | undefined;
  endpointInterface?: string | undefined;
  regions?: Array<string> | undefined;
  trustedCertificateFingerprints?: Array<string> | undefined;
  credentialKind?: string | undefined;
  applicationCredentialId?: string | undefined;
  keystoneUsername?: string | undefined;
  userDomainName?: string | undefined;
  credentialProjectName?: string | undefined;
  credentialProjectDomainName?: string | undefined;
  credentialSecret?: string | undefined;
  isCredentialSet?: boolean | undefined;
  credentialBinding?: JSONObject | undefined;
  isApiCheckEnabled?: boolean | undefined;
  apiCheckIntervalInMinutes?: number | undefined;
  isLifecycleCheckEnabled?: boolean | undefined;
  lifecycleCheckIntervalInMinutes?: number | undefined;
  lifecycleProjectName?: string | undefined;
  pinnedLifecycleProjectId?: string | undefined;
  lifecycleCheckOptions?: OpenStackLifecycleCheckOptions | undefined;
  lifecycleRecords?: OpenStackLifecycleRecords | undefined;
  isSweepPending?: boolean | undefined;
  osProfilerKey?: string | undefined;
  settingsVersion?: number | undefined;
  openStackCloud?: OpenStackCheckCloudRecord | undefined;
  probe?:
    | { isGlobalProbe?: boolean | undefined; projectId?: ObjectID | undefined }
    | undefined;
}

export interface OpenStackCheckCloudRecord {
  _id?: string | undefined;
  name?: string | undefined;
  collectionMethod?: OpenStackCollectionMethod | undefined;
  collectionProbeId?: ObjectID | undefined;
  collectionProbe?:
    | { isGlobalProbe?: boolean | undefined; projectId?: ObjectID | undefined }
    | undefined;
  authUrl?: string | undefined;
  endpointInterface?: string | undefined;
  collectionRegions?: Array<string> | undefined;
  trustedCertificateFingerprints?: Array<string> | undefined;
  credentialKind?: string | undefined;
  applicationCredentialId?: string | undefined;
  keystoneUsername?: string | undefined;
  userDomainName?: string | undefined;
  projectName?: string | undefined;
  projectDomainName?: string | undefined;
  credentialSecret?: string | undefined;
  isCredentialSet?: boolean | undefined;
}

// What the store needs of the service that owns the table.
export interface OpenStackCheckService {
  /*
   * Its connection, for the claim's one self-committing statement. There is no transaction to
   * open here: a claim's row locks must never outlive its statement (OneUptime issue #7194).
   */
  getRepository: () => { manager: OpenStackSqlManager };
  findBy: (options: {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    limit: number;
    skip: number;
    props: { isRoot: boolean };
  }) => Promise<Array<OpenStackCheckRecord>>;
  findOneById: (options: {
    id: ObjectID;
    select: Record<string, unknown>;
    props: { isRoot: boolean };
  }) => Promise<OpenStackCheckRecord | null>;
  updateColumnsByIdWithoutHooks: (options: {
    id: ObjectID;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
}

// What recordReport made of a report.
export interface OpenStackCheckReportOutcome {
  accepted: boolean;
  reason?: string | undefined;
  projectId?: ObjectID | undefined;
  cloudName?: string | undefined;
  // What to send to the ingest: what this said, and what the newest lifecycle runs still say.
  resourceMetrics?: JSONArray | undefined;
}

export type OpenStackCheckKind = "api" | "lifecycle";

const CHECK_SELECT: Record<string, unknown> = {
  _id: true,
  projectId: true,
  openStackCloudId: true,
  probeId: true,
  authUrl: true,
  endpointInterface: true,
  regions: true,
  trustedCertificateFingerprints: true,
  credentialKind: true,
  applicationCredentialId: true,
  keystoneUsername: true,
  userDomainName: true,
  credentialProjectName: true,
  credentialProjectDomainName: true,
  credentialSecret: true,
  isCredentialSet: true,
  credentialBinding: true,
  isApiCheckEnabled: true,
  apiCheckIntervalInMinutes: true,
  isLifecycleCheckEnabled: true,
  lifecycleCheckIntervalInMinutes: true,
  lifecycleProjectName: true,
  pinnedLifecycleProjectId: true,
  lifecycleCheckOptions: true,
  lifecycleRecords: true,
  isSweepPending: true,
  osProfilerKey: true,
  settingsVersion: true,
  openStackCloud: {
    _id: true,
    name: true,
    collectionMethod: true,
    collectionProbeId: true,
    authUrl: true,
    endpointInterface: true,
    collectionRegions: true,
    trustedCertificateFingerprints: true,
    credentialKind: true,
    applicationCredentialId: true,
    keystoneUsername: true,
    userDomainName: true,
    projectName: true,
    projectDomainName: true,
    credentialSecret: true,
    isCredentialSet: true,
  },
};

const MAX_TEXT_LENGTH: number = 1000;
const MAX_SERVICES: number = 1024;
const MAX_CERTIFICATES: number = 256;
const MAX_WARNINGS: number = 20;
const MAX_REGIONS: number = 64;
const MAX_STEPS: number = 32;
const MAX_REMOVED: number = 64;

const API_OUTCOMES: ReadonlyArray<OpenStackApiCheckOutcome> = [
  "Answered",
  "Refused",
  "Failing",
  "NotChecked",
];
const RUN_STATUSES: ReadonlyArray<OpenStackLifecycleRunStatus> = [
  "Succeeded",
  "Failed",
  "Refused",
  "Skipped",
  "Swept",
];
const FAULT_SOURCES: ReadonlyArray<OpenStackCheckFaultSource> = [
  "keystone",
  "nova",
  "cinder",
  "neutron",
  "glance",
  "probe",
];
const RESOURCE_KINDS: ReadonlyArray<OpenStackCheckResourceKind> = [
  "server",
  "volume",
  "floating_ip",
  "security_group",
];
const PHASE_VERDICTS: ReadonlyArray<OpenStackLifecyclePhaseVerdict> = [
  "Passed",
  "Failed",
  "NotReached",
  "Off",
];

// Twelve hex characters of a hash of the check's id: what its resources are named for.
export function getOpenStackCheckKey(openStackCloudCheckId: string): string {
  return crypto
    .createHash("sha256")
    .update(openStackCloudCheckId.toLowerCase())
    .digest("hex")
    .substring(0, 12);
}

function boundText(value: unknown, maxLength: number): string | null {
  return OpenStackProbeCollectionStore.boundText(value, maxLength);
}

function wholeCount(value: unknown): number {
  const number: number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function isoDate(value: unknown): string | null {
  const text: string | null = boundText(value, 64);

  if (!text) {
    return null;
  }

  const time: number = Date.parse(text);

  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function boundList(value: unknown, max: number): Array<string> {
  return (Array.isArray(value) ? value : [])
    .map((item: unknown): string | null => {
      return boundText(item, MAX_TEXT_LENGTH);
    })
    .filter((item: string | null): item is string => {
      return item !== null;
    })
    .slice(0, max);
}

/*
 * ------------------------------------------------------------------
 * What a probe's report may hold
 * ------------------------------------------------------------------
 */

export function sanitizeOpenStackCheckFault(
  value: unknown,
): OpenStackCheckFault | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const message: string | null = boundText(raw["message"], MAX_TEXT_LENGTH);

  if (!message) {
    return undefined;
  }

  const code: number = wholeCount(raw["code"]);

  return {
    source: FAULT_SOURCES.includes(raw["source"] as OpenStackCheckFaultSource)
      ? (raw["source"] as OpenStackCheckFaultSource)
      : "probe",
    ...(code ? { code: code } : {}),
    message: message,
  };
}

const LIFECYCLE_STEPS: ReadonlyArray<string> = Object.values(
  OpenStackLifecycleStep,
);

function sanitizeStep(value: unknown): OpenStackLifecycleStepResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;

  if (!LIFECYCLE_STEPS.includes(raw["step"] as string)) {
    return null;
  }

  const fault: OpenStackCheckFault | undefined = sanitizeOpenStackCheckFault(
    raw["fault"],
  );
  const traceId: string | null = boundText(raw["traceId"], 64);

  return {
    step: raw["step"] as OpenStackLifecycleStep,
    status: raw["status"] === "Passed" ? "Passed" : "Failed",
    durationInMs: wholeCount(raw["durationInMs"]),
    ...(fault ? { fault: fault } : {}),
    ...(traceId ? { traceId: traceId } : {}),
  };
}

function sanitizeJanitor(
  value: unknown,
): OpenStackLifecycleJanitorResult | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const removed: Array<OpenStackCheckRemovedResource> = [];

  for (const item of (Array.isArray(raw["removed"])
    ? raw["removed"]
    : []
  ).slice(0, MAX_REMOVED)) {
    const entry: Record<string, unknown> = (item || {}) as Record<
      string,
      unknown
    >;
    const id: string | null = boundText(entry["id"], MAX_TEXT_LENGTH);
    const name: string | null = boundText(entry["name"], MAX_TEXT_LENGTH);

    if (
      id &&
      name &&
      RESOURCE_KINDS.includes(entry["kind"] as OpenStackCheckResourceKind)
    ) {
      removed.push({
        kind: entry["kind"] as OpenStackCheckResourceKind,
        id: id,
        name: name,
        ageInMinutes: wholeCount(entry["ageInMinutes"]),
      });
    }
  }

  return {
    removed: removed,
    remainingCount: wholeCount(raw["remainingCount"]),
    errors: boundList(raw["errors"], MAX_WARNINGS),
  };
}

export function sanitizeOpenStackLifecycleRun(
  value: unknown,
): OpenStackLifecycleRun | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const startedAt: string | null = isoDate(raw["startedAt"]);
  const finishedAt: string | null = isoDate(raw["finishedAt"]);
  const runId: string | null = boundText(raw["runId"], 64);

  if (
    !startedAt ||
    !finishedAt ||
    !runId ||
    !RUN_STATUSES.includes(raw["status"] as OpenStackLifecycleRunStatus)
  ) {
    return null;
  }

  const steps: Array<OpenStackLifecycleStepResult> = [];

  for (const item of (Array.isArray(raw["steps"]) ? raw["steps"] : []).slice(
    0,
    MAX_STEPS,
  )) {
    const step: OpenStackLifecycleStepResult | null = sanitizeStep(item);

    if (step) {
      steps.push(step);
    }
  }

  const phases: Partial<
    Record<OpenStackLifecyclePhase, OpenStackLifecyclePhaseVerdict>
  > = {};
  const rawPhases: Record<string, unknown> =
    raw["phases"] && typeof raw["phases"] === "object"
      ? (raw["phases"] as Record<string, unknown>)
      : {};

  for (const phase of Object.values(OpenStackLifecyclePhase)) {
    if (
      PHASE_VERDICTS.includes(
        rawPhases[phase] as OpenStackLifecyclePhaseVerdict,
      )
    ) {
      phases[phase] = rawPhases[phase] as OpenStackLifecyclePhaseVerdict;
    }
  }

  const fault: OpenStackCheckFault | undefined = sanitizeOpenStackCheckFault(
    raw["fault"],
  );
  const message: string | null = boundText(raw["message"], MAX_TEXT_LENGTH);
  const janitor: OpenStackLifecycleJanitorResult | undefined = sanitizeJanitor(
    raw["janitor"],
  );
  const verifiedProjectId: string | null = boundText(
    raw["verifiedProjectId"],
    255,
  );
  const verifiedProjectName: string | null = boundText(
    raw["verifiedProjectName"],
    255,
  );
  const traceId: string | null = boundText(raw["traceId"], 64);

  return {
    runId: runId,
    regionName: boundText(raw["regionName"], 255) || "",
    startedAt: startedAt,
    finishedAt: finishedAt,
    status: raw["status"] as OpenStackLifecycleRunStatus,
    ...(LIFECYCLE_STEPS.includes(raw["failedStep"] as string)
      ? { failedStep: raw["failedStep"] as OpenStackLifecycleStep }
      : {}),
    ...(fault ? { fault: fault } : {}),
    ...(message ? { message: message } : {}),
    steps: steps,
    phases: phases,
    ...(janitor ? { janitor: janitor } : {}),
    leftoverCount: wholeCount(raw["leftoverCount"]),
    ...(verifiedProjectId ? { verifiedProjectId: verifiedProjectId } : {}),
    ...(verifiedProjectName
      ? { verifiedProjectName: verifiedProjectName }
      : {}),
    ...(traceId ? { traceId: traceId } : {}),
    requestCount: wholeCount(raw["requestCount"]),
    writeCount: wholeCount(raw["writeCount"]),
    warnings: boundList(raw["warnings"], MAX_WARNINGS),
  };
}

export function sanitizeOpenStackApiCheckResult(
  value: unknown,
): OpenStackApiCheckResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const rawToken: Record<string, unknown> =
    raw["token"] && typeof raw["token"] === "object"
      ? (raw["token"] as Record<string, unknown>)
      : {};

  const startedAt: string | null = isoDate(raw["startedAt"]);

  if (!startedAt) {
    return null;
  }

  const services: Array<OpenStackApiServiceResult> = [];

  for (const item of (Array.isArray(raw["services"])
    ? raw["services"]
    : []
  ).slice(0, MAX_SERVICES)) {
    const entry: Record<string, unknown> = (item || {}) as Record<
      string,
      unknown
    >;
    const serviceType: string | null = boundText(entry["serviceType"], 255);

    if (
      !serviceType ||
      !API_OUTCOMES.includes(entry["outcome"] as OpenStackApiCheckOutcome)
    ) {
      continue;
    }

    const status: number = wholeCount(entry["status"]);
    const message: string | null = boundText(entry["message"], MAX_TEXT_LENGTH);

    services.push({
      regionName: boundText(entry["regionName"], 255) || "",
      serviceType: serviceType,
      serviceName: boundText(entry["serviceName"], 255) || "",
      read: boundText(entry["read"], MAX_TEXT_LENGTH) || "",
      outcome: entry["outcome"] as OpenStackApiCheckOutcome,
      ...(status ? { status: status } : {}),
      durationInMs: wholeCount(entry["durationInMs"]),
      ...(message ? { message: message } : {}),
    });
  }

  const certificates: Array<OpenStackCertificateResult> = [];

  for (const item of (Array.isArray(raw["certificates"])
    ? raw["certificates"]
    : []
  ).slice(0, MAX_CERTIFICATES)) {
    const entry: Record<string, unknown> = (item || {}) as Record<
      string,
      unknown
    >;
    const host: string | null = boundText(entry["host"], 255);
    const validTo: string | null = isoDate(entry["validTo"]);
    const port: number = wholeCount(entry["port"]);

    if (!host || !validTo || port <= 0 || port > 65535) {
      continue;
    }

    const subject: string | null = boundText(entry["subject"], MAX_TEXT_LENGTH);
    const issuer: string | null = boundText(entry["issuer"], MAX_TEXT_LENGTH);
    const fingerprint: string | null = boundText(entry["fingerprint256"], 255);

    certificates.push({
      host: host,
      port: port,
      validTo: validTo,
      ...(subject ? { subject: subject } : {}),
      ...(issuer ? { issuer: issuer } : {}),
      ...(fingerprint ? { fingerprint256: fingerprint } : {}),
      regionNames: boundList(entry["regionNames"], MAX_REGIONS),
      serviceTypes: boundList(entry["serviceTypes"], MAX_SERVICES),
    });
  }

  const message: string | null = boundText(
    rawToken["message"],
    MAX_TEXT_LENGTH,
  );

  return {
    startedAt: startedAt,
    durationInMs: wholeCount(raw["durationInMs"]),
    regionNames: boundList(raw["regionNames"], MAX_REGIONS),
    token: {
      status:
        rawToken["status"] === "Passed"
          ? "Passed"
          : rawToken["status"] === "BackingOff"
            ? "BackingOff"
            : "Failed",
      durationInMs: wholeCount(rawToken["durationInMs"]),
      ...(OpenStackCollectionErrorUtil.isValid(rawToken["errorCode"])
        ? { errorCode: rawToken["errorCode"] as OpenStackCollectionErrorCode }
        : {}),
      ...(message ? { message: message } : {}),
    },
    services: services,
    certificates: certificates,
    warnings: boundList(raw["warnings"], MAX_WARNINGS),
  };
}

/*
 * ------------------------------------------------------------------
 * What a report does to a check's record
 * ------------------------------------------------------------------
 */

function bootInMsOf(run: OpenStackLifecycleRun): number | undefined {
  return run.steps.find((step: OpenStackLifecycleStepResult): boolean => {
    return (
      step.step === OpenStackLifecycleStep.ServerActive &&
      step.status === "Passed"
    );
  })?.durationInMs;
}

function briefOf(run: OpenStackLifecycleRun): OpenStackLifecycleRunBrief {
  const bootInMs: number | undefined = bootInMsOf(run);

  return {
    runId: run.runId,
    finishedAt: run.finishedAt,
    status: run.status,
    durationInMs: Math.max(
      0,
      Date.parse(run.finishedAt) - Date.parse(run.startedAt),
    ),
    ...(run.failedStep ? { failedStep: run.failedStep } : {}),
    ...(run.fault ? { fault: run.fault } : {}),
    ...(run.message ? { message: run.message } : {}),
    ...(bootInMs !== undefined ? { bootInMs: bootInMs } : {}),
    ...(run.traceId ? { traceId: run.traceId } : {}),
  };
}

/*
 * A report's runs on top of what each region already said. A region the probe no longer runs in is
 * dropped, so it stops being said. A run with no region is one that could not log in and knew no
 * catalog: it speaks for every region this check already knows, if any.
 *
 * What a phase last came to survives a run that did not reach it: see OpenStackLifecyclePhaseVerdict.
 * A phase someone turned off goes, because nothing will ever say otherwise.
 */
export function mergeOpenStackLifecycleRuns(data: {
  records: OpenStackLifecycleRecords | undefined;
  runs: ReadonlyArray<OpenStackLifecycleRun>;
}): OpenStackLifecycleRecords {
  const before: OpenStackLifecycleRecords = data.records || {};
  const after: OpenStackLifecycleRecords = {};

  const known: Array<string> = Object.keys(before).filter(
    (regionName: string): boolean => {
      return Boolean(regionName);
    },
  );

  const expanded: Array<OpenStackLifecycleRun> = [];

  for (const run of data.runs) {
    if (run.regionName || known.length === 0) {
      expanded.push(run);
      continue;
    }

    for (const regionName of known) {
      expanded.push({ ...run, regionName: regionName });
    }
  }

  for (const run of expanded) {
    const previous: OpenStackLifecycleRegionRecord | undefined =
      before[run.regionName];

    const isVerdict: boolean = isOpenStackLifecycleVerdict(run.status);
    const phaseVerdicts: OpenStackLifecycleRegionRecord["phaseVerdicts"] = {
      ...(previous?.phaseVerdicts || {}),
    };

    if (isVerdict) {
      for (const phase of Object.keys(
        run.phases,
      ) as Array<OpenStackLifecyclePhase>) {
        const verdict: OpenStackLifecyclePhaseVerdict | undefined =
          run.phases[phase];

        if (verdict === "Passed" || verdict === "Failed") {
          phaseVerdicts[phase] = verdict;
        } else if (verdict === "Off") {
          delete phaseVerdicts[phase];
        }
      }
    }

    const lastVerdict: OpenStackLifecycleRun | undefined = isVerdict
      ? run
      : previous?.lastVerdict;
    const lastAttempt: OpenStackLifecycleRun | undefined = isVerdict
      ? undefined
      : run;

    after[run.regionName] = {
      regionName: run.regionName,
      ...(lastVerdict ? { lastVerdict: lastVerdict } : {}),
      ...(lastAttempt ? { lastAttempt: lastAttempt } : {}),
      phaseVerdicts: phaseVerdicts,
      recent: [briefOf(run), ...(previous?.recent || [])].slice(
        0,
        OPENSTACK_LIFECYCLE_RUNS_KEPT,
      ),
    };
  }

  return after;
}

export default class OpenStackCheckStore {
  public static getSafeApiInterval(value: number | null | undefined): number {
    const interval: number = Number(value);

    return Number.isFinite(interval) && interval >= 1
      ? Math.round(interval)
      : DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES;
  }

  public static getSafeLifecycleInterval(
    value: number | null | undefined,
  ): number {
    const interval: number = Number(value);

    return Number.isFinite(interval) && interval >= 1
      ? Math.round(interval)
      : DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES;
  }

  /*
   * The check rows that are due, moved an interval on, and locked while they are: nothing else can
   * hand these out. A check nobody may run any more is claimed and answered with nothing, so it
   * does not sit at the head of every later claim. A check the claim may not hand out at all -
   * turned off, of an archived cloud, on a probe that may not run it, of a suspended project - is
   * set aside after it (setAsideUnclaimable), for the same reason.
   *
   * One self-committing statement (OneUptime issue #7194), as the collection's claim explains
   * (OpenStackProbeCollectionStore.claimDueClouds): locked FOR NO KEY UPDATE SKIP LOCKED and moved
   * on by the same statement, so no check stays locked past it. The interval is
   * getSafeApiInterval's or getSafeLifecycleInterval's rule, in SQL (the last parameter is the
   * default); the columns are NOT NULL integers, so it is the same rule. The ids come back in claim
   * order, the longest overdue first.
   *
   * A check runs on the probe it names, or, naming none, on the probe that collects its cloud. That
   * used to be read as `COALESCE(ck."probeId", c."collectionProbeId") = $1`, which no index can
   * serve - it spans two tables - so every claim of every probe read every check of every project.
   * It is two branches now, each locking what it may hand out, oldest first, up to the limit:
   * "ownProbeDue", the checks that name this probe, a range of the (probeId, due) index that stops
   * at the limit; and "cloudProbeDue", the checks that name none, of the clouds this probe
   * collects, read through OpenStackCloud's (collectionProbeId, ...) index and each cloud's one row
   * of checks - at most one check per cloud of this probe. "due" keeps the oldest of the two, up to
   * the limit; a row a branch locked that "due" does not keep is let go when the statement ends.
   * `due <= now` and no longer `IS NULL OR`, ordered NULLS FIRST, which no btree serves: a check
   * with no due time is made due by the set-aside.
   */
  private static async claimDueIds(
    service: OpenStackCheckService,
    data: {
      kind: OpenStackCheckKind;
      probeId: ObjectID;
      runningIds: Array<string>;
      limit: number;
    },
  ): Promise<Array<string>> {
    const currentDate: Date = OneUptimeDate.getCurrentDate();

    const nextColumn: string = OpenStackCheckStore.getDueColumn(data.kind);
    const intervalColumn: string =
      data.kind === "api"
        ? "apiCheckIntervalInMinutes"
        : "lifecycleCheckIntervalInMinutes";

    const runningIds: Array<string> = data.runningIds.filter(
      (id: string): boolean => {
        return ObjectID.isValidUUID(id);
      },
    );

    const claimable: string = OpenStackCheckStore.getClaimableSql({
      kind: data.kind,
      statusesParameter: "$4",
      isBillingEnabledParameter: "$6",
    });

    const claimedRows: unknown = await service.getRepository().manager.query(
      `
      WITH "ownProbeDue" AS (
        SELECT ck."_id", ck."${nextColumn}" AS "dueAt"
        FROM "OpenStackCloudCheck" ck
        INNER JOIN "OpenStackCloud" c ON ck."openStackCloudId" = c."_id"
        INNER JOIN "Project" p ON ck."projectId" = p."_id"
        INNER JOIN "Probe" pr
          ON pr."_id" = COALESCE(ck."probeId", c."collectionProbeId")
        WHERE ck."probeId" = $1
          AND NOT (ck."_id" = ANY($5::uuid[]))
          AND ck."${nextColumn}" <= $2
          AND ${claimable}
        ORDER BY ck."${nextColumn}" ASC
        LIMIT $3
        FOR NO KEY UPDATE OF ck SKIP LOCKED
      ),
      "cloudProbeDue" AS (
        SELECT ck."_id", ck."${nextColumn}" AS "dueAt"
        FROM "OpenStackCloud" c
        INNER JOIN "OpenStackCloudCheck" ck ON ck."openStackCloudId" = c."_id"
        INNER JOIN "Project" p ON ck."projectId" = p."_id"
        INNER JOIN "Probe" pr
          ON pr."_id" = COALESCE(ck."probeId", c."collectionProbeId")
        WHERE c."collectionProbeId" = $1
          AND ck."probeId" IS NULL
          AND NOT (ck."_id" = ANY($5::uuid[]))
          AND ck."${nextColumn}" <= $2
          AND ${claimable}
        ORDER BY ck."${nextColumn}" ASC
        LIMIT $3
        FOR NO KEY UPDATE OF ck SKIP LOCKED
      ),
      "due" AS (
        SELECT "_id", "dueAt" FROM "ownProbeDue"
        UNION ALL
        SELECT "_id", "dueAt" FROM "cloudProbeDue"
        ORDER BY "dueAt" ASC
        LIMIT $3
      ),
      "claimed" AS (
        UPDATE "OpenStackCloudCheck" AS ck
        SET "${nextColumn}" = $2::timestamptz + (
            CASE
              WHEN ck."${intervalColumn}" >= 1 THEN ck."${intervalColumn}"
              ELSE $7::int
            END
          ) * INTERVAL '1 minute'
        FROM "due"
        WHERE ck."_id" = "due"."_id"
        RETURNING ck."_id"
      )
      SELECT "due"."_id"
      FROM "due"
      INNER JOIN "claimed" ON "claimed"."_id" = "due"."_id"
      ORDER BY "due"."dueAt" ASC
    `,
      [
        data.probeId.toString(),
        currentDate,
        data.limit,
        SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
        runningIds,
        IsBillingEnabled,
        data.kind === "api"
          ? DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES
          : DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
      ],
    );

    const claimedIds: Array<string> = Array.isArray(claimedRows)
      ? claimedRows.map((row: { _id: string }): string => {
          return row._id;
        })
      : [];

    /*
     * The due checks the claim stepped over - nothing may run them now - are set aside, so the
     * next claim does not step over them again (Utils/Probe/ClaimSetAside).
     */
    await setAsideAfterClaim({
      claim:
        data.kind === "api" ? "claimApiChecks" : "claimLifecycleChecks",
      probeId: data.probeId,
      rows: `OpenStack ${data.kind === "api" ? "API" : "lifecycle"} checks nothing may run now`,
      round: async (): Promise<SetAsideCounts> => {
        return await OpenStackCheckStore.setAsideUnclaimable(service, {
          kind: data.kind,
          probeId: data.probeId,
          currentDate: currentDate,
        });
      },
    });

    return claimedIds;
  }

  // The column that says when a check of this kind is next due.
  public static getDueColumn(kind: OpenStackCheckKind): string {
    return kind === "api" ? "nextApiCheckAt" : "nextLifecycleCheckAt";
  }

  /*
   * Sets aside the probe's due checks of one kind that nothing may run now (Utils/Probe/
   * ClaimSetAside): that kind turned off, deleted, of a deleted or archived cloud, on a probe that
   * may not run them, or of a suspended, blocked, sample or deleted project. Each is judged again
   * by the claim's own rule (getClaimableSql, IS NOT TRUE), so a check the claim would hand out is
   * never moved. The probe's checks are found as the claim finds them: those that name it, and
   * those that name no probe, of the clouds it collects. Makes due the probe's checks with no due
   * time of this kind at all.
   *
   * Returns how many it set aside, and how many it made due.
   */
  public static async setAsideUnclaimable(
    service: OpenStackCheckService,
    data: {
      kind: OpenStackCheckKind;
      probeId: ObjectID;
      currentDate: Date;
    },
  ): Promise<SetAsideCounts> {
    const rows: unknown = await service.getRepository().manager.query(
      getClaimSetAsideStatement({
        table: "OpenStackCloudCheck",
        alias: "ck",
        dueColumn: OpenStackCheckStore.getDueColumn(data.kind),
        sources: [
          {
            from: `"OpenStackCloudCheck" ck`,
            where: `ck."probeId" = $1`,
          },
          {
            from: `"OpenStackCloud" c
          INNER JOIN "OpenStackCloudCheck" ck ON ck."openStackCloudId" = c."_id"`,
            where: `c."collectionProbeId" = $1
            AND ck."probeId" IS NULL`,
          },
        ],
        joins: `LEFT JOIN "OpenStackCloud" c ON ck."openStackCloudId" = c."_id"
        LEFT JOIN "Project" p ON ck."projectId" = p."_id"
        LEFT JOIN "Probe" pr
          ON pr."_id" = COALESCE(ck."probeId", c."collectionProbeId")`,
        isProbesRow: `COALESCE(ck."probeId", c."collectionProbeId") = $1`,
        claimable: OpenStackCheckStore.getClaimableSql({
          kind: data.kind,
          statusesParameter: "$6",
          isBillingEnabledParameter: "$7",
        }),
      }),
      getClaimSetAsideParameters({
        probeId: data.probeId,
        currentDate: data.currentDate,
        ruleParameters: [
          SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
          IsBillingEnabled,
        ],
      }),
    );

    return readSetAsideCounts(rows);
  }

  /*
   * Whether a check of this kind may be handed to its probe now, as SQL over the aliases the
   * claim's statements use - `ck` (the OpenStackCloudCheck), `c` (its OpenStackCloud), `p` (its
   * Project) and `pr` (the probe it runs on: its own, or its cloud's) - with the served
   * subscription statuses and whether billing is on bound as the parameters named. The claim keeps
   * the checks it is true for and the set-aside moves the ones it is not true for: one definition,
   * so a check the claim would hand out is never one the set-aside moves. Read through LEFT JOINs,
   * a missing cloud, project or probe is NULL here, never true.
   *
   * - The kind is on: the API checks, or the lifecycle check or the sweep that clears up after it.
   * - Neither the check nor its cloud is deleted, and the cloud is not archived.
   * - The tenancy backstop: the project's own probe, or a global probe on an instance where those
   *   are the operator's own (billing off).
   * - The project is served (ProjectService.getActiveProjectStatusQuery): not deleted, not blocked,
   *   not a sample, and its subscriptions not inactive.
   *
   * Which probe's checks these are is not part of it: that is the range each statement reads.
   */
  public static getClaimableSql(parameters: {
    kind: OpenStackCheckKind;
    statusesParameter: string;
    isBillingEnabledParameter: string;
  }): string {
    return [
      parameters.kind === "api"
        ? `ck."isApiCheckEnabled" = true`
        : `(ck."isLifecycleCheckEnabled" = true OR ck."isSweepPending" = true)`,
      `ck."deletedAt" IS NULL`,
      `c."deletedAt" IS NULL`,
      `c."isArchived" = false`,
      `((pr."isGlobalProbe" = false AND pr."projectId" = ck."projectId") OR (pr."isGlobalProbe" = true AND ${parameters.isBillingEnabledParameter}::boolean = false))`,
      `pr."deletedAt" IS NULL`,
      `p."deletedAt" IS NULL`,
      `p."isBlocked" = false`,
      `p."isSampleProject" = false`,
      `(p."paymentProviderSubscriptionStatus" IS NULL OR p."paymentProviderSubscriptionStatus" = ANY(${parameters.statusesParameter}::text[]))`,
      `(p."paymentProviderMeteredSubscriptionStatus" IS NULL OR p."paymentProviderMeteredSubscriptionStatus" = ANY(${parameters.statusesParameter}::text[]))`,
    ].join("\n          AND ");
  }

  /*
   * Makes checks due now, both kinds, unless they are due already (Utils/Probe/ClaimSetAside,
   * getMakeDueNowStatement): for a write that makes a check the claim set aside claimable again
   * and does not make it due itself, such as its cloud unarchived (OpenStackCloudService). A kind
   * turned on, a sweep or a run asked for make themselves due (OpenStackCheckSettings). `byCloud`
   * names the checks by their cloud. Any service's connection will do: this is one statement.
   */
  public static async makeDueNow(
    service: Pick<OpenStackCheckService, "getRepository">,
    data: {
      ids: Array<ObjectID>;
      byCloud?: boolean | undefined;
    },
  ): Promise<void> {
    const parameters: Array<unknown> | null = getMakeDueNowParameters({
      ids: data.ids,
      currentDate: OneUptimeDate.getCurrentDate(),
    });

    if (!parameters) {
      return;
    }

    await service.getRepository().manager.query(
      getMakeDueNowStatement({
        table: "OpenStackCloudCheck",
        dueColumns: [
          OpenStackCheckStore.getDueColumn("api"),
          OpenStackCheckStore.getDueColumn("lifecycle"),
        ],
        idColumn: data.byCloud ? "openStackCloudId" : "_id",
      }),
      parameters,
    );
  }

  private static async readClaimed(
    service: OpenStackCheckService,
    claimedIds: Array<string>,
  ): Promise<Array<OpenStackCheckRecord>> {
    if (claimedIds.length === 0) {
      return [];
    }

    // Read as OneUptime: the secret and the key are decrypted on read.
    const rows: Array<OpenStackCheckRecord> = await service.findBy({
      query: { _id: QueryHelper.any(claimedIds) },
      select: CHECK_SELECT,
      limit: claimedIds.length,
      skip: 0,
      props: { isRoot: true },
    });

    return OpenStackProbeCollectionStore.inClaimOrder(rows, claimedIds);
  }

  /*
   * What is true of this check right now that keeps it from running, in a sentence, so the page can
   * say why it has stopped when nothing about the cloud has.
   */
  private static async noteWhyNotRunning(
    service: OpenStackCheckService,
    check: OpenStackCheckRecord,
    reason: string,
  ): Promise<void> {
    logger.debug(`OpenStack check ${check._id} was not handed out: ${reason}`);

    if (check._id) {
      await service.updateColumnsByIdWithoutHooks({
        id: new ObjectID(check._id.toString()),
        data: { checkError: reason },
      });
    }
  }

  private static getApiCredential(data: {
    check: OpenStackCheckRecord;
    cloud: OpenStackCheckCloudRecord;
    connection: OpenStackCheckConnection;
  }): { credential: OpenStackCredential } | { error: string } {
    const { check, cloud, connection } = data;

    // Its own, when it has one, and only for what it was entered for.
    if (check.isCredentialSet) {
      const refusal: string | null = getOpenStackCheckBindingRefusal({
        saved: check.credentialBinding,
        connection: connection,
      });

      if (refusal) {
        return { error: refusal };
      }

      const credential: OpenStackCredential | null =
        readOpenStackCheckCredential(check);

      return credential
        ? { credential: credential }
        : { error: "The saved credential could not be read. Enter it again." };
    }

    /*
     * The cloud's, only where it is the very connection the cloud is collected on, by the probe
     * that collects it. That is where it already goes.
     */
    if (
      connection.isCloudsOwn &&
      connection.probeId === cloud.collectionProbeId?.toString()
    ) {
      const credential: OpenStackCredential | null =
        OpenStackProbeCollectionStore.readCredential(cloud);

      if (credential) {
        return { credential: credential };
      }
    }

    return {
      error:
        "Give these checks a credential: the one this cloud is collected with is gone, or goes through another probe.",
    };
  }

  // The API checks due for this probe, with the credential each runs with.
  public static async claimApiChecks(
    service: OpenStackCheckService,
    data: {
      probeId: ObjectID;
      runningIds: Array<string>;
      limit: number;
    },
  ): Promise<Array<OpenStackApiCheckJob>> {
    if (data.limit <= 0) {
      return [];
    }

    const claimedIds: Array<string> = await OpenStackCheckStore.claimDueIds(
      service,
      {
        kind: "api",
        probeId: data.probeId,
        runningIds: data.runningIds,
        limit: data.limit,
      },
    );

    const jobs: Array<OpenStackApiCheckJob> = [];

    for (const check of await OpenStackCheckStore.readClaimed(
      service,
      claimedIds,
    )) {
      const cloud: OpenStackCheckCloudRecord | undefined = check.openStackCloud;

      if (!cloud || !check._id || !check.openStackCloudId) {
        continue;
      }

      const connection: OpenStackCheckConnection = getOpenStackCheckConnection({
        check: check,
        cloud: cloud,
      });

      if (!connection.authUrl) {
        await OpenStackCheckStore.noteWhyNotRunning(
          service,
          check,
          "Give these checks Keystone's address and a credential: this cloud no longer has a probe that collects it.",
        );
        continue;
      }

      const read: { credential: OpenStackCredential } | { error: string } =
        OpenStackCheckStore.getApiCredential({
          check: check,
          cloud: cloud,
          connection: connection,
        });

      if ("error" in read) {
        await OpenStackCheckStore.noteWhyNotRunning(service, check, read.error);
        continue;
      }

      jobs.push({
        openStackCloudCheckId: check._id.toString(),
        openStackCloudId: check.openStackCloudId.toString(),
        cloudName: cloud.name || "",
        authUrl: connection.authUrl,
        regions: connection.regions,
        endpointInterface: connection.endpointInterface,
        trustedCertificateFingerprints:
          OpenStackProbeCollectionStore.readFingerprints(
            connection.trustedCertificateFingerprints,
          ),
        settingsVersion: check.settingsVersion || 0,
        credential: read.credential,
        intervalInMinutes: OpenStackCheckStore.getSafeApiInterval(
          check.apiCheckIntervalInMinutes,
        ),
      });
    }

    return jobs;
  }

  /*
   * The lifecycle checks due for this probe. Only ever with the check's own credential, whichever
   * connection it uses, because it writes.
   */
  public static async claimLifecycleChecks(
    service: OpenStackCheckService,
    data: {
      probeId: ObjectID;
      runningIds: Array<string>;
      limit: number;
    },
  ): Promise<Array<OpenStackLifecycleCheckJob>> {
    if (data.limit <= 0) {
      return [];
    }

    const claimedIds: Array<string> = await OpenStackCheckStore.claimDueIds(
      service,
      {
        kind: "lifecycle",
        probeId: data.probeId,
        runningIds: data.runningIds,
        limit: data.limit,
      },
    );

    const jobs: Array<OpenStackLifecycleCheckJob> = [];

    for (const check of await OpenStackCheckStore.readClaimed(
      service,
      claimedIds,
    )) {
      const cloud: OpenStackCheckCloudRecord | undefined = check.openStackCloud;

      if (!cloud || !check._id || !check.openStackCloudId) {
        continue;
      }

      const connection: OpenStackCheckConnection = getOpenStackCheckConnection({
        check: check,
        cloud: cloud,
      });

      const credential: OpenStackCredential | null =
        readOpenStackCheckCredential(check);

      const refusal: string | null = !connection.authUrl
        ? "Give this check Keystone's address: this cloud no longer has a probe that collects it."
        : !credential
          ? "Give the lifecycle check a credential of its own."
          : !check.lifecycleProjectName
            ? "Say which project the lifecycle check has to itself."
            : getOpenStackCheckBindingRefusal({
                saved: check.credentialBinding,
                connection: connection,
              });

      if (refusal) {
        await OpenStackCheckStore.noteWhyNotRunning(service, check, refusal);
        continue;
      }

      const options:
        | { options: OpenStackLifecycleCheckOptions }
        | { error: string } = normalizeOpenStackLifecycleOptions(
        check.lifecycleCheckOptions,
      );

      /*
       * The regions it speaks for if it cannot log in to read the catalog: those set, or else the
       * ones it last found.
       */
      const regions: Array<string> =
        connection.regions.length > 0
          ? connection.regions
          : Object.keys(check.lifecycleRecords || {}).filter(Boolean);

      jobs.push({
        openStackCloudCheckId: check._id.toString(),
        openStackCloudId: check.openStackCloudId.toString(),
        cloudName: cloud.name || "",
        authUrl: connection.authUrl as string,
        regions: regions,
        endpointInterface: connection.endpointInterface,
        trustedCertificateFingerprints:
          OpenStackProbeCollectionStore.readFingerprints(
            connection.trustedCertificateFingerprints,
          ),
        settingsVersion: check.settingsVersion || 0,
        credential: credential as OpenStackCredential,
        intervalInMinutes: OpenStackCheckStore.getSafeLifecycleInterval(
          check.lifecycleCheckIntervalInMinutes,
        ),
        checkKey: getOpenStackCheckKey(check._id.toString()),
        expectedProjectName: check.lifecycleProjectName as string,
        ...(check.pinnedLifecycleProjectId
          ? { pinnedProjectId: check.pinnedLifecycleProjectId }
          : {}),
        options: "options" in options ? options.options : {},
        ...(check.osProfilerKey ? { osProfilerKey: check.osProfilerKey } : {}),
        ...(check.isLifecycleCheckEnabled ? {} : { isSweepOnly: true }),
      });
    }

    return jobs;
  }

  /*
   * What a probe found. Only the check's own probe is heard, and only for its current settings:
   * what a run found under older ones is about a project or a credential no longer in use.
   */
  public static async recordReport(
    service: OpenStackCheckService,
    data: {
      probeId: ObjectID;
      report: OpenStackCheckReport;
      scopeVersion: string;
      now?: Date | undefined;
    },
  ): Promise<OpenStackCheckReportOutcome> {
    const report: OpenStackCheckReport = data.report;

    if (
      !report.openStackCloudCheckId ||
      !ObjectID.isValidUUID(report.openStackCloudCheckId)
    ) {
      return { accepted: false, reason: "The report names no check." };
    }

    const check: OpenStackCheckRecord | null = await service.findOneById({
      id: new ObjectID(report.openStackCloudCheckId),
      select: {
        _id: true,
        projectId: true,
        probeId: true,
        isApiCheckEnabled: true,
        isLifecycleCheckEnabled: true,
        isSweepPending: true,
        settingsVersion: true,
        lifecycleCheckIntervalInMinutes: true,
        lifecycleRecords: true,
        pinnedLifecycleProjectId: true,
        probe: { _id: true, isGlobalProbe: true, projectId: true },
        openStackCloud: {
          _id: true,
          name: true,
          collectionProbeId: true,
          collectionProbe: { _id: true, isGlobalProbe: true, projectId: true },
        },
      },
      props: { isRoot: true },
    });

    const cloud: OpenStackCheckCloudRecord | undefined = check?.openStackCloud;
    const probeOfCheck: string | undefined =
      check?.probeId?.toString() || cloud?.collectionProbeId?.toString();

    if (
      !check ||
      !check.projectId ||
      !cloud ||
      !probeOfCheck ||
      probeOfCheck.toLowerCase() !== data.probeId.toString().toLowerCase()
    ) {
      return {
        accepted: false,
        reason:
          "This probe does not run that check (any more): it was deleted, or moved to another probe.",
      };
    }

    const refusal: string | null = OpenStackCollectionSettings.getProbeRefusal({
      probe: {
        isGlobalProbe:
          check.probe?.isGlobalProbe ?? cloud.collectionProbe?.isGlobalProbe,
        projectId:
          (
            check.probe?.projectId || cloud.collectionProbe?.projectId
          )?.toString() || null,
      },
      projectId: check.projectId.toString(),
      isBillingEnabled: IsBillingEnabled,
    });

    if (refusal) {
      return { accepted: false, reason: refusal };
    }

    if (Number(report.settingsVersion) !== Number(check.settingsVersion || 0)) {
      return {
        accepted: false,
        reason: "This report is of settings that have since changed.",
      };
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const values: Record<string, unknown> = {};
    let records: OpenStackLifecycleRecords = check.lifecycleRecords || {};

    const intervalInMinutes: number =
      OpenStackCheckStore.getSafeLifecycleInterval(
        check.lifecycleCheckIntervalInMinutes,
      );

    const points: ReturnType<typeof getOpenStackApiCheckPoints> = [];

    if (report.kind === "api") {
      const result: OpenStackApiCheckResult | null =
        sanitizeOpenStackApiCheckResult(report.api);

      if (!result) {
        return { accepted: false, reason: "The report holds no API check." };
      }

      values["apiCheckResult"] = result;
      values["lastApiCheckAt"] = now;
      points.push(
        ...getOpenStackApiCheckPoints({ result: result, now: now.getTime() }),
      );
    } else if (report.kind === "lifecycle") {
      const runs: Array<OpenStackLifecycleRun> = [];

      for (const item of (Array.isArray(report.lifecycle)
        ? report.lifecycle
        : []
      ).slice(0, MAX_REGIONS)) {
        const run: OpenStackLifecycleRun | null =
          sanitizeOpenStackLifecycleRun(item);

        if (run) {
          runs.push(run);
        }
      }

      if (runs.length === 0) {
        return {
          accepted: false,
          reason: "The report holds no lifecycle run.",
        };
      }

      values["lastLifecycleCheckAt"] = now;

      const isSweep: boolean = runs.every(
        (run: OpenStackLifecycleRun): boolean => {
          return run.status === "Swept";
        },
      );

      if (isSweep) {
        /*
         * A sweep is not a run of the cloud, and what it found is only whether anything is left.
         * With nothing left and nothing else to do, the secret has done all it was kept for.
         */
        const isClean: boolean = runs.every(
          (run: OpenStackLifecycleRun): boolean => {
            return (
              run.janitor !== undefined && run.janitor.remainingCount === 0
            );
          },
        );

        if (isClean && check.isSweepPending) {
          values["isSweepPending"] = false;

          if (!check.isApiCheckEnabled && !check.isLifecycleCheckEnabled) {
            values["credentialSecret"] = null;
            values["osProfilerKey"] = null;
            values["isCredentialSet"] = false;
            values["isOsProfilerKeySet"] = false;
            values["credentialBinding"] = null;
            values["pinnedLifecycleProjectId"] = null;
          }
        }
      } else {
        records = mergeOpenStackLifecycleRuns({
          records: check.lifecycleRecords,
          runs: runs,
        });

        values["lifecycleRecords"] = records;

        /*
         * Pinned the first time a run verifies it, so a credential swapped for one on another
         * project of the same name is refused from then on.
         */
        const verified: OpenStackLifecycleRun | undefined = runs.find(
          (run: OpenStackLifecycleRun): boolean => {
            return Boolean(run.verifiedProjectId) && run.status !== "Refused";
          },
        );

        if (!check.pinnedLifecycleProjectId && verified?.verifiedProjectId) {
          values["pinnedLifecycleProjectId"] = verified.verifiedProjectId;
        }
      }
    } else {
      return { accepted: false, reason: "That is not a kind of report." };
    }

    points.push(
      ...getOpenStackLifecycleCheckPoints({
        records: check.isLifecycleCheckEnabled ? records : {},
        intervalInMinutes: intervalInMinutes,
        now: now.getTime(),
      }),
    );

    values["checkError"] = null;

    try {
      await service.updateColumnsByIdWithoutHooks({
        id: check.id || new ObjectID(report.openStackCloudCheckId),
        data: values,
      });
    } catch (error) {
      logger.error(
        `Could not record the check ${report.openStackCloudCheckId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }

    return {
      accepted: true,
      projectId: check.projectId,
      cloudName: cloud.name || undefined,
      resourceMetrics: toOpenStackCheckResourceMetrics({
        points: points,
        now: now.getTime(),
        scopeVersion: data.scopeVersion,
      }),
    };
  }
}
