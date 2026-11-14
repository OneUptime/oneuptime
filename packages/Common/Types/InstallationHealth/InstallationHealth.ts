import { fillTemplate, translationKey } from "../Translator";
import ServerSetupChecklistUtil, {
  ServerSetupCheckDefinition,
  ServerSetupCheckResult,
  ServerSetupCheckTier,
  ServerSetupChecklistAnswer,
  ServerSetupStatus,
  SERVER_SETUP_ADMIN_PATHS,
} from "../ServerSetup/ServerSetupChecklist";

/*
 * WHAT IS WRONG WITH THIS INSTALLATION, AND THE FIX FOR EACH (#6826).
 *
 * One list of findings, worst first, each with what is wrong, why it matters
 * and the exact fix. The server works it out from what it can see of itself
 * (/api/admin/health/doctor, App/API/AdminHealth.ts):
 *
 *   - PostgreSQL, ClickHouse and Valkey answer;
 *   - the database migrations have all run, and none failed;
 *   - ClickHouse's disks have room;
 *   - the background queues are moving;
 *   - the version, against the latest release;
 *   - the server setup checklist (#6824): email, HTTPS, sign-ups, SMS and
 *     calls, probes, backups, update checks. Its words are reused here, so
 *     the checklist and this list never say a thing two ways.
 *
 * Three readers print the same findings:
 *
 *   - `npm run doctor` (Scripts/Install/Doctor.js), on a Docker Compose
 *     server. It asks the local ingress, in a POST with the cluster key from
 *     config.env, and adds what only the host can see: the containers,
 *     config.env, whether HOST reaches this OneUptime, the certificate and
 *     the disk.
 *   - HelmChart/Public/diagnose.sh, on Kubernetes, from inside the app pod,
 *     in a POST with the cluster key the pod holds.
 *   - The Admin Dashboard's OneUptime Health overview, in every edition, in
 *     a GET as a master admin.
 *
 * The terminals read `sentence` and `fixSentence`, filled in English. The
 * Admin Dashboard translates `words` and `fix` with `values`.
 *
 * A finding's level:
 *
 *   - fix:  something required fails. `npm run doctor` exits 1.
 *   - warn: worth a look; OneUptime works without it.
 *
 * Pure, with no Node or browser APIs.
 */

export enum InstallationHealthLevel {
  Fix = "fix",
  Warn = "warn",
}

export enum InstallationHealthFindingId {
  Postgres = "postgres",
  Clickhouse = "clickhouse",
  Valkey = "valkey",
  MigrationFailed = "migration-failed",
  MigrationsPending = "migrations-pending",
  ClickhouseDisk = "clickhouse-disk",
  QueueBacklog = "queue-backlog",
  UpdateAvailable = "update-available",
}

// What was looked at, so a reader can say what an empty list covers.
export enum InstallationHealthCheck {
  Postgres = "postgres",
  Clickhouse = "clickhouse",
  Valkey = "valkey",
  Migrations = "migrations",
  ClickhouseDisk = "clickhouse-disk",
  Queues = "queues",
  Version = "version",
  ServerSetup = "server-setup",
}

// The Admin Dashboard pages the findings are fixed on.
export const INSTALLATION_HEALTH_ADMIN_PATHS: {
  clickhouse: string;
  migrations: string;
  setup: string;
} = {
  clickhouse: "/admin/health/clickhouse",
  migrations: "/admin/health/migrations",
  setup: SERVER_SETUP_ADMIN_PATHS.setup,
};

export const INSTALLATION_HEALTH_GUIDES: {
  upgrading: string;
} = {
  upgrading: "/docs/installation/upgrading",
};

/*
 * ClickHouse's disk: below this share free it is something to fix, below
 * the other worth a look. ClickHouse stops taking writes when a disk fills,
 * and merges need room of their own.
 */
export const CLICKHOUSE_DISK_FIX_FREE_PERCENT: number = 10;
export const CLICKHOUSE_DISK_WARN_FREE_PERCENT: number = 20;

/*
 * A queue with more jobs than this waiting is behind. BullMQ keeps the last
 * 100 failed jobs of every queue, so a count of failed jobs says nothing
 * about now; a backlog that grows does.
 */
export const QUEUE_BACKLOG_LIMIT: number = 1000;

// What each finding says: the title, what is wrong and why, and the fix.
export const INSTALLATION_HEALTH_WORDS: Readonly<
  Record<
    InstallationHealthFindingId,
    { title: string; words: string; fix: string }
  >
