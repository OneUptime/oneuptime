/*
 * Offline fixture for Admin Dashboard > Settings > Backups, the Enterprise
 * Edition's backups of PostgreSQL and ClickHouse (ee/AdminDashboard/Backups).
 *
 * The page is the production one, reached through the Admin Dashboard's
 * Enterprise plugin (getAdminDashboardPlugins().SettingsPages), as the Admin
 * Dashboard's router reaches it. Only the ModelAPI / API data boundary and
 * the signed-in master admin are replaced: the backup settings and runs are
 * in memory, and the /backup/* routes answer from them.
 *
 * Steered by the query string:
 *   - scene=first-run   nothing is set up yet: what backups do, and Set up
 *   - scene=on          backups on, a list of backups and a restore (default)
 *   - scene=running     a backup running: step 3 of 5, ClickHouse copying
 *   - scene=failed      the last backup failed: the storage refused the key
 *   - scene=restoring   a restore running, PostgreSQL being restored
 *   - scene=off         scheduled backups turned off
 *   - license=valid|lapsed|grace|not-included
 *   - test=ok|fail      what Test the destination answers
 *   - preview=ok|problem|warning  what a restore's check of a backup finds
 *   - lang=de|ja|fa     the Admin Dashboard's German, Japanese or Persian
 *   - theme=dark        dark mode (read by server.js's page)
 *
 * Every write is recorded on window.__fixture: posts to /backup/* (posts),
 * creates and updates of the settings (writes). A read the fixture does not
 * model is recorded on window.__fixture.unmodeled, which every spec expects
 * to stay empty.
 *
 * Where ee/ is not checked out, or ONEUPTIME_EDITION=community, the plugin
 * has no Backups page: the fixture then draws the Admin Dashboard's Settings
 * side menu alone, and the specs check that Backups is not in it.
 */
import "Common/UI/Styles/Theme.css";
import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { getAdminDashboardPlugins } from "../../../App/FeatureSet/AdminDashboard/src/Enterprise/Plugins";
import SettingsSideMenu from "../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu";
import "../../../App/FeatureSet/AdminDashboard/src/Utils/i18n";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import {
  BackupFrequency,
  getNextBackupAt,
} from "Common/Types/Backup/BackupSchedule";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import User from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";

const USER_ID = "80000000-0000-4000-8000-000000000001";
const SETTING_ID = "5b000000-0000-4000-8000-000000000001";
const FINGERPRINT = "s3-compatible:minio.acme.internal:oneuptime-backups";

