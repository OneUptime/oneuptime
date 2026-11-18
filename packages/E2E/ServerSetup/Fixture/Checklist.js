/*
 * The server's side of Server setup, in the page (#7027): the facts the
 * setup checklist is worked out from - by the rules the server uses
 * (Common/Types/ServerSetup) - the server's one settings row, the choices
 * and the hide an admin makes, and what a test send answers. Only the data
 * boundary is replaced: ModelAPI, API and the signed-in master admin.
 *
 * Steered by the query string:
 *   - scene=fresh      a server that has just started: nothing set up (the
 *                      default)
 *   - scene=untested   email and SMS and calls set up, nothing tested yet
 *   - answer=accepted|refused|not-set-up   what every test send answers
 *                      (accepted when left out)
 *   - install=docker-compose|kubernetes    how the server was installed,
 *                      as it reads it; not known when left out
 *   - lang=de|fa       the frontends' German or Persian
 *
 * Recorded on window.__serverSetupFixture: every post the page makes
 * (posts), and every read or write the fixture does not model (unmodeled),
 * which each spec expects to stay empty.
 */
import GlobalConfig, {
  EmailServerType,
} from "Common/Models/DatabaseModels/GlobalConfig";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Hostname from "Common/Types/API/Hostname";
import ServerTwilioEnvironment, {
  SERVER_TWILIO_ENVIRONMENT_ROUTE,
} from "Common/Types/CallAndSMS/ServerTwilioEnvironment";
import Email from "Common/Types/Email";
import ServerEmailEnvironment, {
  SERVER_EMAIL_ENVIRONMENT_ROUTE,
} from "Common/Types/Email/ServerEmailEnvironment";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import Port from "Common/Types/Port";
import ServerSetupChecklistUtil from "Common/Types/ServerSetup/ServerSetupChecklist";
import { SERVER_SET_UP_PROBLEMS } from "Common/Types/ServerSending/ServerSetUpProblem";
import { SERVER_TEST_PUSH_REASONS } from "Common/Types/ServerSetup/ServerTestSend";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "Common/UI/Utils/Permission";
import UserUtil from "Common/UI/Utils/User";

export const ADMIN_ID = "80000000-0000-4000-8000-000000000001";
export const ADMIN_EMAIL = "ada@acme-commerce.example";
const MAIL_SERVER = "smtp.acme-commerce.example";

const params = new URLSearchParams(window.location.search);

export const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const isSetUp = params.get("scene") === "untested";
const testAnswer = ["refused", "not-set-up"].includes(params.get("answer"))
  ? params.get("answer")
  : "accepted";
const installKind = ["docker-compose", "kubernetes"].includes(
  params.get("install"),
)
  ? params.get("install")
  : "unknown";

const record = { posts: [], unmodeled: [] };
window.__serverSetupFixture = record;

const now = () => {
  return new Date().toISOString();
};

/*
 * Why a channel sends nothing yet, in the server's words
 * (Common/Server/Utils/ServerSending/ServerChannelSetup), and why a test
 * push went nowhere: the admin has no device registered.
 */
const NOT_SET_UP = {
  email: SERVER_SET_UP_PROBLEMS.emailNotSetUp,
  sms: SERVER_SET_UP_PROBLEMS.smsNotSetUp,
  call: SERVER_SET_UP_PROBLEMS.callNotSetUp,
  push: SERVER_TEST_PUSH_REASONS.noDevices,
};

/*
 * The same, as words the page says in its reader's language (#9437), as
 * the server sends them beside the English. A test push's own reasons are
 * keys of the Admin Dashboard already, and come as they are.
 */
const NOT_SET_UP_WORDS = {
  email: { template: SERVER_SET_UP_PROBLEMS.emailNotSetUp, values: {} },
  sms: { template: SERVER_SET_UP_PROBLEMS.smsNotSetUp, values: {} },
  call: { template: SERVER_SET_UP_PROBLEMS.callNotSetUp, values: {} },
};

// What took a test, as the server names it.
const SENT_THROUGH = {
  email: MAIL_SERVER,
  sms: "Twilio",
  call: "Twilio",
  push: null,
};

// What each provider said when it refused one, word for word.
const REFUSED = {
  email: "535 5.7.8 Username and Password not accepted",
  sms: "The 'From' phone number +14155550100 is not a valid, SMS-capable inbound phone number.",
  call: "The 'From' phone number +14155550100 is not a valid, voice-capable inbound phone number.",
  push: "Chrome on Linux: 410 Gone",
};

function channel(name, state, extra) {
  return {
    channel: name,
    state: state,
    hasWorked: state === "working",
    lastWorkedAt: state === "working" ? now() : null,
    failingSince: null,
    lastFailure: null,
    setUpProblem: state === "not-set-up" ? NOT_SET_UP[name] : null,
    ...(state === "not-set-up" && NOT_SET_UP_WORDS[name]
      ? { setUpProblemWords: NOT_SET_UP_WORDS[name] }
      : {}),
    ...(extra || {}),
  };
}

