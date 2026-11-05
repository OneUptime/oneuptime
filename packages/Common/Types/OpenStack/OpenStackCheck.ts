import OpenStackCollectionErrorCode from "./OpenStackCollectionError";
import {
  OpenStackCredential,
  OpenStackEndpointInterface,
} from "./OpenStackProbeCollection";

/*
 * WHAT A PROBE CHECKS FROM OUTSIDE AN OPENSTACK CLOUD, AND HOW IT SAYS WHAT IT FOUND.
 *
 * Every service can report healthy while nobody can boot an instance: oslo.middleware's
 * /healthcheck shows reachability and no more, so the real test is doing what users do.
 * Two checks do that, from a probe outside the cloud, because a check inside a failed
 * cloud says nothing:
 *
 *   API checks          read-only, every minute by default. Keystone issues a token, each
 *                       service in the catalog answers an authenticated one-row read, and
 *                       each public endpoint's certificate is read for when it expires.
 *   The lifecycle check every 30 minutes by default, and only for someone who opts in. In
 *                       a project of its own, with a credential of its own: create a
 *                       server, wait for ACTIVE, optionally attach a floating IP and ping
 *                       it, optionally create and attach a volume, then delete everything.
 *
 * The conversation is the collection's (OpenStackProbeCollection), over the same probe
 * routes, and for the same reasons: credentials travel only in the answer to a probe's own
 * authenticated request for work, only to the probe the check names, and the probe keeps
 * them in memory only.
 *
 *   POST /probe/openstack/checks/work  { runningApiCheckIds, runningLifecycleCheckIds }
 *                                      -> OpenStackCheckWorkResponse
 *   POST /probe/openstack/checks/report  OpenStackCheckReport
 *
 * What is stored here is read back years later, so the strings in these enums are never
 * renamed, only added to. #5750 (SLOs and status pages) reads these series by these names.
 */

// How often the API checks run. Offered as a choice, not typed: see the alert templates.
export const DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES: number = 1;
export const OPENSTACK_API_CHECK_INTERVALS_IN_MINUTES: ReadonlyArray<number> = [
  1, 2, 5,
];

export const DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES: number = 30;
export const MIN_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES: number = 15;
export const MAX_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES: number =
  24 * 60;

export const DEFAULT_OPENSTACK_LIFECYCLE_VOLUME_SIZE_IN_GIB: number = 1;
export const MAX_OPENSTACK_LIFECYCLE_VOLUME_SIZE_IN_GIB: number = 16;

// The most API checks one probe runs at a time, and lifecycle checks.
export const OPENSTACK_PROBE_API_CHECK_CONCURRENCY: number = 16;
export const OPENSTACK_PROBE_LIFECYCLE_CHECK_CONCURRENCY: number = 4;

/*
 * How many runs of each region a cloud's record keeps, for the page to list. The series keep
 * the rest.
 */
export const OPENSTACK_LIFECYCLE_RUNS_KEPT: number = 20;

/*
 * WHAT THE LIFECYCLE CHECK DOES, in the order it does it. Each one's duration is a metric,
 * and a failed run names one of these: stored and charted, so never renamed.
 */
export enum OpenStackLifecycleStep {
  // Keystone issues a token.
  Token = "token",
  // The credential is what it should be. Nothing is written before this passes.
  CredentialCheck = "credential_check",
  // Finding the flavor, image and networks, and what earlier runs left.
  Prepare = "prepare",
  // Deleting what earlier runs left, once it is older than two intervals.
  Janitor = "janitor",
  // A security group that lets a ping in, for a run that pings.
  SecurityGroupCreate = "security_group_create",
  // Nova accepts the request for a server.
  ServerCreate = "server_create",
  // The server reaches ACTIVE: the boot itself.
  ServerActive = "server_active",
  FloatingIpCreate = "floating_ip_create",
  // The first reply from the floating IP.
  Ping = "ping",
  // Cinder makes a volume, and it reaches available.
  VolumeCreate = "volume_create",
  // Nova attaches it, and it reaches in-use.
  VolumeAttach = "volume_attach",
  VolumeDetach = "volume_detach",
  VolumeDelete = "volume_delete",
  FloatingIpDelete = "floating_ip_delete",
  ServerDelete = "server_delete",
  SecurityGroupDelete = "security_group_delete",
}

/*
 * What the steps add up to, and what an alert template reads: one incident per region, on
 * whichever of these failed.
 */
