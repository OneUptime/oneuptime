import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import {
  SECRETS_IN_TELEMETRY_CHECK_ID,
  SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
} from "../../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataTypeNamer from "../../../../../Types/DataSecurity/DataTypeNamer";
import {
  TelemetryLeakFixDecision,
  TelemetryLeakFixStrategy,
  TelemetryLeakPlace,
  TelemetryLeakSignal,
  decideTelemetryLeakFix,
  getTelemetryLeakSignal,
  getTelemetryLeakStartFiles,
} from "../../../../../Types/DataSecurity/TelemetryLeakFix";
import { getScrubTarget } from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import { JSONObject } from "../../../../../Types/JSON";
import { buildTelemetryLeakTemplate } from "../../../../../Utils/DataSecurity/TelemetryLeakTemplate";
import { ResolvableRepository } from "../../../CodeRepository/StackTraceRepoResolver";
import { readLeakPlaces } from "../../../DataSecurity/Telemetry/TelemetryLeakPlaces";
import {
  TelemetryLeakRepositoryGroup,
  TelemetryLeakToPlace,
  chooseTelemetryLeakRepositories,
  toRepositoryPath,
} from "../../../DataSecurity/Telemetry/TelemetryLeakRepositories";
import { TelemetrySampleSource } from "../../../DataSecurity/Telemetry/TelemetrySampleSource";
import { DataSecurityAiCodeRequest } from "../../DataSecurity/DataSecurityAiInput";
import { buildTelemetryLeakFixRequest } from "../../DataSecurity/DataSecurityTelemetryFixPrompt";
import { FixEvalFileCheck } from "./DataSecurityEvalCase";

/*
 * AN EVAL SET OF RECORDED TELEMETRY LEAKS, EACH WITH THE FILE AND LINE IT
 * SHOULD LEAD TO (#10367).
 *
 * Each case is a made-up service - its repository, written out in Node.js
 * with its own tests - and the findings Data Security would have in its
 * telemetry: the rows of the records each finding was seen in, as the
 * locator reads them (TelemetryLeakLocator's buildLeakRecordStatement), with
 * the values in them a service would really have written. And where each
 * finding should lead: the file and line that writes it.
 *
 * It is read three ways, so the three cannot drift apart:
 *
 *   - the locator's own suite (TelemetryLeakEvalSet.test.ts): the records,
 *     read as the product reads them (TelemetryLeakPlaces), placed in the
 *     case's repository (TelemetryLeakRepositories) and decided
 *     (decideTelemetryLeakFix), lead to each finding's file and line - by
 *     the file the records name, or by what the agent searches for (a
 *     template's words, a metric's name, the key) - and none of the values
 *     in the records reaches the request;
 *   - the Data Security eval (DataSecurityEvalCases): the request the
 *     builder makes from them, answered in one call, changes the files the
 *     fix needs;
 *   - the code agent's benchmark (packages/Runner/Benchmark): the agent,
 *     handed that very request, fixes the repository, and a check never in
 *     the repository says the data no longer leaves the service.
 *
 * No value here is a customer's, and no secret is written as one: a key
 * is put together where it is used (fakeKey), so no scanner reads one here.
 */

// A made-up key, put together where it is used: never written whole.
export function fakeStripeLiveKey(): string {
  return ["sk", "live", "Fk7Qz2Lp9Xw4Rt6Hy3Nc8Vb5Jm1"].join("_");
}

// One finding, as its records and its issue would have it.
export interface RecordedTelemetryLeakFinding {
  findingId: string;
  issueId: string;
  dataStoreId: string;
  storeKind: DataStoreKind;
  checkId: string;
  location: string;
  dataTypeId: string;
  isMaskedByScrubRule?: boolean | undefined;
  // The records it was seen in, as the locator's read returns their rows.
  rows: Array<JSONObject>;
  // Where it should lead: a file and line that writes it, the first the best.
  leadsTo: Array<{ file: string; line: number }>;
  // The values the records hold: none may reach the request.
  values: Array<string>;
}

export interface TelemetryLeakEvalCase {
  id: string;
  title: string;
  serviceId: string;
  serviceName: string;
  // The repository the service's code is in: path to content.
  files: Record<string, string>;
  findings: Array<RecordedTelemetryLeakFinding>;
  expectStrategy: TelemetryLeakFixStrategy;
  // What the fixed code must and must not hold (the Data Security eval's checks).
  expect: Array<FixEvalFileCheck>;
  /*
   * For the code agent's benchmark: the check, a script never written into
   * the repository - REPOSITORY, path, assert and load() are there - and
   * the files the fix a person would make leaves.
   */
  check: string;
  solution: Record<string, string>;
  // Files a right fix leaves as they are: a redaction step edits no call site.
  untouchedFiles?: Array<string> | undefined;
  // A right fix adds or changes a test that names this text.
  testNames?: string | undefined;
}

// The 1-based line of the first line of `text` that holds `needle`.
export function lineOf(text: string, needle: string): number {
  const index: number = text.split("\n").findIndex((line: string): boolean => {
    return line.includes(needle);
  });

  if (index < 0) {
    throw new Error(`No line holds ${needle}.`);
  }

  return index + 1;
}

