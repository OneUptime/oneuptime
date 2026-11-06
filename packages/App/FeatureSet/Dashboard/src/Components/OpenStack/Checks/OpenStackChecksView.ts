import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudCheck from "Common/Models/DatabaseModels/OpenStackCloudCheck";
import {
  DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
  OPENSTACK_CHECK_FAULT_SOURCE_TITLES,
  OPENSTACK_LIFECYCLE_STEP_TITLES,
  OpenStackApiCheckOutcome,
  OpenStackApiCheckResult,
  OpenStackApiServiceResult,
  OpenStackCertificateResult,
  OpenStackCheckFault,
  OpenStackLifecycleRecords,
  OpenStackLifecycleRegionRecord,
  OpenStackLifecycleRun,
  OpenStackLifecycleRunBrief,
  OpenStackLifecycleRunStatus,
  OpenStackLifecycleStep,
  OpenStackLifecycleStepResult,
  OpenStackLifecycleStepStatus,
  isOpenStackLifecycleVerdictCurrent,
} from "Common/Types/OpenStack/OpenStackCheck";
import OpenStackCollectionMethod from "Common/Types/OpenStack/OpenStackCollectionMethod";
import {
  OPENSTACK_CERTIFICATE_EXPIRY_CRITICAL_DAYS,
  OPENSTACK_CERTIFICATE_EXPIRY_WARNING_DAYS,
  OPENSTACK_INSTANCE_BOOT_SLOW_SECONDS,
} from "Common/Types/OpenStack/OpenStackHealthRules";

/*
 * What a cloud's Checks page says, worked out apart from how it is drawn, so that every sentence
 * and every colour can be read in a test.
 *
 * A check's row is written by a probe every minute, so the words here follow what it reported and
 * nothing else: a verdict too old to speak for the cloud says it is old, a run refused or skipped
 * says why and is not a failure of the cloud, and a fault is shown as who said what.
 */

export type OpenStackCheckTone = "good" | "warning" | "bad" | "neutral";

export const OPENSTACK_CHECK_TONE_CLASS_NAMES: Record<
  OpenStackCheckTone,
  string
> = {
  good: "bg-green-50 text-green-800",
  warning: "bg-amber-50 text-amber-800",
  bad: "bg-red-50 text-red-800",
  neutral: "bg-gray-100 text-gray-700",
};

// What the lifecycle check does, in the words the card and the guide use.
export const OPENSTACK_LIFECYCLE_CHECK_STATEMENT: string =
  "Each run creates one small server in a project you set aside for this, waits for it to become ACTIVE, then deletes it. Two options add to that: a floating IP with a security group that lets a ping in, and a volume it attaches and detaches. Everything it creates is named for this check, and it only ever deletes what is. It uses a credential of its own, and refuses to run on one that is scoped to another project or has admin rights.";

// The same, as short as a dialog's description has to be.
export const OPENSTACK_LIFECYCLE_CHECK_FORM_DESCRIPTION: string =
  "Each run creates one small server in a project you set aside, waits until it is ACTIVE and deletes it. It refuses a credential with admin rights.";

export const OPENSTACK_API_CHECK_STATEMENT: string =
  "Every minute, a probe outside the cloud asks Keystone for a token, makes one small read of each service in the catalog, and reads the certificate each public address presents. It only reads, and nothing runs on the cloud.";

/*
 * API checks are one click on a cloud a probe already collects: that probe and that credential
 * will do. Anything else has to be told where Keystone is and how to log in.
 */
export function isOpenStackApiCheckOneClick(
  cloud: Pick<
    OpenStackCloud,
    "collectionMethod" | "authUrl" | "isCredentialSet" | "collectionProbeId"
  >,
): boolean {
  return (
    cloud.collectionMethod === OpenStackCollectionMethod.Probe &&
    Boolean(cloud.authUrl) &&
    Boolean(cloud.collectionProbeId) &&
    cloud.isCredentialSet === true
  );
}

/*
 * Whether a form has to ask for Keystone's address and a probe up front, rather than offering them
 * under More fields for someone who wants a connection of the check's own.
 */
export function isOpenStackCheckConnectionNeeded(data: {
  cloud: Pick<OpenStackCloud, "collectionMethod" | "authUrl">;
  check: Pick<OpenStackCloudCheck, "authUrl"> | null;
}): boolean {
  if (data.check?.authUrl) {
    return false;
  }

  return !(
    data.cloud.collectionMethod === OpenStackCollectionMethod.Probe &&
    Boolean(data.cloud.authUrl)
  );
}