export enum OpenStackLifecyclePhase {
  Credential = "credential",
  Boot = "boot",
  FloatingIp = "floating_ip",
  Volume = "volume",
  Cleanup = "cleanup",
}

export const OPENSTACK_LIFECYCLE_STEP_PHASE: Readonly<
  Record<OpenStackLifecycleStep, OpenStackLifecyclePhase>
> = {
  [OpenStackLifecycleStep.Token]: OpenStackLifecyclePhase.Credential,
  [OpenStackLifecycleStep.CredentialCheck]: OpenStackLifecyclePhase.Credential,
  [OpenStackLifecycleStep.Prepare]: OpenStackLifecyclePhase.Boot,
  [OpenStackLifecycleStep.Janitor]: OpenStackLifecyclePhase.Cleanup,
  [OpenStackLifecycleStep.SecurityGroupCreate]:
    OpenStackLifecyclePhase.FloatingIp,
  [OpenStackLifecycleStep.ServerCreate]: OpenStackLifecyclePhase.Boot,
  [OpenStackLifecycleStep.ServerActive]: OpenStackLifecyclePhase.Boot,
  [OpenStackLifecycleStep.FloatingIpCreate]: OpenStackLifecyclePhase.FloatingIp,
  [OpenStackLifecycleStep.Ping]: OpenStackLifecyclePhase.FloatingIp,
  [OpenStackLifecycleStep.VolumeCreate]: OpenStackLifecyclePhase.Volume,
  [OpenStackLifecycleStep.VolumeAttach]: OpenStackLifecyclePhase.Volume,
  [OpenStackLifecycleStep.VolumeDetach]: OpenStackLifecyclePhase.Cleanup,
  [OpenStackLifecycleStep.VolumeDelete]: OpenStackLifecyclePhase.Cleanup,
  [OpenStackLifecycleStep.FloatingIpDelete]: OpenStackLifecyclePhase.Cleanup,
  [OpenStackLifecycleStep.ServerDelete]: OpenStackLifecyclePhase.Cleanup,
  [OpenStackLifecycleStep.SecurityGroupDelete]: OpenStackLifecyclePhase.Cleanup,
};

export const OPENSTACK_LIFECYCLE_STEP_TITLES: Readonly<
  Record<OpenStackLifecycleStep, string>
> = {
  [OpenStackLifecycleStep.Token]: "Keystone issues a token",
  [OpenStackLifecycleStep.CredentialCheck]: "Check the credential",
  [OpenStackLifecycleStep.Prepare]: "Find the flavor, image and network",
  [OpenStackLifecycleStep.Janitor]: "Delete what earlier runs left",
  [OpenStackLifecycleStep.SecurityGroupCreate]: "Create a security group",
  [OpenStackLifecycleStep.ServerCreate]: "Create the server",
  [OpenStackLifecycleStep.ServerActive]: "Wait for ACTIVE",
  [OpenStackLifecycleStep.FloatingIpCreate]: "Attach a floating IP",
  [OpenStackLifecycleStep.Ping]: "Ping the floating IP",
  [OpenStackLifecycleStep.VolumeCreate]: "Create a volume",
  [OpenStackLifecycleStep.VolumeAttach]: "Attach the volume",
  [OpenStackLifecycleStep.VolumeDetach]: "Detach the volume",
  [OpenStackLifecycleStep.VolumeDelete]: "Delete the volume",
  [OpenStackLifecycleStep.FloatingIpDelete]: "Delete the floating IP",
  [OpenStackLifecycleStep.ServerDelete]: "Delete the server",
  [OpenStackLifecycleStep.SecurityGroupDelete]: "Delete the security group",
};

export const OPENSTACK_LIFECYCLE_PHASE_TITLES: Readonly<
  Record<OpenStackLifecyclePhase, string>
> = {
  [OpenStackLifecyclePhase.Credential]: "Credential",
  [OpenStackLifecyclePhase.Boot]: "Instance boot",
  [OpenStackLifecyclePhase.FloatingIp]: "Floating IP",
  [OpenStackLifecyclePhase.Volume]: "Volume",
  [OpenStackLifecyclePhase.Cleanup]: "Clean-up",
};

export type OpenStackLifecycleStepStatus = "Passed" | "Failed";

/*
 * What became of one phase in one run. NotReached is a run that stopped before it, and says
 * nothing: an incident open on it stays open. Off is a phase this check is not set to do.
 */
export type OpenStackLifecyclePhaseVerdict =
  | "Passed"
  | "Failed"
  | "NotReached"
  | "Off";