// What the server reads: a server that has just started, or one set up.
const facts = {
  isHttpsSetUp: false,
  areSignupsClosed: false,
  email: channel("email", isSetUp ? "untested" : "not-set-up"),
  sms: channel("sms", isSetUp ? "untested" : "not-set-up"),
  call: channel("call", isSetUp ? "untested" : "not-set-up"),
  // Push is on, as on every server until it is turned off.
  push: channel("push", "untested"),
  emailSentThrough: isSetUp ? MAIL_SERVER : null,
  smsSentThrough: "Twilio",
  callSentThrough: "Twilio",
  globalProbes: { total: 1, reporting: 0 },
  updateChecks: {
    isDisabled: false,
    lastCheckedAt: now(),
    lastFailure: null,
  },
  lastBackup: null,
  lastScriptBackup: null,
  hasScheduledBackups: false,
  installKind: installKind,
  isBrowserPushSetUp: false,
  hasAiProvider: false,
  hasSingleSignOn: false,
  choices: { choices: {}, hiddenBy: {} },
};

function checklist() {
  return JSON.parse(
    JSON.stringify(
      ServerSetupChecklistUtil.getAnswer({ facts, readerUserId: ADMIN_ID }),
    ),
  );
}

// The server's one settings row: nothing saved, or its mail server and Twilio.
function globalConfig() {
  const config = new GlobalConfig();

  config._id = ObjectID.getZeroObjectID().toString();
  config.id = ObjectID.getZeroObjectID();

  if (isSetUp) {
    Object.assign(config, {
      emailServerType: EmailServerType.CustomSMTP,
      smtpHost: new Hostname(MAIL_SERVER),
      smtpPort: new Port(587),
      smtpUsername: "oneuptime@acme-commerce.example",
      smtpFromEmail: new Email("oneuptime@acme-commerce.example"),
      smtpFromName: "Acme OneUptime",
      twilioAccountSID: "AC11111111111111111111111111111111",
      twilioPrimaryPhoneNumber: new Phone("+14155550100"),
    });
  }

  return config;
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
UserUtil.getEmail = () => {
  return new Email(ADMIN_EMAIL);
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
  if (options.modelType === GlobalConfig) {
    return globalConfig();
  }

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

ModelAPI.updateById = async (options) => {
  record.unmodeled.push({ what: "updateById", table: tableOf(options) });
  return {};
};

ModelAPI.createOrUpdate = async (options) => {
  record.unmodeled.push({ what: "createOrUpdate", table: tableOf(options) });
  return { data: options.model };
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

// What the pages read.
function read(url) {
  if (url.endsWith("/global-config/setup-checklist")) {
    return ok(checklist());
  }

  // Nothing set by environment variables: the saved settings are the server's.
  if (url.endsWith(SERVER_EMAIL_ENVIRONMENT_ROUTE)) {
    return ok(
      JSON.parse(
        JSON.stringify(
          ServerEmailEnvironment.toAnswer(ServerEmailEnvironment.read({})),
        ),
      ),
    );
  }

  if (url.endsWith(SERVER_TWILIO_ENVIRONMENT_ROUTE)) {
    return ok(
      JSON.parse(
        JSON.stringify(
          ServerTwilioEnvironment.toAnswer(ServerTwilioEnvironment.read({})),
        ),
      ),
    );
  }

  return null;
}

API.fetch = async (options) => {
  const url = urlOf(options);
  return read(url) || notModelled("fetch", url);
};

API.get = async (options) => {
  const url = urlOf(options);
  return read(url) || notModelled("get", url);
};

/*
 * A test send, as the server answers it: through the channel's provider,
 * which takes it, refuses it or is not there. What it answered changes
 * the channel, as the server records it.
 */
function testSend(name, body) {
  const to =
    name === "email"
      ? String(body.toEmail || "")
      : name === "push"
        ? ""
        : String(body.toPhone || "");

  if (testAnswer === "refused") {
    facts[name] = channel(name, "failing", {
      failingSince: now(),
      lastFailure: REFUSED[name],
    });

    return {
      channel: name,
      result: "refused",
      to: to,
      sentThrough: SENT_THROUGH[name],
      message: REFUSED[name],
    };
  }

  if (testAnswer === "not-set-up") {
    return {
      channel: name,
      result: "not-set-up",
      to: to,
      sentThrough: null,
      message: NOT_SET_UP[name],
      ...(NOT_SET_UP_WORDS[name]
        ? { messageWords: NOT_SET_UP_WORDS[name] }
        : {}),
    };
  }

  facts[name] = channel(name, "working");

  return {
    channel: name,
    result: "accepted",
    // A test push names the admin's devices that took it.
    to: name === "push" ? "Pixel 8, Chrome on Linux" : to,
    sentThrough: SENT_THROUGH[name],
    message: null,
  };
}

API.post = async (options) => {
  const url = urlOf(options);
  const body = JSON.parse(JSON.stringify((options && options.data) || {}));

  record.posts.push({ url: url, body: body });

  if (url.endsWith("/global-config/setup-checklist/choice")) {
    facts.choices = ServerSetupChecklistUtil.withChoice({
      choices: facts.choices,
      check: body.check,
      kind: body.choice === undefined ? null : body.choice,
      byUserId: ADMIN_ID,
      now: new Date(),
    });
    return ok(checklist());
  }

  if (url.endsWith("/global-config/setup-checklist/hide")) {
    facts.choices = ServerSetupChecklistUtil.withHidden({
      choices: facts.choices,
      userId: ADMIN_ID,
      openRequired: checklist().openRequired,
      now: new Date(),
    });
    return ok(checklist());
  }

  const test = /\/server-test\/(email|sms|call|push)$/.exec(url);

  if (test) {
    return ok(testSend(test[1], body));
  }

  return notModelled("post", url);
};