export function getOpenStackCheckDurationText(durationInMs: number): string {
  const safe: number = Number.isFinite(durationInMs)
    ? Math.max(0, durationInMs)
    : 0;

  if (safe < 1000) {
    return `${Math.round(safe)} ms`;
  }

  if (safe < 60_000) {
    return `${(safe / 1000).toFixed(1)} s`;
  }

  const minutes: number = Math.floor(safe / 60_000);
  const seconds: number = Math.round((safe - minutes * 60_000) / 1000);

  return seconds === 60 ? `${minutes + 1}m 0s` : `${minutes}m ${seconds}s`;
}

// Who said what. What a service wrote is kept as it is: this is drawn as text and nothing else.
export function getOpenStackCheckFaultText(fault: OpenStackCheckFault): string {
  const source: string =
    OPENSTACK_CHECK_FAULT_SOURCE_TITLES[fault.source] || fault.source;
  const code: string = fault.code ? ` (${fault.code})` : "";

  return `${source} said${code}: ${fault.message}`;
}

/*
 * ------------------------------------------------------------------
 * API checks
 * ------------------------------------------------------------------
 */

const OUTCOME_TONES: Record<OpenStackApiCheckOutcome, OpenStackCheckTone> = {
  Answered: "good",
  Refused: "neutral",
  Failing: "bad",
  NotChecked: "warning",
};

const OUTCOME_WORDS: Record<OpenStackApiCheckOutcome, string> = {
  Answered: "Answered",
  Refused: "Answered, not allowed",
  Failing: "Failing",
  NotChecked: "Not checked",
};

const OUTCOME_ORDER: ReadonlyArray<OpenStackApiCheckOutcome> = [
  "Failing",
  "NotChecked",
  "Refused",
  "Answered",
];

export interface OpenStackApiServiceRow {
  id: string;
  regionName: string;
  service: string;
  read: string;
  tone: OpenStackCheckTone;
  outcomeText: string;
  durationText: string;
  status: number | null;
  message: string | null;
}

// What needs reading first goes first, then by region and service, so that a row stays put.
export function getOpenStackApiServiceRows(
  result: OpenStackApiCheckResult | null | undefined,
): Array<OpenStackApiServiceRow> {
  const services: Array<OpenStackApiServiceResult> = Array.isArray(
    result?.services,
  )
    ? [...(result?.services as Array<OpenStackApiServiceResult>)]
    : [];

  return services
    .sort((a: OpenStackApiServiceResult, b: OpenStackApiServiceResult) => {
      return (
        OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome) ||
        a.regionName.localeCompare(b.regionName) ||
        a.serviceType.localeCompare(b.serviceType)
      );
    })
    .map((service: OpenStackApiServiceResult): OpenStackApiServiceRow => {
      return {
        id: `${service.regionName}/${service.serviceType}/${service.serviceName}`,
        regionName: service.regionName,
        service: service.serviceName || service.serviceType,
        read: service.read,
        tone: OUTCOME_TONES[service.outcome] || "neutral",
        outcomeText: OUTCOME_WORDS[service.outcome] || service.outcome,
        durationText: getOpenStackCheckDurationText(service.durationInMs),
        status: service.status ?? null,
        message: service.message || null,
      };
    });
}

export interface OpenStackTokenSummary {
  tone: OpenStackCheckTone;
  // When a token was issued. Otherwise, what stopped it is the text.
  durationText: string | null;
  text: string | null;
  message: string | null;
}

export function getOpenStackTokenSummary(
  result: OpenStackApiCheckResult | null | undefined,
): OpenStackTokenSummary | null {
  const token: OpenStackApiCheckResult["token"] | undefined = result?.token;

  if (!token) {
    return null;
  }

  if (token.status === "Passed") {
    return {
      tone: "good",
      durationText: getOpenStackCheckDurationText(token.durationInMs),
      text: null,
      message: null,
    };
  }

  return {
    tone: "bad",
    durationText: null,
    text:
      token.status === "BackingOff"
        ? "Keystone refused this credential, and it is not being asked again for a while, so the account is not locked"
        : "Keystone did not issue a token",
    message: token.message || null,
  };
}

export interface OpenStackCertificateRow {
  id: string;
  address: string;
  daysLeft: number;
  validTo: string;
  tone: OpenStackCheckTone;
  serves: string;
}