/*
 *   Succeeded  every step passed.
 *   Failed     a step failed. The run names the first, and the fault it met.
 *   Refused    the credential is not one this check will write with. Nothing was written.
 *   Skipped    another run's server is younger than a run can take, so one may be going,
 *              and a run never starts while one is going. It says nothing about the cloud.
 *   Swept      the check was turned off, and this only cleared up what it had left.
 */
export type OpenStackLifecycleRunStatus =
  | "Succeeded"
  | "Failed"
  | "Refused"
  | "Skipped"
  | "Swept";

// Who said what went wrong. A person reads this as "Nova said ...".
export type OpenStackCheckFaultSource =
  | "keystone"
  | "nova"
  | "cinder"
  | "neutron"
  | "glance"
  | "probe";

export const OPENSTACK_CHECK_FAULT_SOURCE_TITLES: Readonly<
  Record<OpenStackCheckFaultSource, string>
> = {
  keystone: "Keystone",
  nova: "Nova",
  cinder: "Cinder",
  neutron: "Neutron",
  glance: "Glance",
  probe: "The probe",
};

export interface OpenStackCheckFault {
  source: OpenStackCheckFaultSource;
  // Nova's own fault code, or the HTTP status an API answered with.
  code?: number | undefined;
  // In the service's words, bounded. Text from outside OneUptime: never trusted as markup.
  message: string;
}

export interface OpenStackLifecycleStepResult {
  step: OpenStackLifecycleStep;
  status: OpenStackLifecycleStepStatus;
  durationInMs: number;
  fault?: OpenStackCheckFault | undefined;
  // Which trace this step's signed requests are in: see OpenStackTraces.
  traceId?: string | undefined;
}

export type OpenStackCheckResourceKind =
  | "server"
  | "volume"
  | "floating_ip"
  | "security_group";

// One thing the janitor removed, by what it is called.
export interface OpenStackCheckRemovedResource {
  kind: OpenStackCheckResourceKind;
  id: string;
  name: string;
  ageInMinutes: number;
}

export interface OpenStackLifecycleJanitorResult {
  removed: Array<OpenStackCheckRemovedResource>;
  // Named for this check, and still there: too young to remove, or it would not go.
  remainingCount: number;
  errors: Array<string>;
}

export interface OpenStackLifecycleRun {
  // <stamp>-<random>, as in the name of everything the run makes.
  runId: string;
  regionName: string;
  // ISO dates, on the probe's clock.
  startedAt: string;
  finishedAt: string;
  status: OpenStackLifecycleRunStatus;
  // The first step that failed, and what it met. What an incident says.
  failedStep?: OpenStackLifecycleStep | undefined;
  fault?: OpenStackCheckFault | undefined;
  // A sentence for what is not a fault: why it refused or skipped.
  message?: string | undefined;
  steps: Array<OpenStackLifecycleStepResult>;
  phases: Partial<
    Record<OpenStackLifecyclePhase, OpenStackLifecyclePhaseVerdict>
  >;
  janitor?: OpenStackLifecycleJanitorResult | undefined;
  // What this run itself could not delete, for the janitor to see to.
  leftoverCount: number;
  // The project the token was for: pinned once a run has verified it.
  verifiedProjectId?: string | undefined;
  verifiedProjectName?: string | undefined;
  // The trace of the whole run, when it was signed with the OSProfiler key.
  traceId?: string | undefined;
  requestCount: number;
  writeCount: number;
  warnings: Array<string>;
}

/*
 * ------------------------------------------------------------------
 * API checks
 * ------------------------------------------------------------------
 */

/*
 *   Answered   it answered the read.
 *   Refused    it answered, and this credential may not read that. The API is working.
 *   Failing    a 5xx, a timeout, no connection, or it refused a token Keystone just issued.
 *   NotChecked the catalog names a URL a probe will not send a token to: plain HTTP, or an
 *              address it never connects to. Nothing was sent, so nothing is known.
 */
export type OpenStackApiCheckOutcome =
  | "Answered"
  | "Refused"
  | "Failing"
  | "NotChecked";

export interface OpenStackApiServiceResult {
  regionName: string;
  // As the catalog has it: compute, block-storage, load-balancer ...
  serviceType: string;
  serviceName: string;
  // What was asked, for a person to try: GET /servers?limit=1.
  read: string;
  outcome: OpenStackApiCheckOutcome;
  status?: number | undefined;
  durationInMs: number;
  message?: string | undefined;
}

