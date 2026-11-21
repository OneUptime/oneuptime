import GlobalCache from "../../Infrastructure/GlobalCache";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import logger from "../Logger";
import CaptureSpan from "./CaptureSpan";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  AppleCrashReporter,
  AppleCrashSignature,
  MATCH_WINDOW_MS,
  buildAppleCrashSignature,
  findAppleCrashPartner,
} from "../../../Utils/Telemetry/AppleCrashMatch";
import {
  AppleCrashReport,
  parseAppleCrashReport,
} from "../../../Utils/Telemetry/AppleCrashReport";
import {
  METRICKIT_CRASH_EVENT_NAME,
  getMobileAppFaultEventName,
} from "../../../Utils/Telemetry/MobileAppFaults";
import { readStoredAppInstall } from "../../../Types/Rum/MobileAppTelemetry";

/*
 * THE IOS CRASHES AN INSTALL REPORTED LATELY, TO PAIR ITS TWO REPORTS (#9923).
 *
 * KSCrash's report of a crash and MetricKit's reach ingest in different
 * requests, minutes to a day apart, often to different workers: one install's
 * recent crash reports are kept in the cache (Valkey), and each new report
 * is compared with them (AppleCrashMatch) under a short lock on that
 * install, so two of its reports read at once by two workers still pair,
 * and each report pairs once. A report that repeats one is not recorded:
 * nothing pairs with a duplicate.
 *
 * Kept for twice the match window after the last report, so a report that
 * arrives as late as its pair can be stamped still finds it. When the cache
 * or the lock cannot be had, nothing pairs: the crash is counted as every
 * crash was before, twice at worst, never lost.
 */

export interface RegisteredAppleCrash {
  // The occurrence (ExceptionInstance) the report was stored as.
  occurrenceId: string;
  // Its exception's fingerprints, for a repeat to be filed under.
  fingerprint: string;
  fingerprintV2: string;
  /*
   * And the exceptions it may already belong to, tried in order (App's
   * Telemetry/Utils/Exception.ts, OccurrenceFingerprints, #10434). Not kept
   * by a report recorded before them, whose repeat tries its v1 alone.
   */
  fingerprintCandidates?: Array<string> | undefined;
  signature: AppleCrashSignature;
  // The occurrence that repeats it, once one has.
  pairedWith: string | null;
  // When it was recorded, in milliseconds since the epoch.
  recordedAt: number;
}

const NAMESPACE: string = "apple-crash-register";

// The most recent reports kept per install.
export const MAX_REGISTERED_CRASHES_PER_INSTALL: number = 64;

// How long an install's reports are kept after the last one, in seconds.
export const APPLE_CRASH_REGISTER_TTL_SECONDS: number = Math.ceil(
  (2 * MATCH_WINDOW_MS) / 1000,
);

// How long a report waits for another of its install's to be compared.
const LOCK_TIMEOUT_MS: number = 5000;

// The attributes MetricKit's crash names its exception in.
const METRICKIT_SIGNAL_NAME: string = `${METRICKIT_CRASH_EVENT_NAME}.exception.signal.name`;
const METRICKIT_MACH_EXCEPTION_NAME: string = `${METRICKIT_CRASH_EVENT_NAME}.exception.mach_exception.name`;
const METRICKIT_OBJC_NAME: string = `${METRICKIT_CRASH_EVENT_NAME}.exception.objc.name`;

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRegisteredCrash(value: unknown): value is RegisteredAppleCrash {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const entry: Record<string, unknown> = value as Record<string, unknown>;
  const signature: unknown = entry["signature"];

  return (
    typeof entry["occurrenceId"] === "string" &&
    typeof entry["fingerprint"] === "string" &&
    typeof entry["fingerprintV2"] === "string" &&
    (entry["fingerprintCandidates"] === undefined ||
      Array.isArray(entry["fingerprintCandidates"])) &&
    typeof entry["recordedAt"] === "number" &&
    Boolean(signature) &&
    typeof signature === "object" &&
    Array.isArray((signature as Record<string, unknown>)["frames"])
  );
}

export default class AppleCrashRegister {
  /*
   * Which of the two reporters a crash's log record came from, or null when
   * it is no iOS crash: MetricKit names its own; KSCrash sends `device.crash`,
   * which OpenTelemetry Android sent before 1.5 too - KSCrash's is the one
   * whose stack is an Apple crash report.
   */
  public static getReporter(input: {
    attributes: JSONObject;
    report: AppleCrashReport | null;
  }): AppleCrashReporter | null {
    const eventName: string | null = getMobileAppFaultEventName(
      input.attributes,
    );

    if (eventName === METRICKIT_CRASH_EVENT_NAME) {
      return "metrickit";
    }

    if (eventName === "device.crash" && input.report) {
      return "kscrash";
    }

    return null;
  }