> = {
  [InstallationHealthFindingId.Postgres]: {
    title: translationKey("PostgreSQL"),
    words: translationKey(
      "PostgreSQL does not answer, so OneUptime cannot read or save anything.",
    ),
    fix: translationKey(
      "Check that PostgreSQL is running, and read its log for the reason.",
    ),
  },
  [InstallationHealthFindingId.Clickhouse]: {
    title: translationKey("ClickHouse"),
    words: translationKey(
      "ClickHouse does not answer, so logs, metrics, traces and monitor results are not saved.",
    ),
    fix: translationKey(
      "Check that ClickHouse is running, and read its log for the reason.",
    ),
  },
  [InstallationHealthFindingId.Valkey]: {
    title: translationKey("Valkey"),
    words: translationKey(
      "Valkey does not answer, so background jobs and live updates stop.",
    ),
    fix: translationKey(
      "Check that Valkey is running, and read its log for the reason.",
    ),
  },
  [InstallationHealthFindingId.MigrationFailed]: {
    title: translationKey("Database migrations"),
    words: translationKey(
      "The database migration {{name}} failed on {{time}}: {{reason}}",
    ),
    fix: translationKey(
      "Fix what the error names, then restart OneUptime so the migration runs again.",
    ),
  },
  [InstallationHealthFindingId.MigrationsPending]: {
    title: translationKey("Database migrations"),
    words: translationKey(
      "Database migrations are still running: {{count}} left. They run while OneUptime starts.",
    ),
    fix: translationKey(
      "Wait a few minutes. If they do not finish, restart OneUptime and read the app's log.",
    ),
  },
  [InstallationHealthFindingId.ClickhouseDisk]: {
    title: translationKey("ClickHouse disk"),
    words: translationKey(
      "ClickHouse's disk {{disk}} has {{free}} free of {{total}}. When it fills, ClickHouse stops saving telemetry.",
    ),
    fix: translationKey(
      "Give the disk more space, or turn on automatic pruning on the ClickHouse page of OneUptime Health.",
    ),
  },
  [InstallationHealthFindingId.QueueBacklog]: {
    title: translationKey("Background jobs"),
    words: translationKey(
      "{{count}} jobs are waiting in the {{queue}} queue, so the workers are behind.",
    ),
    fix: translationKey(
      "Give the workers more memory and CPU, and read the app's log for jobs that keep failing.",
    ),
  },
  [InstallationHealthFindingId.UpdateAvailable]: {
    title: translationKey("Version"),
    words: translationKey(
      "This server runs OneUptime {{current}}. {{latest}} is out.",
    ),
    fix: translationKey(
      "Back up, then update: npm run update on Docker Compose, helm upgrade on Kubernetes.",
    ),
  },
};

// The fix of a step of the server setup checklist: its own page.
export const INSTALLATION_HEALTH_SETUP_FIX: string = translationKey(
  "Finish it on the Server setup page.",
);

// What the Admin Dashboard says when there is nothing to list.
export const INSTALLATION_HEALTH_ALL_RIGHT: string = translationKey(
  "Everything looks right.",
);

// One finding.
export interface InstallationHealthFinding {
  // An InstallationHealthFindingId, or "setup-" and the checklist's id.
  id: string;
  level: InstallationHealthLevel;
  // English, and the key the Admin Dashboard translates it by.
  title: string;
  // What is wrong and why, in English with {{placeholders}}.
  words: string;
  // The fix, in English with the same placeholders; null when a page is the fix.
  fix: string | null;
  values: Record<string, string>;
  // Where it is fixed: an Admin Dashboard page, a guide in the docs.
  adminPath: string | null;
  guidePath: string | null;
  // `words` and `fix` filled, for a terminal.
  sentence: string;
  fixSentence: string | null;
}

// The facts the server reads to answer.
export interface InstallationHealthFacts {
  isPostgresConnected: boolean;
  isClickhouseConnected: boolean;
  isValkeyConnected: boolean;
  // Null when PostgreSQL does not answer: nothing can be said.
  migrations: {
    pending: number;
    // The latest failed attempt of a migration that is still pending.
    failure: {
      name: string;
      reason: string;
      at: string | null;
    } | null;
  } | null;
  clickhouseDisks: Array<{
    name: string;
    freeInBytes: number;
    totalInBytes: number;
  }>;
  queues: Array<{ name: string; waiting: number }>;
  version: {
    current: string;
    latest: string | null;
    isUpdateAvailable: boolean;
    isUpdateCheckDisabled: boolean;
  };
  // Null when it could not be read (PostgreSQL does not answer).
  serverSetup: ServerSetupChecklistAnswer | null;
}