export interface OpenStackApiTokenResult {
  /*
   * BackingOff: this credential was refused, and repeating a refused credential is what locks
   * an account, so it is asked again later. It still reads as failing.
   */
  status: "Passed" | "Failed" | "BackingOff";
  durationInMs: number;
  errorCode?: OpenStackCollectionErrorCode | undefined;
  message?: string | undefined;
}

export interface OpenStackCertificateResult {
  host: string;
  port: number;
  // ISO date. A certificate that has already expired is still reported, and reads negative.
  validTo: string;
  subject?: string | undefined;
  issuer?: string | undefined;
  fingerprint256?: string | undefined;
  regionNames: Array<string>;
  serviceTypes: Array<string>;
}

export interface OpenStackApiCheckResult {
  startedAt: string;
  durationInMs: number;
  regionNames: Array<string>;
  token: OpenStackApiTokenResult;
  services: Array<OpenStackApiServiceResult>;
  certificates: Array<OpenStackCertificateResult>;
  warnings: Array<string>;
}

/*
 * ------------------------------------------------------------------
 * What a probe is handed, and what it says back
 * ------------------------------------------------------------------
 */

interface OpenStackCheckJobBase {
  openStackCloudCheckId: string;
  openStackCloudId: string;
  // For the probe's own log lines only.
  cloudName: string;
  authUrl: string;
  // Empty: every region the catalog names.
  regions: Array<string>;
  endpointInterface: OpenStackEndpointInterface;
  trustedCertificateFingerprints: Array<string>;
  // Echoed in the report, so an old report never overwrites new settings' status.
  settingsVersion: number;
}

export interface OpenStackApiCheckJob extends OpenStackCheckJobBase {
  credential: OpenStackCredential;
  intervalInMinutes: number;
}

export interface OpenStackLifecycleCheckOptions {
  // A name or an ID. Left out: the smallest that will do, chosen at each run.
  flavor?: string | undefined;
  image?: string | undefined;
  network?: string | undefined;
  isFloatingIpEnabled?: boolean | undefined;
  // The external network its addresses come from. Left out: the only one there is.
  floatingIpNetwork?: string | undefined;
  isVolumeEnabled?: boolean | undefined;
  volumeSizeInGiB?: number | undefined;
  volumeType?: string | undefined;
}

export interface OpenStackLifecycleCheckJob extends OpenStackCheckJobBase {
  credential: OpenStackCredential;
  intervalInMinutes: number;
  /*
   * What everything this check creates is named for: twelve hex characters of a hash of its
   * own id, so two checks on one project never touch what the other made.
   */
  checkKey: string;
  // The project a person said this check has to itself. A token for any other is refused.
  expectedProjectName: string;
  // Its id, once a run has verified it. A token for any other id is refused too.
  pinnedProjectId?: string | undefined;
  options: OpenStackLifecycleCheckOptions;
  // Signs a run's writes, so a slow boot has a trace. Never reported, and never logged.
  osProfilerKey?: string | undefined;
  /*
   * The check was turned off. No run, only the janitor, until nothing named for this check
   * is left.
   */
  isSweepOnly?: boolean | undefined;
}

export interface OpenStackCheckWorkResponse {
  apiChecks: Array<OpenStackApiCheckJob>;
  lifecycleChecks: Array<OpenStackLifecycleCheckJob>;
}

export type OpenStackCheckReportKind = "api" | "lifecycle";

export interface OpenStackCheckReport {
  openStackCloudCheckId: string;
  settingsVersion: number;
  kind: OpenStackCheckReportKind;
  api?: OpenStackApiCheckResult | undefined;
  lifecycle?: Array<OpenStackLifecycleRun> | undefined;
}

/*
 * ------------------------------------------------------------------
 * What a check's row keeps
 * ------------------------------------------------------------------
 */

// One run, shortly, for a region's list of what happened lately.
export interface OpenStackLifecycleRunBrief {
  runId: string;
  finishedAt: string;
  status: OpenStackLifecycleRunStatus;
  durationInMs: number;
  failedStep?: OpenStackLifecycleStep | undefined;
  fault?: OpenStackCheckFault | undefined;
  message?: string | undefined;
  // How long it took to reach ACTIVE, when it got there.
  bootInMs?: number | undefined;
  traceId?: string | undefined;
}