  /*
   * A crash log record's signature (AppleCrashMatch), or null when it cannot
   * be paired: no iOS crash, no install, no crashed thread to compare.
   */
  public static buildSignature(input: {
    attributes: JSONObject;
    stackTrace: string;
    exceptionType: string;
    time: Date;
  }): AppleCrashSignature | null {
    try {
      const report: AppleCrashReport | null = parseAppleCrashReport(
        input.stackTrace,
      );
      const reporter: AppleCrashReporter | null =
        AppleCrashRegister.getReporter({
          attributes: input.attributes,
          report,
        });
      const install: string = readStoredAppInstall(input.attributes);

      if (!reporter || !report || !install) {
        return null;
      }

      return buildAppleCrashSignature({
        reporter,
        install,
        time: input.time,
        report,
        exceptionType: input.exceptionType,
        signalName: readText(input.attributes[METRICKIT_SIGNAL_NAME]),
        machExceptionName: readText(
          input.attributes[METRICKIT_MACH_EXCEPTION_NAME],
        ),
        objcExceptionName: readText(input.attributes[METRICKIT_OBJC_NAME]),
      });
    } catch {
      return null;
    }
  }

  public static getKey(input: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    install: string;
  }): string {
    return `${input.projectId.toString()}:${input.primaryEntityId.toString()}:${input.install}`;
  }

  /*
   * The report the new one repeats - the same crash, from the other
   * reporter - marked as paired, or null, the new one then recorded for a
   * later report to pair with. Never throws.
   */
  @CaptureSpan()
  public static async pairOrRecord(input: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    signature: AppleCrashSignature;
    occurrence: {
      id: string;
      fingerprint: string;
      fingerprintV2: string;
      fingerprintCandidates?: Array<string> | undefined;
    };
    now?: number | undefined;
  }): Promise<RegisteredAppleCrash | null> {
    if (!input.signature.install) {
      return null;
    }

    const key: string = AppleCrashRegister.getKey({
      projectId: input.projectId,
      primaryEntityId: input.primaryEntityId,
      install: input.signature.install,
    });
    const now: number = input.now ?? Date.now();

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key,
        namespace: NAMESPACE,
        lockTimeout: LOCK_TIMEOUT_MS,
        acquireTimeout: LOCK_TIMEOUT_MS,
      });
    } catch (err) {
      logger.warn(
        `Could not compare an iOS crash with its install's other reports; it is counted on its own: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }

    try {
      const entries: Array<RegisteredAppleCrash> =
        AppleCrashRegister.readEntries(
          await GlobalCache.getString(NAMESPACE, key),
          now,
        );

      const partner: RegisteredAppleCrash | null = findAppleCrashPartner(
        input.signature,
        entries,
      );

      if (partner) {
        partner.pairedWith = input.occurrence.id;
      } else {
        entries.push({
          occurrenceId: input.occurrence.id,
          fingerprint: input.occurrence.fingerprint,
          fingerprintV2: input.occurrence.fingerprintV2,
          ...(input.occurrence.fingerprintCandidates
            ? { fingerprintCandidates: input.occurrence.fingerprintCandidates }
            : {}),
          signature: input.signature,
          pairedWith: null,
          recordedAt: now,
        });
      }

      await GlobalCache.setString(
        NAMESPACE,
        key,
        JSON.stringify(entries.slice(-MAX_REGISTERED_CRASHES_PER_INSTALL)),
        { expiresInSeconds: APPLE_CRASH_REGISTER_TTL_SECONDS },
      );

      return partner ? { ...partner } : null;
    } catch (err) {
      logger.warn(
        `Could not compare an iOS crash with its install's other reports; it is counted on its own: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch {
          // The lock runs out on its own.
        }
      }
    }
  }

  // An install's kept reports, the ones too old to pair any more left out.
  public static readEntries(
    raw: string | null,
    now: number,
  ): Array<RegisteredAppleCrash> {
    if (!raw) {
      return [];
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry: unknown): entry is RegisteredAppleCrash => {
      return (
        isRegisteredCrash(entry) &&
        now - entry.recordedAt <= APPLE_CRASH_REGISTER_TTL_SECONDS * 1000
      );
    });
  }
}
