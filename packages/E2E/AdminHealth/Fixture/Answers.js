/*
 * The server's side of Admin > OneUptime Health, in the page (#7048): the
 * facts the doctor's findings are worked out from - by the rules the server
 * uses (Common/Types/InstallationHealth, and the server setup checklist's
 * own, Common/Types/ServerSetup) - and what the landing page's other cards
 * read. Only the data boundary is replaced: API, ModelAPI and the signed-in
 * master admin.
 *
 * Steered by the query string:
 *   - scene=attention   things to fix and worth a look (the default): email
 *                       not set up, a failed migration, ClickHouse's disk
 *                       short of room, no global probe reporting and a
 *                       newer release
 *   - scene=all-right   nothing to say
 *   - scene=reference   the doctor's read fails as a failure the server
 *                       could not explain does: a 500 naming the reference
 *                       of its log lines (9c4e1a07)
 *   - scene=down        the doctor's read fails as a gateway's 502 does
 *   - lang=de|fa        the Admin Dashboard's German or Persian
 *
 * Recorded on window.__adminHealthFixture: every read the page makes
 * (reads), and every read or write the fixture does not model (unmodeled),
 * which each spec expects to stay empty.
 */
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import {
  ERROR_REFERENCE_FIELD,
  getUnexplainedServerErrorMessage,
} from "Common/Types/Exception/UnexplainedError";
import InstallationHealthUtil from "Common/Types/InstallationHealth/InstallationHealth";
import ObjectID from "Common/Types/ObjectID";
import ServerSetupChecklistUtil from "Common/Types/ServerSetup/ServerSetupChecklist";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "Common/UI/Utils/Permission";
import UserUtil from "Common/UI/Utils/User";

export const ADMIN_ID = "80000000-0000-4000-8000-000000000002";
export const REFERENCE = "9c4e1a07";

const params = new URLSearchParams(window.location.search);

export const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

export const scene = ["all-right", "reference", "down"].includes(
  params.get("scene"),
)
  ? params.get("scene")
  : "attention";

const record = { reads: [], unmodeled: [] };
window.__adminHealthFixture = record;

// A fixed time, so a finding that names when reads the same on every run.
const EARLIER = "2026-11-17T08:30:00.000Z";
const GB = 1000 * 1000 * 1000;

function channel(name, state) {
  return {
    channel: name,
    state: state,
    hasWorked: state === "working",
    lastWorkedAt: state === "working" ? EARLIER : null,
    failingSince: null,
    lastFailure: null,
    setUpProblem: null,
  };
}

// The server setup checklist's facts: a server set up but for email and probes.
function setupFacts() {
  const isAllRight = scene === "all-right";

  return {
    isHttpsSetUp: true,
    areSignupsClosed: true,
    email: channel("email", isAllRight ? "working" : "not-set-up"),
    sms: channel("sms", "working"),
    call: channel("call", "working"),
    push: channel("push", "working"),
    emailSentThrough: isAllRight ? "smtp.acme-commerce.example" : null,
    smsSentThrough: "Twilio",
    callSentThrough: "Twilio",
    globalProbes: { total: 1, reporting: isAllRight ? 1 : 0 },
    updateChecks: {
      isDisabled: false,
      lastCheckedAt: EARLIER,
      lastFailure: null,
    },
    lastBackup: { succeeded: true, finishedAt: EARLIER, error: null },
    lastScriptBackup: null,
    hasScheduledBackups: true,
    installKind: "docker-compose",
    isBrowserPushSetUp: true,
    hasAiProvider: true,
    hasSingleSignOn: true,
    choices: { choices: {}, hiddenBy: {} },
  };
}