const PACKAGE_JSON: (name: string) => string = (name: string): string => {
  return `${JSON.stringify(
    {
      name,
      version: "1.0.0",
      private: true,
      scripts: { test: "node --test test/" },
    },
    null,
    2,
  )}\n`;
};

/*
 * The service's telemetry, as a tiny SDK would have it: spans, log lines and
 * metrics, each handed to every processor in order before it is exported.
 */
export const TELEMETRY_JS: string = [
  '"use strict";',
  "",
  "/*",
  " * The service's telemetry: its spans, log lines and metrics, each handed",
  " * to every processor in order before it is exported.",
  " */",
  "const exported = { spans: [], logs: [], metrics: [] };",
  "const spanProcessors = [];",
  "const logProcessors = [];",
  "",
  "function runProcessors(processors, record) {",
  "  let current = record;",
  "",
  "  for (const processor of processors) {",
  "    current = processor(current) || current;",
  "  }",
  "",
  "  return current;",
  "}",
  "",
  "function startSpan(name) {",
  "  const attributes = {};",
  "",
  "  return {",
  "    setAttribute(key, value) {",
  "      attributes[key] = value;",
  "    },",
  "    end() {",
  "      exported.spans.push(",
  "        runProcessors(spanProcessors, { name, attributes: { ...attributes } }),",
  "      );",
  "    },",
  "  };",
  "}",
  "",
  "function emit(level, body, attributes) {",
  "  exported.logs.push(",
  "    runProcessors(logProcessors, {",
  "      level,",
  "      body,",
  "      attributes: { ...(attributes || {}) },",
  "    }),",
  "  );",
  "}",
  "",
  "const logger = {",
  "  info(body, attributes) {",
  '    emit("info", body, attributes);',
  "  },",
  "  warn(body, attributes) {",
  '    emit("warn", body, attributes);',
  "  },",
  "};",
  "",
  "const meter = {",
  "  createCounter(name) {",
  "    return {",
  "      add(value, attributes) {",
  "        exported.metrics.push({ name, value, attributes: { ...(attributes || {}) } });",
  "      },",
  "    };",
  "  },",
  "};",
  "",
  "function reset() {",
  "  exported.spans.length = 0;",
  "  exported.logs.length = 0;",
  "  exported.metrics.length = 0;",
  "}",
  "",
  "module.exports = { startSpan, logger, meter, exported, spanProcessors, logProcessors, reset };",
  "",
].join("\n");

// The time a case's records were written, a millisecond apart.
function at(index: number): number {
  return 1_795_000_000_000 + index;
}

/*
 * ---------------------------------------------------------------------------
 * 1. A service writes user.email on a span and in a log line: one pull
 *    request that changes the lines that write both, found from the records
 *    (the issue's first scenario).
 * ---------------------------------------------------------------------------
 */

const SIGNUP_JS: string = [
  '"use strict";',
  "",
  'const { startSpan, logger } = require("./telemetry");',
  'const users = require("./users");',
  "",
  "// Signs a customer up.",
  "function signUp(user) {",
  '  const span = startSpan("POST /signup");',
  "",
  '  span.setAttribute("user.id", user.id);',
  '  span.setAttribute("user.email", user.email);',
  "  users.save(user);",
  "  logger.info(`User ${user.email} signed up`);",
  "  span.end();",
  "",
  "  return { id: user.id };",
  "}",
  "",
  "module.exports = { signUp };",
  "",
].join("\n");