const params = new URLSearchParams(window.location.search);
const scene = params.get("scene") || "on";
const license = params.get("license") || "valid";
const testAnswer = params.get("test") || "ok";
const previewAnswer = params.get("preview") || "ok";
const language = ["de", "ja", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

window.__fixture = {
  posts: [],
  writes: [],
  unmodeled: [],
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.now();
const ago = (ms) => {
  return new Date(NOW - ms);
};

// The destination: MinIO, as most self-hosted installations start.
const LOCATION = "s3://oneuptime-backups/oneuptime/backups/";
const CONFIG = {
  endpoint: "https://minio.acme.internal:9000",
  bucket: "oneuptime-backups",
  accessKeyId: "oneuptime-backup",
};

const STORAGE_REFUSED =
  "The S3-compatible storage did not let this key write the backup (HTTP 403, AccessDenied). Allow it to read, write, list and delete objects in oneuptime-backups/oneuptime/backups/.";

let counter = 0;

function id(suffix) {
  return `6b000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

function step(key, status, extra) {
  return { key, status, ...(extra || {}) };
}

function at(start, seconds) {
  return new Date(start.getTime() + seconds * 1000).toISOString();
}

function backupName(startedAt, runId) {
  const pad = (value) => {
    return String(value).padStart(2, "0");
  };
  return `${startedAt.getUTCFullYear()}${pad(startedAt.getUTCMonth() + 1)}${pad(startedAt.getUTCDate())}T${pad(startedAt.getUTCHours())}${pad(startedAt.getUTCMinutes())}${pad(startedAt.getUTCSeconds())}Z-${runId.split("-").join("").slice(0, 8)}`;
}

function run(fields) {
  const record = new BackupRun();
  counter++;
  const runId = fields._id || id(counter);
  record._id = runId;
  record.id = new ObjectID(runId);
  for (const [key, value] of Object.entries(fields)) {
    if (key !== "_id") {
      record[key] = value;
    }
  }
  return record;
}

// The schedule the settings hold: every day at 02:00 UTC.
const SCHEDULE = {
  frequency: BackupFrequency.Daily,
  timeOfDay: "02:00",
  dayOfWeek: 0,
};

// The last time the schedule was due, `days` whole days before the latest.
function scheduledAt(days) {
  const next = getNextBackupAt(SCHEDULE, new Date(NOW));
  return new Date(next.getTime() - (days + 1) * DAY);
}

// A backup that succeeded, made by the schedule `days` days before the latest.
function backup(days, overrides) {
  const startedAt = scheduledAt(days);
  const postgres = 4300000 + Math.round(days * 37000);
  const clickhouse = 2210000000 - Math.round(days * 31000000);
  const runId = (overrides && overrides._id) || id(++counter + 100);
  const name = backupName(startedAt, runId);
  const took = 11 + Math.round(days);
  return run({
    _id: runId,
    kind: "backup",
    trigger: "scheduled",
    status: "succeeded",
    includesPostgres: true,
    includesClickhouse: true,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + took * 1000),
    createdAt: startedAt,
    postgresSizeInBytes: postgres,
    clickhouseSizeInBytes: clickhouse,
    destinationFingerprint: FINGERPRINT,
    name,
    location: `${LOCATION}${name}/`,
    steps: [
      step("check-destination", "succeeded", {
        startedAt: at(startedAt, 0),
        finishedAt: at(startedAt, 1),
      }),
      step("back-up-postgres", "succeeded", {
        startedAt: at(startedAt, 1),
        finishedAt: at(startedAt, 4),
        progress: { doneBytes: postgres },
      }),
      step("back-up-clickhouse", "succeeded", {
        startedAt: at(startedAt, 4),
        finishedAt: at(startedAt, took - 2),
        progress: { doneBytes: clickhouse, doneFiles: 412 },
      }),
      step("verify-backup", "succeeded", {
        startedAt: at(startedAt, took - 2),
        finishedAt: at(startedAt, took - 1),
      }),
      step("delete-old-backups", "succeeded", {
        startedAt: at(startedAt, took - 1),
        finishedAt: at(startedAt, took),
        message: "Deleted 1 backup older than 30 days.",
      }),
    ],
    ...(overrides || {}),
  });
}

function runningBackup() {
  const startedAt = ago(2 * MINUTE + 5000);
  const runId = id(900);
  const name = backupName(startedAt, runId);
  return run({
    _id: runId,
    kind: "backup",
    trigger: "manual",
    status: "running",
    includesPostgres: true,
    includesClickhouse: true,
    startedAt,
    createdAt: startedAt,
    destinationFingerprint: FINGERPRINT,
    name,
    location: `${LOCATION}${name}/`,
    postgresSizeInBytes: 4412000,
    steps: [
      step("check-destination", "succeeded", {
        startedAt: at(startedAt, 0),
        finishedAt: at(startedAt, 1),
      }),
      step("back-up-postgres", "succeeded", {
        startedAt: at(startedAt, 1),
        finishedAt: at(startedAt, 5),
        progress: { doneBytes: 4412000 },
      }),
      step("back-up-clickhouse", "running", {
        startedAt: at(startedAt, 5),
        progress: {
          doneBytes: 1400000000,
          totalBytes: 2300000000,
          doneFiles: 233,
        },
      }),
      step("verify-backup", "pending"),
      step("delete-old-backups", "pending"),
    ],
  });
}

function failedBackup() {
  const startedAt = scheduledAt(0);
  return run({
    _id: id(901),
    kind: "backup",
    trigger: "scheduled",
    status: "failed",
    includesPostgres: true,
    includesClickhouse: true,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + 2000),
    createdAt: startedAt,
    destinationFingerprint: FINGERPRINT,
    error: STORAGE_REFUSED,
    steps: [
      step("check-destination", "succeeded", {
        startedAt: at(startedAt, 0),
        finishedAt: at(startedAt, 1),
      }),
      step("back-up-postgres", "failed", {
        startedAt: at(startedAt, 1),
        finishedAt: at(startedAt, 2),
        message: STORAGE_REFUSED,
      }),
      step("back-up-clickhouse", "skipped"),
      step("verify-backup", "skipped"),
      step("delete-old-backups", "skipped"),
    ],
  });
}

function runningRestore(of) {
  const startedAt = ago(4 * MINUTE);
  return run({
    _id: id(902),
    kind: "restore",
    trigger: "manual",
    status: "running",
    includesPostgres: true,
    includesClickhouse: true,
    startedAt,
    createdAt: startedAt,
    restoredBackupRunId: of.id,
    manifest: { startedAt: of.startedAt.toISOString() },
    steps: [
      step("check-backup", "succeeded", {
        startedAt: at(startedAt, 0),
        finishedAt: at(startedAt, 2),
      }),
      step("back-up-current-data", "succeeded", {
        startedAt: at(startedAt, 2),
        finishedAt: at(startedAt, 40),
      }),
      step("restore-postgres", "running", {
        startedAt: at(startedAt, 40),
        progress: { doneBytes: 2900000, totalBytes: 4300000 },
      }),
      step("restore-clickhouse", "pending"),
      step("switch-over", "pending"),
      step("upgrade-restored-data", "pending"),
      step("clean-up", "pending"),
    ],
  });
}

let setting =
  scene === "first-run"
    ? null
    : (() => {
        const record = new BackupSetting();
        record._id = SETTING_ID;
        record.id = new ObjectID(SETTING_ID);
        record.destinationType = "s3-compatible";
        record.destinationProvider = "minio";
        record.config = CONFIG;
        record.isEnabled = scene !== "off";
        record.frequency = "daily";
        record.timeOfDay = "02:00";
        record.dayOfWeek = 0;
        record.retentionInDays = 30;
        record.includesClickhouse = true;
        record.nextBackupAt = getNextBackupAt(SCHEDULE, new Date(NOW));
        return record;
      })();

const RUNS = [];

if (setting) {
  if (scene === "running") {
    RUNS.push(runningBackup());
  }

  if (scene === "failed") {
    RUNS.push(failedBackup());
  }

  // The failed one took the latest slot; the others are a day apart before it.
  for (const days of scene === "failed" ? [1, 2, 3] : [0, 1, 2]) {
    RUNS.push(backup(days));
  }

  RUNS.push(
    backup(9, { trigger: "manual" }),
    // Made at the destination this installation used before.
    backup(40, {
      trigger: "found-at-destination",
      destinationFingerprint: "s3:old-oneuptime-backups",
      location: "s3://old-oneuptime-backups/oneuptime/backups/",
    }),
  );

  if (scene === "restoring") {
    RUNS.unshift(runningRestore(RUNS[1]));
  } else {
    // A restore three days ago, for the Restores table.
    const of = RUNS[RUNS.length - 2];
    const startedAt = ago(3 * DAY);
    RUNS.push(
      run({
        kind: "restore",
        trigger: "manual",
        status: "succeeded",
        includesPostgres: true,
        includesClickhouse: false,
        startedAt,
        finishedAt: new Date(startedAt.getTime() + 38000),
        createdAt: startedAt,
        restoredBackupRunId: of.id,
        manifest: { startedAt: of.startedAt.toISOString() },
        steps: [],
      }),
    );
  }
}

function idOf(value) {
  return value ? value.toString().toLowerCase() : "";
}

function serialize(value) {
  return JSON.parse(
    JSON.stringify(value === undefined ? null : value, (_key, item) => {
      if (item instanceof ObjectID) {
        return item.toString();
      }
      return item;
    }),
  );
}

// The queries the Backups page reads with: equality, and Includes of statuses.
function matches(record, query) {
  for (const [key, condition] of Object.entries(query || {})) {
    if (condition === undefined || condition === null) {
      continue;
    }
    if (condition instanceof Includes) {
      if (!condition.values.map(String).includes(String(record[key]))) {
        return false;
      }
      continue;
    }
    if (typeof condition === "object") {
      window.__fixture.unmodeled.push({
        what: "query",
        key,
        condition: serialize(condition),
      });
      return false;
    }
    if (String(record[key]) !== String(condition)) {
      return false;
    }
  }
  return true;
}

function sorted(records, sort) {
  const [key, order] = Object.entries(sort || {})[0] || [
    "startedAt",
    "Descending",
  ];
  const time = (record) => {
    const value = record[key] || record.createdAt;
    return value ? new Date(value).getTime() : 0;
  };
  return [...records].sort((a, b) => {
    return String(order).toLowerCase().startsWith("asc")
      ? time(a) - time(b)
      : time(b) - time(a);
  });
}

function tableOf(modelType) {
  return new modelType().tableName;
}

// The Admin Dashboard's reader: a master admin, with no project roles.
User.isMasterAdmin = () => {
  return true;
};
User.isLoggedIn = () => {
  return true;
};
User.getUserId = () => {
  return new ObjectID(USER_ID);
};
PermissionUtil.getAllPermissions = () => {
  return [];
};
PermissionUtil.getProjectPermissions = () => {
  return null;
};
PermissionUtil.getGlobalPermissions = () => {
  return null;
};

ModelAPI.getList = async (options) => {
  const table = tableOf(options.modelType);
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);

  if (table === "BackupSetting") {
    const data = setting ? [setting] : [];
    return { data, count: data.length, skip, limit };
  }

  if (table === "BackupRun") {
    const found = sorted(
      RUNS.filter((record) => {
        return matches(record, options.query);
      }),
      options.sort,
    );
    return {
      data: found.slice(skip, skip + limit),
      count: found.length,
      skip,
      limit,
    };
  }

  window.__fixture.unmodeled.push({ what: "getList", table });
  return { data: [], count: 0, skip, limit };
};

ModelAPI.count = async (options) => {
  const table = tableOf(options.modelType);

  if (table === "BackupRun") {
    return RUNS.filter((record) => {
      return matches(record, options.query);
    }).length;
  }

  window.__fixture.unmodeled.push({ what: "count", table });
  return 0;
};

ModelAPI.getItem = async (options) => {
  const table = tableOf(options.modelType);

  if (table === "BackupRun") {
    return (
      RUNS.find((record) => {
        return idOf(record.id) === idOf(options.id);
      }) || null
    );
  }

  window.__fixture.unmodeled.push({ what: "getItem", table });
  return null;
};

ModelAPI.create = async (options) => {
  const table = tableOf(options.modelType);
  const json = options.model.toJSON ? options.model.toJSON() : options.model;
  window.__fixture.writes.push({
    what: "create",
    table,
    data: serialize(json),
  });

  if (table === "BackupSetting") {
    // Set up: the page now has settings, as the server would hold them.
    const record = options.model;
    record._id = SETTING_ID;
    record.id = new ObjectID(SETTING_ID);
    record.nextBackupAt = getNextBackupAt(SCHEDULE, new Date(NOW));
    setting = record;
  }

  return new HTTPResponse(200, json, {});
};

ModelAPI.updateById = async (options) => {
  const table = tableOf(options.modelType);
  window.__fixture.writes.push({
    what: "update",
    table,
    id: idOf(options.id),
    data: serialize(options.data),
  });

  if (table === "BackupSetting" && setting) {
    for (const [key, value] of Object.entries(options.data || {})) {
      setting[key] = value;
    }
  }

  return new HTTPResponse(200, {}, {});
};

const LICENSES = {
  valid: { status: "valid", licenseValid: true, features: ["*"] },
  grace: { status: "grace", licenseValid: true, features: ["*"] },
  lapsed: { status: "expired", licenseValid: false },
  "not-included": { status: "valid", licenseValid: true, features: ["scim"] },
};

const isAvailable = license === "valid" || license === "grace";

function overview() {
  return {
    isSetUp: Boolean(setting),
    isActive: isAvailable,
    isAvailable,
    nextBackupAt:
      setting && setting.isEnabled ? setting.nextBackupAt.toISOString() : null,
    location: setting ? LOCATION : null,
    destinationFingerprint: setting ? FINGERPRINT : null,
    postgres: {
      version: "16.4",
      sizeInBytes: 48700000,
      database: "oneuptimedb",
      canRestore: true,
      user: "postgres",
    },
    clickhouse: {
      version: "26.7.1.1",
      sizeInBytes: 2310000000,
      database: "oneuptime",
    },
  };
}

const TEST_OK = {
  isSuccessful: true,
  checks: [
    {
      key: "storage",
      isSuccessful: true,
      message:
        "OneUptime wrote, read, listed and deleted a test file at s3://oneuptime-backups/oneuptime/backups/oneuptime-backup-test/.",
    },
    {
      key: "postgres",
      isSuccessful: true,
      message: "pg_dump 16.4 is ready for PostgreSQL 16.4.",
    },
    {
      key: "clickhouse",
      isSuccessful: true,
      message:
        "ClickHouse wrote a test backup (its tables' definitions, no data) to the storage, then it was removed.",
    },
  ],
};

const TEST_FAIL = {
  isSuccessful: false,
  checks: [
    TEST_OK.checks[0],
    TEST_OK.checks[1],
    {
      key: "clickhouse",
      isSuccessful: false,
      message:
        "ClickHouse could not reach the storage: it connects to the storage itself, so its network must reach minio.acme.internal too.",
    },
  ],
};

function preview(body) {
  const backupRun = RUNS.find((record) => {
    return idOf(record.id) === idOf(body && body.backupRunId);
  });
  const problems = [];
  const warnings = [];

  if (previewAnswer === "problem") {
    problems.push({
      code: "newer-version",
      message:
        "OneUptime 14.9.0 made this backup, and this installation runs 14.0.88. Update OneUptime first.",
    });
  }

  if (previewAnswer === "warning") {
    warnings.push({
      code: "older-version",
      message:
        "OneUptime 14.0.80 made this backup. The restore brings its data up to 14.0.88.",
    });
  }

  return {
    backup: {
      id: backupRun ? idOf(backupRun.id) : "",
      name: (backupRun && backupRun.name) || "",
      startedAt: backupRun ? backupRun.startedAt.toISOString() : "",
      oneuptimeVersion: "14.0.88",
      postgres: {
        sizeInBytes: (backupRun && backupRun.postgresSizeInBytes) || 0,
        serverVersion: "16.4",
        counts: { projects: 3, users: 12, monitors: 140, statusPages: 2 },
      },
      clickhouse:
        backupRun && backupRun.includesClickhouse
          ? {
              sizeInBytes: backupRun.clickhouseSizeInBytes || 0,
              serverVersion: "26.7.1.1",
            }
          : null,
    },
    current: {
      oneuptimeVersion: "14.0.88",
      postgres: {
        database: "oneuptimedb",
        sizeInBytes: 48700000,
        counts: { projects: 4, users: 13, monitors: 151, statusPages: 2 },
      },
      clickhouse: { database: "oneuptime", sizeInBytes: 2310000000 },
    },
    problems,
    warnings,
  };
}

function routeOf(options) {
  const url = String((options && options.url) || "");
  const at = url.indexOf("/api/");
  return at >= 0 ? url.slice(at + 4).split("?")[0] : url;
}

API.fetch = async (options) => {
  const route = routeOf(options);

  if (route === "/global-config/license") {
    return new HTTPResponse(200, LICENSES[license] || LICENSES.valid, {});
  }

  window.__fixture.unmodeled.push({ what: "fetch", route });
  return new HTTPErrorResponse(404, { error: "Not modelled." }, {});
};

API.get = async (options) => {
  const route = routeOf(options);

  if (route === "/backup/overview") {
    return new HTTPResponse(200, overview(), {});
  }

  window.__fixture.unmodeled.push({ what: "get", route });
  return new HTTPErrorResponse(404, { error: "Not modelled." }, {});
};

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

API.post = async (options) => {
  const route = routeOf(options);
  const body = serialize(options && options.data);
  window.__fixture.posts.push({ route, body });

  switch (route) {
    case "/backup/test":
      await wait(400);
      return new HTTPResponse(
        200,
        testAnswer === "fail" ? TEST_FAIL : TEST_OK,
        {},
      );
    case "/backup/restore-preview":
      await wait(200);
      return new HTTPResponse(200, preview(body), {});
    case "/backup/restore":
    case "/backup/run-now":
      return new HTTPResponse(200, { backupRunId: id(950) }, {});
    case "/backup/find": {
      const found = RUNS.filter((record) => {
        return record.kind === "backup";
      }).length;
      return new HTTPResponse(
        200,
        { found, added: found > 0 ? 1 : 0, updated: 0, removed: 0 },
        {},
      );
    }
    case "/backup/cancel":
      return new HTTPResponse(200, { isCancelRequested: true }, {});
    case "/backup/delete":
      return new HTTPResponse(200, { deletedFiles: 3 }, {});
    default:
      window.__fixture.unmodeled.push({ what: "post", route });
      return new HTTPErrorResponse(404, { error: "Not modelled." }, {});
  }
};

const BACKUPS_PATH = "backups";

function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  const page = (getAdminDashboardPlugins().SettingsPages || []).find(
    (candidate) => {
      return candidate.path === BACKUPS_PATH;
    },
  );

  if (!page) {
    // The Community Edition: Settings has no Backups page.
    return (
      <main
        className="mx-auto max-w-[420px] px-4 py-8"
        data-testid="community-settings"
      >
        <SettingsSideMenu />
      </main>
    );
  }

  const Page = page.component;

  return (
    <Suspense fallback={<div data-testid="backups-page-loading" />}>
      <Page />
    </Suspense>
  );
}

await i18next.changeLanguage(language);
document.documentElement.lang = language;
document.documentElement.dir = language === "fa" ? "rtl" : "ltr";

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);