// What the server reads of itself.
function facts() {
  const isAllRight = scene === "all-right";

  return {
    isPostgresConnected: true,
    isClickhouseConnected: true,
    isValkeyConnected: true,
    migrations: isAllRight
      ? { pending: 0, failure: null }
      : {
          pending: 1,
          failure: {
            name: "AddIncidentLabelsIndex1809183500000",
            reason: 'relation "IncidentLabel" already exists',
            at: EARLIER,
          },
        },
    clickhouseDisks: [
      {
        name: "clickhouse default",
        freeInBytes: (isAllRight ? 60 : 14) * GB,
        totalInBytes: 100 * GB,
      },
    ],
    queues: [{ name: "Worker", waiting: 4 }],
    version: {
      current: "16.0.0",
      latest: isAllRight ? "16.0.0" : "16.1.0",
      isUpdateAvailable: !isAllRight,
      isUpdateCheckDisabled: false,
    },
    serverSetup: ServerSetupChecklistUtil.getAnswer({
      facts: setupFacts(),
      readerUserId: ADMIN_ID,
    }),
  };
}

// The doctor's answer to the Admin Dashboard's GET, as the server sends it.
function doctor() {
  return JSON.parse(
    JSON.stringify(
      InstallationHealthUtil.getAnswer({
        facts: facts(),
        addressProof: null,
        checkedAt: EARLIER,
      }),
    ),
  );
}

// ClickHouse at a glance: one disk, as full as the doctor says it is.
function clickhouseCapacity() {
  const free = (scene === "all-right" ? 60 : 14) * GB;

  return {
    connected: true,
    dataSizeInBytes: 41 * GB,
    diskTotalInBytes: 100 * GB,
    diskFreeInBytes: free,
    diskByNode: [
      {
        host: "clickhouse",
        diskName: "default",
        totalInBytes: 100 * GB,
        freeInBytes: free,
      },
    ],
  };
}

// The signed-in reader: the server's master admin.
UserUtil.isMasterAdmin = () => {
  return true;
};
UserUtil.isLoggedIn = () => {
  return true;
};
UserUtil.getUserId = () => {
  return new ObjectID(ADMIN_ID);
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

function tableOf(options) {
  return options && options.modelType
    ? new options.modelType().tableName
    : "unknown";
}

ModelAPI.getItem = async (options) => {
  record.unmodeled.push({ what: "getItem", table: tableOf(options) });
  return null;
};

ModelAPI.getList = async (options) => {
  record.unmodeled.push({ what: "getList", table: tableOf(options) });
  return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
};

ModelAPI.count = async (options) => {
  record.unmodeled.push({ what: "count", table: tableOf(options) });
  return 0;
};

function urlOf(options) {
  return String((options && options.url) || "").split("?")[0];
}

function ok(body) {
  return new HTTPResponse(200, body, {});
}

function notModelled(what, url) {
  record.unmodeled.push({ what, url });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
}

// What the page reads.
function read(url) {
  if (url.endsWith("/admin/health/doctor")) {
    if (scene === "reference") {
      // A failure the server could not explain, as its last resort answers it.
      return new HTTPErrorResponse(
        500,
        {
          message: getUnexplainedServerErrorMessage(REFERENCE),
          [ERROR_REFERENCE_FIELD]: REFERENCE,
        },
        {},
      );
    }

    if (scene === "down") {
      // A gateway's 502: the server could not be reached.
      return new HTTPErrorResponse(502, { message: "Bad Gateway" }, {});
    }

    return ok(doctor());
  }

  if (url.endsWith("/admin/health/clickhouse-capacity")) {
    return ok(clickhouseCapacity());
  }

  // Nobody shares an address: the card that would say so draws nothing.
  if (url.endsWith("/admin/health/visitor-addresses")) {
    return ok({ addresses: [], addressCount: 0 });
  }

  return null;
}

API.fetch = async (options) => {
  const url = urlOf(options);
  record.reads.push(url);
  return read(url) || notModelled("fetch", url);
};

API.get = async (options) => {
  const url = urlOf(options);
  record.reads.push(url);
  return read(url) || notModelled("get", url);
};

API.post = async (options) => {
  return notModelled("post", urlOf(options));
};