const SPAN_AND_LOG: TelemetryLeakEvalCase = {
  id: "user-email-on-a-span-and-in-a-log-line",
  title: "A sign-up writes the user's email on its span and in its log line",
  serviceId: "5e000000-0000-4000-8000-000000000001",
  serviceName: "checkout",
  files: {
    "package.json": PACKAGE_JSON("checkout"),
    "src/telemetry.js": TELEMETRY_JS,
    "src/users.js": [
      '"use strict";',
      "",
      "const saved = [];",
      "",
      "function save(user) {",
      "  saved.push({ id: user.id });",
      "}",
      "",
      "module.exports = { save, saved };",
      "",
    ].join("\n"),
    "src/signup.js": SIGNUP_JS,
    "test/signup.test.js": [
      '"use strict";',
      "",
      'const test = require("node:test");',
      'const assert = require("node:assert");',
      'const { signUp } = require("../src/signup");',
      "",
      'test("a sign-up answers with the user\'s id", () => {',
      '  assert.deepStrictEqual(signUp({ id: "u-1", email: "someone@example.org" }), { id: "u-1" });',
      "});",
      "",
    ].join("\n"),
  },
  findings: [
    {
      findingId: "f1000000-0000-4000-8000-000000000001",
      issueId: "15000000-0000-4000-8000-000000000101",
      dataStoreId: "51000000-0000-4000-8000-000000000101",
      storeKind: DataStoreKind.TelemetryTraces,
      checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      location: "attributes.user.email",
      dataTypeId: "email-address",
      rows: [
        {
          recordTime: at(1),
          readFile1: "/usr/src/app/src/signup.js",
          readLine1: String(lineOf(SIGNUP_JS, '"user.email"')),
          readFunction1: "signUp",
          readScope: "checkout",
          readName: "POST /signup",
        },
        {
          recordTime: at(2),
          readFile1: "/usr/src/app/src/signup.js",
          readLine1: String(lineOf(SIGNUP_JS, '"user.email"')),
          readFunction1: "signUp",
          readScope: "checkout",
          readName: "POST /signup",
        },
      ],
      leadsTo: [
        { file: "src/signup.js", line: lineOf(SIGNUP_JS, '"user.email"') },
      ],
      values: [],
    },
    {
      findingId: "f1000000-0000-4000-8000-000000000002",
      issueId: "15000000-0000-4000-8000-000000000102",
      dataStoreId: "51000000-0000-4000-8000-000000000102",
      storeKind: DataStoreKind.TelemetryLogs,
      checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      location: "body",
      dataTypeId: "email-address",
      rows: [
        {
          recordTime: at(3),
          readFile1: "/usr/src/app/src/signup.js",
          readLine1: String(lineOf(SIGNUP_JS, "logger.info")),
          readFunction1: "signUp",
          readScope: "checkout",
          readBody: "User jane.doe@example.com signed up",
        },
        {
          recordTime: at(4),
          readFile1: "/usr/src/app/src/signup.js",
          readLine1: String(lineOf(SIGNUP_JS, "logger.info")),
          readFunction1: "signUp",
          readScope: "checkout",
          readBody: "User sam.lee@example.net signed up",
        },
      ],
      leadsTo: [
        { file: "src/signup.js", line: lineOf(SIGNUP_JS, "logger.info") },
      ],
      values: ["jane.doe@example.com", "sam.lee@example.net"],
    },
  ],
  expectStrategy: TelemetryLeakFixStrategy.CallSites,
  expect: [
    {
      path: "src/signup.js",
      mustMatch: ['setAttribute\\("user\\.id"', "users\\.save\\(user\\)"],
      mustNotMatch: [
        'setAttribute\\("user\\.email",\\s*user\\.email\\)',
        "\\$\\{user\\.email\\}",
      ],
    },
  ],
  check: [
    'const telemetry = load("src/telemetry.js");',
    'const { signUp } = load("src/signup.js");',
    "telemetry.reset();",
    'const email = "jane.doe@example.com";',
    'assert.deepStrictEqual(signUp({ id: "u-7", email }), { id: "u-7" }, "the sign-up no longer answers with the user\'s id");',
    'assert.strictEqual(telemetry.exported.spans.length, 1, "the sign-up no longer sends its span");',
    'assert.strictEqual(telemetry.exported.spans[0].attributes["user.id"], "u-7", "the span lost the user\'s id");',
    'assert.strictEqual(telemetry.exported.logs.length, 1, "the sign-up no longer logs");',
    "const everything = JSON.stringify(telemetry.exported);",
    'assert.ok(!everything.includes(email), "the email address still reaches the telemetry");',
    'assert.ok(!everything.includes("jane.doe"), "part of the email address still reaches the telemetry");',
  ].join("\n"),
  solution: {
    "src/signup.js": SIGNUP_JS.replace(
      '  span.setAttribute("user.email", user.email);\n',
      "",
    ).replace(
      "logger.info(`User ${user.email} signed up`);",
      "logger.info(`User ${user.id} signed up`);",
    ),
  },
};

/*
 * ---------------------------------------------------------------------------
 * 2. A service writes customer.email in twenty places: one redaction step
 *    and a test, not twenty edits (the issue's second scenario).
 * ---------------------------------------------------------------------------
 */

const STEP_COUNT: number = 10;