// Soonest first, at the alert templates' own lines.
export function getOpenStackCertificateRows(data: {
  result: OpenStackApiCheckResult | null | undefined;
  now: Date;
}): Array<OpenStackCertificateRow> {
  const certificates: Array<OpenStackCertificateResult> = Array.isArray(
    data.result?.certificates,
  )
    ? (data.result?.certificates as Array<OpenStackCertificateResult>)
    : [];

  return certificates
    .map((certificate: OpenStackCertificateResult): OpenStackCertificateRow => {
      const daysLeft: number = Math.floor(
        (Date.parse(certificate.validTo) - data.now.getTime()) / 86_400_000,
      );

      let tone: OpenStackCheckTone = "good";

      if (daysLeft <= OPENSTACK_CERTIFICATE_EXPIRY_CRITICAL_DAYS) {
        tone = "bad";
      } else if (daysLeft <= OPENSTACK_CERTIFICATE_EXPIRY_WARNING_DAYS) {
        tone = "warning";
      }

      return {
        id: `${certificate.host}:${certificate.port}`,
        address: `${certificate.host}:${certificate.port}`,
        daysLeft: daysLeft,
        validTo: certificate.validTo.substring(0, 10),
        tone: tone,
        serves: (certificate.serviceTypes || []).join(", "),
      };
    })
    .sort((a: OpenStackCertificateRow, b: OpenStackCertificateRow) => {
      return a.daysLeft - b.daysLeft || a.address.localeCompare(b.address);
    });
}

/*
 * ------------------------------------------------------------------
 * The lifecycle check
 * ------------------------------------------------------------------
 */

const RUN_WORDS: Record<OpenStackLifecycleRunStatus, string> = {
  Succeeded: "Passed",
  Failed: "Failed",
  Refused: "Refused",
  Skipped: "Skipped",
  Swept: "Cleared up",
};

const RUN_TONES: Record<OpenStackLifecycleRunStatus, OpenStackCheckTone> = {
  Succeeded: "good",
  Failed: "bad",
  // Nothing was written, and this person has something to fix.
  Refused: "warning",
  // Says nothing about the cloud.
  Skipped: "neutral",
  Swept: "neutral",
};

export interface OpenStackLifecycleStepRow {
  id: string;
  title: string;
  status: OpenStackLifecycleStepStatus;
  tone: OpenStackCheckTone;
  durationText: string;
  // Of the longest step in the run, for a bar: 0 to 100.
  share: number;
  faultText: string | null;
  traceId: string | null;
}

export interface OpenStackLifecycleRecentRow {
  id: string;
  finishedAt: string;
  tone: OpenStackCheckTone;
  statusText: string;
  durationText: string;
  bootText: string | null;
  sentence: string | null;
  traceId: string | null;
}

export interface OpenStackLifecycleRegionView {
  regionName: string;
  tone: OpenStackCheckTone;
  headline: string;
  // A run too old to speak for the cloud: what was last known, and that it is only that.
  isStale: boolean;
  finishedAt: string | null;
  durationText: string | null;
  failedStepTitle: string | null;
  faultText: string | null;
  // The newest attempt that reached no verdict, and why. What the card says first.
  attemptTone: OpenStackCheckTone | null;
  attemptSentence: string | null;
  // The boot passed the line the Instance Boot Slow template reads.
  isBootSlow: boolean;
  steps: Array<OpenStackLifecycleStepRow>;
  leftoverCount: number;
  removedByJanitorCount: number;
  traceId: string | null;
  recent: Array<OpenStackLifecycleRecentRow>;
}

function readRunDuration(run: OpenStackLifecycleRun): number {
  const started: number = Date.parse(run.startedAt);
  const finished: number = Date.parse(run.finishedAt);

  return Number.isNaN(started) || Number.isNaN(finished)
    ? 0
    : Math.max(0, finished - started);
}

function getStepRows(
  run: OpenStackLifecycleRun | undefined,
): Array<OpenStackLifecycleStepRow> {
  const steps: Array<OpenStackLifecycleStepResult> = Array.isArray(run?.steps)
    ? (run?.steps as Array<OpenStackLifecycleStepResult>)
    : [];
  const longest: number = steps.reduce(
    (most: number, step: OpenStackLifecycleStepResult): number => {
      return Math.max(most, step.durationInMs || 0);
    },
    0,
  );

  return steps.map(
    (step: OpenStackLifecycleStepResult): OpenStackLifecycleStepRow => {
      return {
        id: step.step,
        title: OPENSTACK_LIFECYCLE_STEP_TITLES[step.step] || step.step,
        status: step.status,
        tone: step.status === "Passed" ? "good" : "bad",
        durationText: getOpenStackCheckDurationText(step.durationInMs),
        share:
          longest > 0
            ? Math.round(((step.durationInMs || 0) * 100) / longest)
            : 0,
        faultText: step.fault ? getOpenStackCheckFaultText(step.fault) : null,
        traceId: step.traceId || null,
      };
    },
  );
}