export interface OpenStackLifecycleRegionRecord {
  regionName: string;
  // The newest run that reached a verdict: Succeeded or Failed. What the series say.
  lastVerdict?: OpenStackLifecycleRun | undefined;
  // The newest attempt that reached none, since then: what the page says first.
  lastAttempt?: OpenStackLifecycleRun | undefined;
  /*
   * What each phase last came to, however long ago, so that a run stopping early does not
   * read as the later phases having recovered.
   */
  phaseVerdicts: Partial<
    Record<OpenStackLifecyclePhase, OpenStackLifecyclePhaseVerdict>
  >;
  recent: Array<OpenStackLifecycleRunBrief>;
}

export type OpenStackLifecycleRecords = Record<
  string,
  OpenStackLifecycleRegionRecord
>;

/*
 * ------------------------------------------------------------------
 * Pure rules
 * ------------------------------------------------------------------
 */

// One run's time: nine tenths of its interval, so it is over before the next is due.
export function getOpenStackLifecycleRunBudgetInMs(
  intervalInMinutes: number,
): number {
  const minutes: number = Number.isFinite(intervalInMinutes)
    ? Math.max(
        intervalInMinutes,
        MIN_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
      )
    : DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES;

  /*
   * Never more than this: the slowest thing a run waits for has a limit of its own, and a
   * longer budget would only delay saying so.
   */
  const MAX_RUN_TIME_IN_MS: number = 40 * 60_000;

  return Math.min(minutes * 60_000 * 0.9, MAX_RUN_TIME_IN_MS);
}

/*
 * What the janitor waits for before anything named for the check counts as left behind: two
 * intervals. A live run is younger than one.
 */
export function getOpenStackJanitorAgeInMs(intervalInMinutes: number): number {
  return (
    Math.max(
      Number.isFinite(intervalInMinutes)
        ? intervalInMinutes
        : DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
      MIN_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
    ) *
    2 *
    60_000
  );
}

/*
 * Whether a verdict still says anything. A run that never reported - the probe died part way -
 * leaves the last one standing, and after two and a half intervals with no newer one it is
 * history: its series stop, and silence is not recovery, so an open incident stays open.
 */
export function isOpenStackLifecycleVerdictCurrent(data: {
  finishedAt: string | undefined;
  intervalInMinutes: number;
  now: number;
}): boolean {
  const finishedAt: number = data.finishedAt
    ? Date.parse(data.finishedAt)
    : Number.NaN;

  if (Number.isNaN(finishedAt)) {
    return false;
  }

  return data.now - finishedAt <= data.intervalInMinutes * 60_000 * 2.5;
}

// Whether a run is one the cloud's state can be read from.
export function isOpenStackLifecycleVerdict(
  status: OpenStackLifecycleRunStatus,
): boolean {
  return status === "Succeeded" || status === "Failed";
}

/*
 * Why a lifecycle interval is refused, or null when it is a whole number of minutes inside the
 * bounds.
 */
export function getOpenStackLifecycleIntervalRefusal(
  value: unknown,
): string | null {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES ||
    value > MAX_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES
  ) {
    return `Run the lifecycle check every ${MIN_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES} minutes to every ${
      MAX_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES / 60
    } hours, in whole minutes.`;
  }

  return null;
}

export function getOpenStackApiIntervalRefusal(value: unknown): string | null {
  if (
    typeof value !== "number" ||
    !OPENSTACK_API_CHECK_INTERVALS_IN_MINUTES.includes(value)
  ) {
    return `Run the API checks every ${OPENSTACK_API_CHECK_INTERVALS_IN_MINUTES.join(", ")} minutes.`;
  }

  return null;
}

/*
 * One sentence for a run that went wrong, for a person: which step, who said what. Words a
 * service wrote are kept as they are, so whoever places this says what they are.
 */
export function describeOpenStackLifecycleRun(
  run: Pick<
    OpenStackLifecycleRun,
    "status" | "failedStep" | "fault" | "message"
  >,
): string {
  if (run.status === "Succeeded") {
    return "Every step passed.";
  }

  if (run.status !== "Failed") {
    return run.message || "";
  }

  const step: string = run.failedStep
    ? OPENSTACK_LIFECYCLE_STEP_TITLES[run.failedStep] || run.failedStep
    : "A step";

  if (!run.fault) {
    return `${step} failed.`;
  }

  const source: string =
    OPENSTACK_CHECK_FAULT_SOURCE_TITLES[run.fault.source] || run.fault.source;

  return `${step} failed. ${source} said: ${run.fault.message}`;
}