function stepName(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function stepFile(index: number): string {
  return [
    '"use strict";',
    "",
    'const { startSpan } = require("../telemetry");',
    "",
    `// Step ${stepName(index)} of an order.`,
    "function run(order) {",
    `  const span = startSpan("order.step${stepName(index)}");`,
    "",
    '  span.setAttribute("order.id", order.id);',
    '  span.setAttribute("customer.email", order.customer.email);',
    "  span.end();",
    "",
    `  return "step${stepName(index)}";`,
    "}",
    "",
    "module.exports = { run };",
    "",
  ].join("\n");
}

function noticeFile(index: number): string {
  return [
    '"use strict";',
    "",
    'const { logger } = require("../telemetry");',
    "",
    `// Notice ${stepName(index)} of an order: what its customer is told.`,
    "function send(order) {",
    `  logger.info("Order notice ${stepName(index)} sent", {`,
    '    "order.id": order.id,',
    '    "customer.email": order.customer.email,',
    "  });",
    "",
    `  return "notice${stepName(index)}";`,
    "}",
    "",
    "module.exports = { send };",
    "",
  ].join("\n");
}

const ORDER_FILES: Record<string, string> = ((): Record<string, string> => {
  const files: Record<string, string> = {
    "package.json": PACKAGE_JSON("orders"),
    "src/telemetry.js": TELEMETRY_JS,
  };

  for (let index: number = 0; index < STEP_COUNT; index++) {
    files[`src/handlers/step${stepName(index)}.js`] = stepFile(index);
    files[`src/notify/notice${stepName(index)}.js`] = noticeFile(index);
  }

  files["src/index.js"] = [
    '"use strict";',
    "",
    "const steps = [",
    ...Array.from({ length: STEP_COUNT }, (_: unknown, index: number) => {
      return `  require("./handlers/step${stepName(index)}"),`;
    }),
    "];",
    "const notices = [",
    ...Array.from({ length: STEP_COUNT }, (_: unknown, index: number) => {
      return `  require("./notify/notice${stepName(index)}"),`;
    }),
    "];",
    "",
    "// An order through every step, and every notice it sends.",
    "function processOrder(order) {",
    "  return [",
    "    ...steps.map((step) => step.run(order)),",
    "    ...notices.map((notice) => notice.send(order)),",
    "  ];",
    "}",
    "",
    "module.exports = { processOrder };",
    "",
  ].join("\n");
  files["test/orders.test.js"] = [
    '"use strict";',
    "",
    'const test = require("node:test");',
    'const assert = require("node:assert");',
    'const { processOrder } = require("../src/index");',
    "",
    'test("an order goes through every step and sends every notice", () => {',
    '  assert.strictEqual(processOrder({ id: "o-1", customer: { email: "a@example.org" } }).length, 20);',
    "});",
    "",
  ].join("\n");

  return files;
})();

const CALL_SITE_FILES: Array<string> = Array.from(
  { length: STEP_COUNT },
  (_: unknown, index: number): Array<string> => {
    return [
      `src/handlers/step${stepName(index)}.js`,
      `src/notify/notice${stepName(index)}.js`,
    ];
  },
).flat();

const TWENTY_PLACES: TelemetryLeakEvalCase = {
  id: "customer-email-in-twenty-places",
  title:
    "Twenty handlers write the customer's email: one redaction step and a test",
  serviceId: "5e000000-0000-4000-8000-000000000002",
  serviceName: "orders",
  files: ORDER_FILES,
  findings: [
    {
      findingId: "f1000000-0000-4000-8000-000000000003",
      issueId: "15000000-0000-4000-8000-000000000201",
      dataStoreId: "51000000-0000-4000-8000-000000000201",
      storeKind: DataStoreKind.TelemetryTraces,
      checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      location: "attributes.customer.email",
      dataTypeId: "email-address",
      rows: Array.from(
        { length: STEP_COUNT },
        (_: unknown, index: number): JSONObject => {
          return {
            recordTime: at(100 + index),
            readFile1: `/app/src/handlers/step${stepName(index)}.js`,
            readLine1: String(lineOf(stepFile(index), '"customer.email"')),
            readFunction1: "run",
            readScope: "orders",
            readName: `order.step${stepName(index)}`,
          };
        },
      ),
      leadsTo: Array.from(
        { length: STEP_COUNT },
        (_: unknown, index: number): { file: string; line: number } => {
          return {
            file: `src/handlers/step${stepName(index)}.js`,
            line: lineOf(stepFile(index), '"customer.email"'),
          };
        },
      ),
      values: [],
    },
    {
      findingId: "f1000000-0000-4000-8000-000000000004",
      issueId: "15000000-0000-4000-8000-000000000202",
      dataStoreId: "51000000-0000-4000-8000-000000000202",
      storeKind: DataStoreKind.TelemetryLogs,
      checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      location: "attributes.customer.email",
      dataTypeId: "email-address",
      rows: Array.from(
        { length: STEP_COUNT },
        (_: unknown, index: number): JSONObject => {
          return {
            recordTime: at(200 + index),
            readFile1: `/app/src/notify/notice${stepName(index)}.js`,
            readLine1: String(lineOf(noticeFile(index), "logger.info")),
            readFunction1: "send",
            readScope: "orders",
            readBody: `Order notice ${stepName(index)} sent`,
          };
        },
      ),
      leadsTo: Array.from(
        { length: STEP_COUNT },
        (_: unknown, index: number): { file: string; line: number } => {
          return {
            file: `src/notify/notice${stepName(index)}.js`,
            line: lineOf(noticeFile(index), "logger.info"),
          };
        },
      ),
      values: [],
    },
  ],
  expectStrategy: TelemetryLeakFixStrategy.RedactionStep,
  expect: [
    {
      path: "src/telemetry.js",
      mustMatch: ["customer\\.email", "Processors\\.push\\("],
      mustNotMatch: [],
    },
  ],
  check: [
    'const srcDirectory = path.join(REPOSITORY, "src");',
    "for (const key of Object.keys(require.cache)) {",
    "  if (key.startsWith(srcDirectory)) {",
    "    delete require.cache[key];",
    "  }",
    "}",
    'const telemetry = require(path.join(REPOSITORY, "src/telemetry.js"));',
    'const { processOrder } = require(path.join(REPOSITORY, "src/index.js"));',
    "telemetry.reset();",
    'const email = "pat.kim@example.com";',
    'assert.strictEqual(processOrder({ id: "o-9", customer: { email } }).length, 20, "an order no longer goes through every step");',
    'assert.strictEqual(telemetry.exported.spans.length, 10, "a step no longer sends its span");',
    'assert.strictEqual(telemetry.exported.logs.length, 10, "a notice no longer logs");',
    'assert.ok(telemetry.exported.spans.every((span) => span.attributes["order.id"] === "o-9"), "a span lost its order id");',
    'assert.ok(telemetry.exported.logs.every((line) => line.attributes["order.id"] === "o-9"), "a log line lost its order id");',
    'assert.ok(!JSON.stringify(telemetry.exported).includes(email), "the customer\'s email address still reaches the telemetry");',
  ].join("\n"),
  solution: {
    "src/telemetry.js": TELEMETRY_JS.replace(
      "module.exports = {",
      [
        "// Keys that never leave the service, whatever writes them.",
        'const REDACTED_KEYS = ["customer.email"];',
        "",
        "function redact(record) {",
        "  for (const key of REDACTED_KEYS) {",
        "    delete record.attributes[key];",
        "  }",
        "",
        "  return record;",
        "}",
        "",
        "spanProcessors.push(redact);",
        "logProcessors.push(redact);",
        "",
        "module.exports = {",
      ].join("\n"),
    ),
    "test/redaction.test.js": [
      '"use strict";',
      "",
      'const test = require("node:test");',
      'const assert = require("node:assert");',
      'const telemetry = require("../src/telemetry");',
      "",
      'test("customer.email never leaves the service", () => {',
      "  telemetry.reset();",
      '  const span = telemetry.startSpan("a");',
      '  span.setAttribute("customer.email", "a@example.org");',
      "  span.end();",
      '  telemetry.logger.info("b", { "customer.email": "a@example.org" });',
      '  assert.ok(!JSON.stringify(telemetry.exported).includes("a@example.org"));',
      "});",
      "",
    ].join("\n"),
  },
  untouchedFiles: CALL_SITE_FILES,
  testNames: "customer.email",
};

/*
 * ---------------------------------------------------------------------------
 * 3. A secret in an exception's message: found from the exception's own
 *    frames, and the pull request says to rotate it.
 * ---------------------------------------------------------------------------
 */

const PAYMENTS_JS: string = [
  '"use strict";',
  "",
  'const gateway = require("./gateway");',
  "",
  "// Charges an order's card with the payment provider.",
  "function chargeCard(order, apiKey) {",
  "  const response = gateway.charge(apiKey, order.amountCents);",
  "",
  "  if (!response.ok) {",
  "    throw new Error(`Payment provider refused the charge for key ${apiKey}`);",
  "  }",
  "",
  "  return { charged: order.amountCents };",
  "}",
  "",
  "module.exports = { chargeCard };",
  "",
].join("\n");

const SECRET_IN_EXCEPTION: TelemetryLeakEvalCase = {
  id: "api-key-in-an-exception-message",
  title: "A refused charge throws with the provider's key in its message",
  serviceId: "5e000000-0000-4000-8000-000000000003",
  serviceName: "payments",
  files: {
    "package.json": PACKAGE_JSON("payments"),
    "src/gateway.js": [
      '"use strict";',
      "",
      "// The payment provider, as the service reaches it.",
      "function charge(apiKey, amountCents) {",
      "  return { ok: amountCents <= 100000 };",
      "}",
      "",
      "module.exports = { charge };",
      "",
    ].join("\n"),
    "src/payments.js": PAYMENTS_JS,
    "test/payments.test.js": [
      '"use strict";',
      "",
      'const test = require("node:test");',
      'const assert = require("node:assert");',
      'const { chargeCard } = require("../src/payments");',
      "",
      'test("a charge under the limit goes through", () => {',
      '  assert.deepStrictEqual(chargeCard({ amountCents: 500 }, "k"), { charged: 500 });',
      "});",
      "",
    ].join("\n"),
  },
  findings: [
    {
      findingId: "f1000000-0000-4000-8000-000000000005",
      issueId: "15000000-0000-4000-8000-000000000301",
      dataStoreId: "51000000-0000-4000-8000-000000000301",
      storeKind: DataStoreKind.TelemetryExceptions,
      checkId: SECRETS_IN_TELEMETRY_CHECK_ID,
      location: "message",
      dataTypeId: "stripe-secret-key",
      rows: [
        {
          recordTime: at(300),
          readFrames: JSON.stringify([
            {
              functionName: "chargeCard",
              fileName: "/usr/src/app/src/payments.js",
              lineNumber: lineOf(PAYMENTS_JS, "throw new Error"),
              columnNumber: 11,
              inApp: true,
            },
            {
              functionName: "Layer.handle",
              fileName: "/usr/src/app/node_modules/express/lib/router/layer.js",
              lineNumber: 95,
              columnNumber: 5,
              inApp: false,
            },
          ]),
          readExceptionType: "Error",
          readMessage: `Payment provider refused the charge for key ${fakeStripeLiveKey()}`,
        },
      ],
      leadsTo: [
        {
          file: "src/payments.js",
          line: lineOf(PAYMENTS_JS, "throw new Error"),
        },
      ],
      values: [fakeStripeLiveKey()],
    },
  ],
  expectStrategy: TelemetryLeakFixStrategy.CallSites,
  expect: [
    {
      path: "src/payments.js",
      mustMatch: ["throw new Error\\(", "gateway\\.charge\\("],
      mustNotMatch: ["key \\$\\{apiKey\\}"],
    },
  ],
  check: [
    'const { chargeCard } = load("src/payments.js");',
    'const key = ["sk", "live", "Fk7Qz2Lp9Xw4Rt6Hy3Nc8Vb5Jm1"].join("_");',
    "let thrown = null;",
    "try {",
    "  chargeCard({ amountCents: 200000 }, key);",
    "} catch (error) {",
    "  thrown = error;",
    "}",
    'assert.ok(thrown, "a refused charge no longer throws");',
    'assert.ok(!String(thrown.message).includes(key), "the key is still in the exception\'s message");',
    'assert.ok(!String(thrown.stack || "").includes(key), "the key is still in the exception\'s stack");',
    'assert.deepStrictEqual(chargeCard({ amountCents: 500 }, key), { charged: 500 }, "a charge under the limit no longer goes through");',
  ].join("\n"),
  solution: {
    "src/payments.js": PAYMENTS_JS.replace(
      "throw new Error(`Payment provider refused the charge for key ${apiKey}`);",
      'throw new Error("Payment provider refused the charge");',
    ),
  },
};

/*
 * ---------------------------------------------------------------------------
 * 4. A metric counted by the customer's email: found by the instrument's
 *    name, and the key the code writes.
 * ---------------------------------------------------------------------------
 */

const METRICS_JS: string = [
  '"use strict";',
  "",
  'const { meter } = require("./telemetry");',
  "",
  'const ordersPlaced = meter.createCounter("orders.placed");',
  "",
  "// Counts an order placed, by where it was placed.",
  "function countOrder(order) {",
  '  ordersPlaced.add(1, { "order.channel": order.channel, "user.email": order.email });',
  "}",
  "",
  "module.exports = { countOrder };",
  "",
].join("\n");

const METRIC_ATTRIBUTE: TelemetryLeakEvalCase = {
  id: "user-email-on-a-metric",
  title: "A counter counts orders by the customer's email",
  serviceId: "5e000000-0000-4000-8000-000000000004",
  serviceName: "storefront",
  files: {
    "package.json": PACKAGE_JSON("storefront"),
    "src/telemetry.js": TELEMETRY_JS,
    "src/metrics.js": METRICS_JS,
    "test/metrics.test.js": [
      '"use strict";',
      "",
      'const test = require("node:test");',
      'const assert = require("node:assert");',
      'const telemetry = require("../src/telemetry");',
      'const { countOrder } = require("../src/metrics");',
      "",
      'test("an order is counted by its channel", () => {',
      "  telemetry.reset();",
      '  countOrder({ channel: "web", email: "a@example.org" });',
      '  assert.strictEqual(telemetry.exported.metrics[0].attributes["order.channel"], "web");',
      "});",
      "",
    ].join("\n"),
  },
  findings: [
    {
      findingId: "f1000000-0000-4000-8000-000000000006",
      issueId: "15000000-0000-4000-8000-000000000401",
      dataStoreId: "51000000-0000-4000-8000-000000000401",
      storeKind: DataStoreKind.TelemetryMetrics,
      checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      location: "attributes.user.email",
      dataTypeId: "email-address",
      rows: [{ recordTime: at(400), readMetricName: "orders.placed" }],
      leadsTo: [
        {
          file: "src/metrics.js",
          line: lineOf(METRICS_JS, '"orders.placed"'),
        },
        { file: "src/metrics.js", line: lineOf(METRICS_JS, '"user.email"') },
      ],
      values: [],
    },
  ],
  expectStrategy: TelemetryLeakFixStrategy.CallSites,
  expect: [
    {
      path: "src/metrics.js",
      mustMatch: ['"order\\.channel"'],
      mustNotMatch: ['"user\\.email"\\s*:\\s*order\\.email'],
    },
  ],
  check: [
    'const telemetry = load("src/telemetry.js");',
    'const { countOrder } = load("src/metrics.js");',
    "telemetry.reset();",
    'countOrder({ channel: "web", email: "ada.l@example.com" });',
    'assert.strictEqual(telemetry.exported.metrics.length, 1, "an order is no longer counted");',
    'assert.strictEqual(telemetry.exported.metrics[0].attributes["order.channel"], "web", "the count lost its channel");',
    'assert.ok(!JSON.stringify(telemetry.exported).includes("ada.l@example.com"), "the email address still reaches the metric");',
  ].join("\n"),
  solution: {
    "src/metrics.js": METRICS_JS.replace(', "user.email": order.email', ""),
  },
};

/*
 * ---------------------------------------------------------------------------
 * 5. A log line with no code attributes: found by its template alone, its
 *    values masked, and two reads of it lined up.
 * ---------------------------------------------------------------------------
 */

const PASSWORDS_JS: string = [
  '"use strict";',
  "",
  'const { logger } = require("./telemetry");',
  "",
  "// Sends a password reset link.",
  "function requestReset(email, ip) {",
  "  logger.warn(`Password reset requested for ${email} from ${ip}`);",
  "",
  "  return { sent: true };",
  "}",
  "",
  "module.exports = { requestReset };",
  "",
].join("\n");

const TEMPLATE_ONLY: TelemetryLeakEvalCase = {
  id: "email-in-a-log-line-with-no-code-location",
  title:
    "A password reset logs the customer's email, from a logger that names no code location",
  serviceId: "5e000000-0000-4000-8000-000000000005",
  serviceName: "accounts",
  files: {
    "package.json": PACKAGE_JSON("accounts"),
    "src/telemetry.js": TELEMETRY_JS,
    "src/passwords.js": PASSWORDS_JS,
    "test/passwords.test.js": [
      '"use strict";',
      "",
      'const test = require("node:test");',
      'const assert = require("node:assert");',
      'const { requestReset } = require("../src/passwords");',
      "",
      'test("a reset link is sent", () => {',
      '  assert.deepStrictEqual(requestReset("a@example.org", "10.0.0.1"), { sent: true });',
      "});",
      "",
    ].join("\n"),
  },
  findings: [
    {
      findingId: "f1000000-0000-4000-8000-000000000007",
      issueId: "15000000-0000-4000-8000-000000000501",
      dataStoreId: "51000000-0000-4000-8000-000000000501",
      storeKind: DataStoreKind.TelemetryLogs,
      checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      location: "body",
      dataTypeId: "email-address",
      rows: [
        {
          recordTime: at(500),
          readScope: "accounts",
          readBody: "Password reset requested for ada@example.com from 10.1.2.3",
        },
        {
          recordTime: at(501),
          readScope: "accounts",
          readBody:
            "Password reset requested for li.wei@example.org from 192.168.7.20",
        },
      ],
      leadsTo: [
        {
          file: "src/passwords.js",
          line: lineOf(PASSWORDS_JS, "logger.warn"),
        },
      ],
      values: [
        "ada@example.com",
        "li.wei@example.org",
        "10.1.2.3",
        "192.168.7.20",
      ],
    },
  ],
  expectStrategy: TelemetryLeakFixStrategy.CallSites,
  expect: [
    {
      path: "src/passwords.js",
      mustMatch: ["logger\\.warn\\("],
      mustNotMatch: ["for \\$\\{email\\}"],
    },
  ],
  check: [
    'const telemetry = load("src/telemetry.js");',
    'const { requestReset } = load("src/passwords.js");',
    "telemetry.reset();",
    'assert.deepStrictEqual(requestReset("grace.h@example.com", "10.0.0.8"), { sent: true }, "a reset link is no longer sent");',
    'assert.strictEqual(telemetry.exported.logs.length, 1, "the reset is no longer logged");',
    'assert.ok(!JSON.stringify(telemetry.exported).includes("grace.h@example.com"), "the email address still reaches the log");',
  ].join("\n"),
  solution: {
    "src/passwords.js": PASSWORDS_JS.replace(
      "logger.warn(`Password reset requested for ${email} from ${ip}`);",
      "logger.warn(`Password reset requested from ${ip}`);",
    ),
  },
};

export const TELEMETRY_LEAK_EVAL_SET: ReadonlyArray<TelemetryLeakEvalCase> = [
  SPAN_AND_LOG,
  TWENTY_PLACES,
  SECRET_IN_EXCEPTION,
  METRIC_ATTRIBUTE,
  TEMPLATE_ONLY,
];

// The source a telemetry store's records are read from: what the locator reads a row as.
const SOURCE_OF_SIGNAL: Readonly<Record<TelemetryLeakSignal, TelemetrySampleSource>> =
  {
    [TelemetryLeakSignal.Logs]: TelemetrySampleSource.Logs,
    [TelemetryLeakSignal.Spans]: TelemetrySampleSource.Traces,
    [TelemetryLeakSignal.Exceptions]: TelemetrySampleSource.Exceptions,
    [TelemetryLeakSignal.AiCalls]: TelemetrySampleSource.AiConversations,
    [TelemetryLeakSignal.Metrics]: TelemetrySampleSource.Metrics,
  };

export interface LocatedTelemetryLeakEvalCase {
  group: TelemetryLeakRepositoryGroup;
  decision: TelemetryLeakFixDecision;
  startFiles: Array<string>;
  request: DataSecurityAiCodeRequest;
}

// A case's findings as leaks: each one's records read as the locator reads them.
export function readTelemetryLeakEvalLeaks(
  testCase: TelemetryLeakEvalCase,
): Array<TelemetryLeakToPlace> {
  const namer: DataTypeNamer = DataTypeNamer.withoutCustomTypes();

  return testCase.findings.map(
    (finding: RecordedTelemetryLeakFinding): TelemetryLeakToPlace => {
      const signal: TelemetryLeakSignal = getTelemetryLeakSignal(
        finding.storeKind,
      )!;
      const key: string | undefined = getScrubTarget(
        finding.storeKind,
        finding.location,
      )?.key;
      const places: Array<TelemetryLeakPlace> = readLeakPlaces({
        source: SOURCE_OF_SIGNAL[signal],
        rows: finding.rows,
        location: finding.location,
        templateOf: (text: string): string => {
          return buildTelemetryLeakTemplate(text, {
            nameOf: (dataTypeId: string): string => {
              return namer.nameOf(dataTypeId);
            },
          });
        },
      });

      return {
        issueId: finding.issueId,
        dataStoreId: finding.dataStoreId,
        checkId: finding.checkId,
        findingId: finding.findingId,
        signal,
        dataTypeId: finding.dataTypeId,
        dataTypeName: namer.nameOf(finding.dataTypeId),
        isSecret: finding.checkId === SECRETS_IN_TELEMETRY_CHECK_ID,
        location: finding.location,
        ...(key ? { key } : {}),
        isMaskedByScrubRule: finding.isMaskedByScrubRule === true,
        places,
      };
    },
  );
}

// The one repository a case's service is in: its files are its tree.
function repositoryOf(testCase: TelemetryLeakEvalCase): ResolvableRepository {
  return {
    id: "c0de0000-0000-4000-8000-000000000001",
    name: testCase.serviceName,
    organizationName: "acme",
    repositoryName: testCase.serviceName,
    mainBranchName: "main",
    gitHubAppInstallationId: null,
  };
}

// The request the builder makes from a case's leaks, placed and decided.
function requestOf(data: {
  testCase: TelemetryLeakEvalCase;
  folder: string | null;
  decision: TelemetryLeakFixDecision;
  startFiles: Array<string>;
}): DataSecurityAiCodeRequest {
  return buildTelemetryLeakFixRequest({
    serviceName: data.testCase.serviceName,
    folder: data.folder || undefined,
    strategy: data.decision.strategy,
    placeCount: data.decision.placeCount,
    leaks: data.decision.leaks,
    redactionKeys: data.decision.redactionKeys,
    redactionDataTypes: data.decision.redactionDataTypes,
    startFiles: data.startFiles,
  });
}

/*
 * A case's findings as the product would fix them: each finding's records
 * read as the locator reads them, placed in the case's repository by the
 * product's own chooser - its files are the only repository's tree -
 * decided, and handed to the builder.
 */
export async function locateTelemetryLeakEvalCase(
  testCase: TelemetryLeakEvalCase,
): Promise<LocatedTelemetryLeakEvalCase> {
  const leaks: Array<TelemetryLeakToPlace> =
    readTelemetryLeakEvalLeaks(testCase);
  const repository: ResolvableRepository = repositoryOf(testCase);
  const groups: Array<TelemetryLeakRepositoryGroup> =
    await chooseTelemetryLeakRepositories({
      leaks,
      serviceName: testCase.serviceName,
      repositories: [repository],
      getTreePaths: async (): Promise<Array<string>> => {
        return Object.keys(testCase.files);
      },
      getServiceFolder: async (): Promise<string | null> => {
        return null;
      },
    });
  const group: TelemetryLeakRepositoryGroup = groups[0]!;
  const decision: TelemetryLeakFixDecision = decideTelemetryLeakFix(
    group.leaks,
  );
  const startFiles: Array<string> = getTelemetryLeakStartFiles(decision.leaks);

  return {
    group,
    decision,
    startFiles,
    request: requestOf({
      testCase,
      folder: group.folder,
      decision,
      startFiles,
    }),
  };
}

/*
 * The same, at once, for what must be known when a module loads - the Data
 * Security eval's call and the code agent's benchmark's prompt: the case's
 * one repository needs no choosing, and each file a record names is the
 * one its tree holds (toRepositoryPath).
 */
export function buildTelemetryLeakEvalRequest(
  testCase: TelemetryLeakEvalCase,
): DataSecurityAiCodeRequest {
  const tree: Array<string> = Object.keys(testCase.files);
  const leaks: Array<TelemetryLeakToPlace> = readTelemetryLeakEvalLeaks(
    testCase,
  ).map((leak: TelemetryLeakToPlace): TelemetryLeakToPlace => {
    return {
      ...leak,
      places: leak.places.map((place: TelemetryLeakPlace): TelemetryLeakPlace => {
        return place.filePath
          ? {
              ...place,
              filePath: toRepositoryPath({
                filePath: place.filePath,
                tree,
                folder: null,
              }),
            }
          : place;
      }),
    };
  });
  const decision: TelemetryLeakFixDecision = decideTelemetryLeakFix(leaks);

  return requestOf({
    testCase,
    folder: null,
    decision,
    startFiles: getTelemetryLeakStartFiles(decision.leaks),
  });
}

/*
 * Where a place leads in a repository's files: its file and line when its
 * records name them; else the line its template's words are on, its
 * metric's name or its key - what the agent searches for. Null when
 * nothing of it is found.
 */
export function findPlaceInFiles(data: {
  place: TelemetryLeakPlace;
  key?: string | undefined;
  files: Record<string, string>;
}): { file: string; line: number } | null {
  const place: TelemetryLeakPlace = data.place;

  if (place.filePath && place.lineNumber !== undefined) {
    return data.files[place.filePath] !== undefined
      ? { file: place.filePath, line: place.lineNumber }
      : null;
  }

  const finders: Array<(line: string) => boolean> = [];

  if (place.template) {
    // The template's literal words, in order, with anything between them.
    const words: Array<string> = place.template
      .split(/<[^<>]*>/)
      .map((part: string): string => {
        return part.trim();
      })
      .filter((part: string): boolean => {
        return /[A-Za-z]{2,}/.test(part);
      });
    const pattern: RegExp = new RegExp(
      words
        .map((word: string): string => {
          return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join(".*"),
    );

    finders.push((line: string): boolean => {
      return words.length > 0 && pattern.test(line);
    });
  }

  if (place.metricName) {
    const name: string = `"${place.metricName}"`;

    finders.push((line: string): boolean => {
      return line.includes(name);
    });
  }

  if (data.key) {
    const key: string = `"${data.key}"`;

    finders.push((line: string): boolean => {
      return line.includes(key);
    });
  }

  for (const finder of finders) {
    for (const [file, text] of Object.entries(data.files)) {
      if (!file.startsWith("src/")) {
        continue;
      }

      const index: number = text.split("\n").findIndex(finder);

      if (index >= 0) {
        return { file, line: index + 1 };
      }
    }
  }

  return null;
}