function getRecentRow(
  brief: OpenStackLifecycleRunBrief,
): OpenStackLifecycleRecentRow {
  let sentence: string | null = brief.message || null;

  if (brief.status === "Failed") {
    const step: string = brief.failedStep
      ? OPENSTACK_LIFECYCLE_STEP_TITLES[brief.failedStep] || brief.failedStep
      : "A step";

    sentence = brief.fault
      ? `${step}. ${getOpenStackCheckFaultText(brief.fault)}`
      : step;
  }

  return {
    id: brief.runId,
    finishedAt: brief.finishedAt,
    tone: RUN_TONES[brief.status] || "neutral",
    statusText: RUN_WORDS[brief.status] || brief.status,
    durationText: getOpenStackCheckDurationText(brief.durationInMs),
    bootText:
      brief.bootInMs !== undefined
        ? getOpenStackCheckDurationText(brief.bootInMs)
        : null,
    sentence: sentence,
    traceId: brief.traceId || null,
  };
}

export function getOpenStackLifecycleRegionViews(data: {
  records: OpenStackLifecycleRecords | null | undefined;
  intervalInMinutes: number | null | undefined;
  now: Date;
}): Array<OpenStackLifecycleRegionView> {
  const records: Array<OpenStackLifecycleRegionRecord> = Object.values(
    data.records || {},
  );

  return records
    .map(
      (
        record: OpenStackLifecycleRegionRecord,
      ): OpenStackLifecycleRegionView => {
        const verdict: OpenStackLifecycleRun | undefined = record.lastVerdict;
        const attempt: OpenStackLifecycleRun | undefined = record.lastAttempt;
        const isStale: boolean = Boolean(
          verdict &&
            !isOpenStackLifecycleVerdictCurrent({
              finishedAt: verdict.finishedAt,
              intervalInMinutes:
                data.intervalInMinutes ||
                DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
              now: data.now.getTime(),
            }),
        );

        let headline: string = "No run has reached a verdict yet";
        let tone: OpenStackCheckTone = "neutral";

        if (verdict) {
          tone = RUN_TONES[verdict.status] || "neutral";
          headline =
            verdict.status === "Succeeded"
              ? "Every step passed"
              : "A step failed";
        }

        if (isStale) {
          tone = "warning";
        }

        const boot: OpenStackLifecycleStepResult | undefined =
          verdict?.steps?.find((step: OpenStackLifecycleStepResult) => {
            return step.step === OpenStackLifecycleStep.ServerActive;
          });

        const failed: OpenStackLifecycleStepResult | undefined =
          verdict?.steps?.find((step: OpenStackLifecycleStepResult) => {
            return step.status === "Failed";
          });

        return {
          regionName: record.regionName,
          tone: tone,
          headline: headline,
          isStale: isStale,
          finishedAt: verdict?.finishedAt || null,
          durationText: verdict
            ? getOpenStackCheckDurationText(readRunDuration(verdict))
            : null,
          failedStepTitle: failed
            ? OPENSTACK_LIFECYCLE_STEP_TITLES[failed.step] || failed.step
            : null,
          faultText: failed?.fault
            ? getOpenStackCheckFaultText(failed.fault)
            : null,
          attemptTone: attempt ? RUN_TONES[attempt.status] || "neutral" : null,
          attemptSentence: attempt
            ? attempt.message || RUN_WORDS[attempt.status]
            : null,
          isBootSlow: Boolean(
            boot &&
              boot.status === "Passed" &&
              boot.durationInMs > OPENSTACK_INSTANCE_BOOT_SLOW_SECONDS * 1000,
          ),
          steps: getStepRows(verdict),
          leftoverCount: verdict?.leftoverCount || 0,
          removedByJanitorCount: verdict?.janitor?.removed?.length || 0,
          traceId: verdict?.traceId || null,
          recent: (Array.isArray(record.recent) ? record.recent : []).map(
            getRecentRow,
          ),
        };
      },
    )
    .sort(
      (a: OpenStackLifecycleRegionView, b: OpenStackLifecycleRegionView) => {
        return a.regionName.localeCompare(b.regionName);
      },
    );
}