// The body of /api/admin/health/doctor's answer, to a GET and to a POST.
export interface InstallationHealthAnswer {
  findings: Array<InstallationHealthFinding>;
  checked: Array<InstallationHealthCheck>;
  version: InstallationHealthFacts["version"];
  /*
   * A proof this installation answers at its custom-domain-readiness
   * address (CustomDomainServerReadiness): `npm run doctor` asks HOST for
   * it from outside the containers, to tell this OneUptime from another
   * server. Only the answer to the POST, which the cluster key opens,
   * carries one: null in the Admin Dashboard's answer to its GET.
   */
  addressProof: string | null;
  checkedAt: string;
}

const GIGABYTE: number = 1000 * 1000 * 1000;

const isObject: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const readText: (value: unknown, limit?: number) => string | null = (
  value: unknown,
  limit: number = 2000,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();

  return text ? text.slice(0, limit) : null;
};

export default class InstallationHealthUtil {
  // Bytes as people read a disk: "8.4 GB", "120 GB", "512 MB".
  public static formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
      return "0 MB";
    }

    if (bytes < GIGABYTE) {
      return `${Math.round(bytes / (1000 * 1000))} MB`;
    }

    const gigabytes: number = bytes / GIGABYTE;

    return `${gigabytes >= 10 ? Math.round(gigabytes) : Math.round(gigabytes * 10) / 10} GB`;
  }

  // A date as a terminal and a browser alike read it: "2026-11-12 14:05 UTC".
  public static formatTime(value: string | null): string {
    if (!value) {
      return "an unknown date";
    }

    const date: Date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "an unknown date";
    }

    return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }

  public static finding(data: {
    id: string;
    level: InstallationHealthLevel;
    title: string;
    words: string;
    fix: string | null;
    values?: Record<string, string> | undefined;
    adminPath?: string | null | undefined;
    guidePath?: string | null | undefined;
  }): InstallationHealthFinding {
    const values: Record<string, string> = data.values || {};

    return {
      id: data.id,
      level: data.level,
      title: data.title,
      words: data.words,
      fix: data.fix,
      values: values,
      adminPath: data.adminPath || null,
      guidePath: data.guidePath || null,
      sentence: fillTemplate(data.words, values),
      fixSentence: data.fix ? fillTemplate(data.fix, values) : null,
    };
  }

  private static ofCatalogue(data: {
    id: InstallationHealthFindingId;
    level: InstallationHealthLevel;
    values?: Record<string, string> | undefined;
    adminPath?: string | null | undefined;
    guidePath?: string | null | undefined;
  }): InstallationHealthFinding {
    const words: { title: string; words: string; fix: string } =
      INSTALLATION_HEALTH_WORDS[data.id];

    return InstallationHealthUtil.finding({
      id: data.id,
      level: data.level,
      title: words.title,
      words: words.words,
      fix: words.fix,
      values: data.values,
      adminPath: data.adminPath,
      guidePath: data.guidePath,
    });
  }

  // The datastores: each one that does not answer is something to fix.
  public static datastoreFindings(
    facts: InstallationHealthFacts,
  ): Array<InstallationHealthFinding> {
    const findings: Array<InstallationHealthFinding> = [];
    const datastores: Array<{
      id: InstallationHealthFindingId;
      isConnected: boolean;
    }> = [
      {
        id: InstallationHealthFindingId.Postgres,
        isConnected: facts.isPostgresConnected,
      },
      {
        id: InstallationHealthFindingId.Clickhouse,
        isConnected: facts.isClickhouseConnected,
      },
      {
        id: InstallationHealthFindingId.Valkey,
        isConnected: facts.isValkeyConnected,
      },
    ];

    for (const datastore of datastores) {
      if (!datastore.isConnected) {
        findings.push(
          InstallationHealthUtil.ofCatalogue({
            id: datastore.id,
            level: InstallationHealthLevel.Fix,
          }),
        );
      }
    }

    return findings;
  }

  /*
   * The migrations: one that failed and is still pending is something to
   * fix; pending ones alone are worth a look (they run while the app
   * starts).
   */
  public static migrationFindings(
    facts: InstallationHealthFacts,
  ): Array<InstallationHealthFinding> {
    const migrations: InstallationHealthFacts["migrations"] = facts.migrations;

    if (!migrations || migrations.pending <= 0) {
      return [];
    }

    if (migrations.failure) {
      return [
        InstallationHealthUtil.ofCatalogue({
          id: InstallationHealthFindingId.MigrationFailed,
          level: InstallationHealthLevel.Fix,
          values: {
            name: migrations.failure.name,
            time: InstallationHealthUtil.formatTime(migrations.failure.at),
            reason: migrations.failure.reason,
          },
          adminPath: INSTALLATION_HEALTH_ADMIN_PATHS.migrations,
        }),
      ];
    }

    return [
      InstallationHealthUtil.ofCatalogue({
        id: InstallationHealthFindingId.MigrationsPending,
        level: InstallationHealthLevel.Warn,
        values: { count: String(migrations.pending) },
        adminPath: INSTALLATION_HEALTH_ADMIN_PATHS.migrations,
      }),
    ];
  }

  // ClickHouse's fullest disk, when it is short of room.
  public static diskFindings(
    facts: InstallationHealthFacts,
  ): Array<InstallationHealthFinding> {
    let fullest: InstallationHealthFacts["clickhouseDisks"][number] | null =
      null;
    let fullestFreePercent: number = 100;

    for (const disk of facts.clickhouseDisks) {
      if (!(disk.totalInBytes > 0) || !(disk.freeInBytes >= 0)) {
        continue;
      }

      const freePercent: number = (disk.freeInBytes / disk.totalInBytes) * 100;

      if (!fullest || freePercent < fullestFreePercent) {
        fullest = disk;
        fullestFreePercent = freePercent;
      }
    }

    if (!fullest || fullestFreePercent >= CLICKHOUSE_DISK_WARN_FREE_PERCENT) {
      return [];
    }

    return [
      InstallationHealthUtil.ofCatalogue({
        id: InstallationHealthFindingId.ClickhouseDisk,
        level:
          fullestFreePercent < CLICKHOUSE_DISK_FIX_FREE_PERCENT
            ? InstallationHealthLevel.Fix
            : InstallationHealthLevel.Warn,
        values: {
          disk: fullest.name,
          free: InstallationHealthUtil.formatBytes(fullest.freeInBytes),
          total: InstallationHealthUtil.formatBytes(fullest.totalInBytes),
        },
        adminPath: INSTALLATION_HEALTH_ADMIN_PATHS.clickhouse,
      }),
    ];
  }

  // The queue furthest behind, when one is.
  public static queueFindings(
    facts: InstallationHealthFacts,
  ): Array<InstallationHealthFinding> {
    let behind: { name: string; waiting: number } | null = null;

    for (const queue of facts.queues) {
      if (
        queue.waiting > QUEUE_BACKLOG_LIMIT &&
        (!behind || queue.waiting > behind.waiting)
      ) {
        behind = queue;
      }
    }

    if (!behind) {
      return [];
    }

    return [
      InstallationHealthUtil.ofCatalogue({
        id: InstallationHealthFindingId.QueueBacklog,
        level: InstallationHealthLevel.Warn,
        values: { count: String(behind.waiting), queue: behind.name },
      }),
    ];
  }

  public static versionFindings(
    facts: InstallationHealthFacts,
  ): Array<InstallationHealthFinding> {
    if (!facts.version.isUpdateAvailable || !facts.version.latest) {
      return [];
    }

    return [
      InstallationHealthUtil.ofCatalogue({
        id: InstallationHealthFindingId.UpdateAvailable,
        level: InstallationHealthLevel.Warn,
        values: {
          current: facts.version.current,
          latest: facts.version.latest,
        },
        guidePath: INSTALLATION_HEALTH_GUIDES.upgrading,
      }),
    ];
  }

  /*
   * The server setup checklist's open steps, in its words: a required one
   * is something to fix, a recommended one worth a look. An optional one
   * is a choice, not a fault, unless it is set up and failing.
   */
  public static setupFindings(
    facts: InstallationHealthFacts,
  ): Array<InstallationHealthFinding> {
    if (!facts.serverSetup) {
      return [];
    }

    const findings: Array<InstallationHealthFinding> = [];

    for (const check of facts.serverSetup.checks) {
      if (check.isFinished) {
        continue;
      }

      let level: InstallationHealthLevel | null = null;

      if (check.tier === ServerSetupCheckTier.Required) {
        level = InstallationHealthLevel.Fix;
      } else if (check.tier === ServerSetupCheckTier.Recommended) {
        level = InstallationHealthLevel.Warn;
      } else if (check.status === ServerSetupStatus.Failing) {
        level = InstallationHealthLevel.Warn;
      }

      const words: string = ServerSetupChecklistUtil.getStatusWords(check);

      if (!level || !words) {
        continue;
      }

      const definition: ServerSetupCheckDefinition =
        ServerSetupChecklistUtil.getDefinition(check.id);

      findings.push(
        InstallationHealthUtil.finding({
          id: `setup-${check.id}`,
          level: level,
          title: definition.title,
          words: words,
          fix: INSTALLATION_HEALTH_SETUP_FIX,
          values: InstallationHealthUtil.setupValues(check),
          adminPath: definition.adminPath || null,
          guidePath: definition.guidePath || null,
        }),
      );
    }

    return findings;
  }

  private static setupValues(
    check: ServerSetupCheckResult,
  ): Record<string, string> {
    return check.time
      ? { time: InstallationHealthUtil.formatTime(check.time) }
      : {};
  }

  // Every finding, worst first: what to fix, then what is worth a look.
  public static evaluate(
    facts: InstallationHealthFacts,
  ): Array<InstallationHealthFinding> {
    const findings: Array<InstallationHealthFinding> = [
      ...InstallationHealthUtil.datastoreFindings(facts),
      ...InstallationHealthUtil.migrationFindings(facts),
      ...InstallationHealthUtil.diskFindings(facts),
      ...InstallationHealthUtil.setupFindings(facts),
      ...InstallationHealthUtil.queueFindings(facts),
      ...InstallationHealthUtil.versionFindings(facts),
    ];

    return InstallationHealthUtil.worstFirst(findings);
  }

  // Fix before warn, keeping each level's order.
  public static worstFirst(
    findings: Array<InstallationHealthFinding>,
  ): Array<InstallationHealthFinding> {
    return [
      ...findings.filter((finding: InstallationHealthFinding): boolean => {
        return finding.level === InstallationHealthLevel.Fix;
      }),
      ...findings.filter((finding: InstallationHealthFinding): boolean => {
        return finding.level !== InstallationHealthLevel.Fix;
      }),
    ];
  }

  public static getAnswer(data: {
    facts: InstallationHealthFacts;
    addressProof: string | null;
    checkedAt: string;
  }): InstallationHealthAnswer {
    return {
      findings: InstallationHealthUtil.evaluate(data.facts),
      checked: Object.values(InstallationHealthCheck),
      version: data.facts.version,
      addressProof: data.addressProof,
      checkedAt: data.checkedAt,
    };
  }

  /*
   * The answer, read in a browser, or null when it is not one (a failed
   * read, a proxy's page). A finding that is not one is left out.
   */
  public static parseAnswer(value: unknown): InstallationHealthAnswer | null {
    if (!isObject(value) || !Array.isArray(value["findings"])) {
      return null;
    }

    const findings: Array<InstallationHealthFinding> = [];

    for (const row of value["findings"] as Array<unknown>) {
      if (!isObject(row)) {
        continue;
      }

      const id: string | null = readText(row["id"], 100);
      const title: string | null = readText(row["title"], 200);
      const words: string | null = readText(row["words"]);
      const level: InstallationHealthLevel | null = Object.values(
        InstallationHealthLevel,
      ).includes(row["level"] as InstallationHealthLevel)
        ? (row["level"] as InstallationHealthLevel)
        : null;

      if (!id || !title || !words || !level) {
        continue;
      }

      const values: Record<string, string> = {};

      if (isObject(row["values"])) {
        for (const [key, entry] of Object.entries(row["values"])) {
          if (typeof entry === "string" || typeof entry === "number") {
            values[key] = String(entry).slice(0, 2000);
          }
        }
      }

      findings.push(
        InstallationHealthUtil.finding({
          id: id,
          level: level,
          title: title,
          words: words,
          fix: readText(row["fix"]),
          values: values,
          adminPath: InstallationHealthUtil.readPath(row["adminPath"]),
          guidePath: InstallationHealthUtil.readPath(row["guidePath"]),
        }),
      );
    }

    const version: Record<string, unknown> = isObject(value["version"])
      ? value["version"]
      : {};

    return {
      findings: InstallationHealthUtil.worstFirst(findings),
      checked: Array.isArray(value["checked"])
        ? (value["checked"] as Array<unknown>).filter(
            (entry: unknown): entry is InstallationHealthCheck => {
              return Object.values(InstallationHealthCheck).includes(
                entry as InstallationHealthCheck,
              );
            },
          )
        : [],
      version: {
        current: readText(version["current"], 100) || "",
        latest: readText(version["latest"], 100),
        isUpdateAvailable: version["isUpdateAvailable"] === true,
        isUpdateCheckDisabled: version["isUpdateCheckDisabled"] === true,
      },
      addressProof: readText(value["addressProof"], 200),
      checkedAt: readText(value["checkedAt"], 100) || "",
    };
  }

  // A path on this server ("/admin/...", "/docs/..."), never another host's address.
  private static readPath(value: unknown): string | null {
    const path: string | null = readText(value, 300);

    if (!path || !path.startsWith("/") || path.startsWith("//")) {
      return null;
    }

    return path;
  }
}
