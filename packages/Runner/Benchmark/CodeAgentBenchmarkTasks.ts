import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The code agent benchmark's tasks (issue #6531): the work customers hand
 * the Code agent, each in a repository of its own - a bug behind an
 * exception in a 2,000-line file, a failing test, a change across several
 * files, a repository whose test suite is slow - and a check that tells a
 * fixed repository from an unfixed one.
 *
 * Every repository is written out here, in Node.js with its own test
 * runner (`node --test`), so a task runs offline, on any machine with Node,
 * and the same every time. The check is never in the repository: the agent
 * cannot read it, or change it. Each task carries the fix a person would
 * make (`solve`), so the tests prove its check fails before and passes
 * after (Tests/Benchmark).
 */

export enum CodeAgentBenchmarkShape {
  LongFile = "A bug in a long file",
  FailingTest = "A failing test",
  ManyFiles = "A change across files",
  SlowTests = "A slow test suite",
}

export interface CodeAgentBenchmarkCheck {
  passed: boolean;
  // What failed, for the report: the check's own words, kept short.
  detail: string;
}

export interface CodeAgentBenchmarkTask {
  id: string;
  title: string;
  shape: CodeAgentBenchmarkShape;
  // The repository before the fix: path to content.
  files: () => Record<string, string>;
  // What the person asks, as Code or an exception's Fix with AI puts it.
  prompt: string;
  // Whether the repository at `repositoryPath` is fixed.
  check: (repositoryPath: string) => Promise<CodeAgentBenchmarkCheck>;
  // The fix a person would make, written into the repository.
  solve: (repositoryPath: string) => void;
}

// How long a check's own test run may take.
const CHECK_TIMEOUT_MS: number = 5 * 60 * 1000;

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
 * Runs `node` with `args` in `cwd`: its exit code and the end of what it
 * printed. A run that times out is a failure.
 */
export function runNode(
  args: Array<string>,
  cwd: string,
): Promise<{ exitCode: number; output: string }> {
  return new Promise(
    (resolve: (result: { exitCode: number; output: string }) => void) => {
      execFile(
        process.execPath,
        args,
        {
          cwd,
          timeout: CHECK_TIMEOUT_MS,
          maxBuffer: 32 * 1024 * 1024,
          env: { ...process.env, CI: "true", NODE_OPTIONS: "" },
        },
        (error: Error | null, stdout: string, stderr: string) => {
          const output: string = `${stdout}\n${stderr}`.trim();
          const code: unknown = (error as { code?: unknown } | null)?.code;

          resolve({
            exitCode: error ? (typeof code === "number" ? code : 1) : 0,
            output: output.length > 2000 ? output.slice(-2000) : output,
          });
        },
      );
    },
  );
}

/*
 * Runs a check script - never written into the repository - against the
 * repository: it requires the repository's modules by their full path.
 */
export async function runHiddenCheck(
  repositoryPath: string,
  script: string,
): Promise<CodeAgentBenchmarkCheck> {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-code-benchmark-check-"),
  );
  const file: string = path.join(directory, "check.js");

  try {
    fs.writeFileSync(
      file,
      `const REPOSITORY = ${JSON.stringify(repositoryPath)};\nconst path = require("path");\nconst assert = require("assert");\nconst load = (relative) => {\n  const full = path.join(REPOSITORY, relative);\n  delete require.cache[require.resolve(full)];\n  return require(full);\n};\n${script}\n`,
    );

    const result: { exitCode: number; output: string } = await runNode(
      [file],
      repositoryPath,
    );

    return {
      passed: result.exitCode === 0,
      detail: result.exitCode === 0 ? "" : lastLines(result.output),
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// Whether the repository's own tests pass.
export async function runRepositoryTests(
  repositoryPath: string,
): Promise<CodeAgentBenchmarkCheck> {
  const result: { exitCode: number; output: string } = await runNode(
    ["--test", "test/"],
    repositoryPath,
  );

  return {
    passed: result.exitCode === 0,
    detail:
      result.exitCode === 0
        ? ""
        : `npm test failed: ${lastLines(result.output)}`,
  };
}

// The files of `original` the repository no longer holds as they were.
export function changedFiles(
  repositoryPath: string,
  original: Record<string, string>,
  paths: Array<string>,
): Array<string> {
  return paths.filter((relative: string): boolean => {
    const full: string = path.join(repositoryPath, relative);

    return (
      !fs.existsSync(full) ||
      fs.readFileSync(full, "utf8") !== original[relative]
    );
  });
}

// Every check's verdict at once: passed only when all passed.
export function allOf(
  checks: Array<CodeAgentBenchmarkCheck>,
): CodeAgentBenchmarkCheck {
  const failed: Array<CodeAgentBenchmarkCheck> = checks.filter(
    (check: CodeAgentBenchmarkCheck): boolean => {
      return !check.passed;
    },
  );

  return {
    passed: failed.length === 0,
    detail: failed
      .map((check: CodeAgentBenchmarkCheck): string => {
        return check.detail;
      })
      .join(" | "),
  };
}

function lastLines(output: string): string {
  const lines: Array<string> = output
    .split("\n")
    .map((line: string): string => {
      return line.trim();
    })
    .filter(Boolean);

  return lines.slice(-6).join(" / ").slice(-600);
}

function rewrite(
  repositoryPath: string,
  relative: string,
  from: string,
  to: string,
): void {
  const full: string = path.join(repositoryPath, relative);
  const text: string = fs.readFileSync(full, "utf8");

  if (!text.includes(from)) {
    throw new Error(`${relative} no longer holds the text the fix replaces.`);
  }

  fs.writeFileSync(full, text.replace(from, to));
}

/*
 * ---------------------------------------------------------------------------
 * A bug in a 2,000-line file: an exception's stack trace points at the line
 * that throws, and the cause is a function further up - a discount of 15
 * read as 15 times the total, not 15 percent of it.
 * ---------------------------------------------------------------------------
 */

const CURRENCIES: Array<string> = [
  "usd",
  "eur",
  "gbp",
  "jpy",
  "inr",
  "brl",
  "cad",
  "aud",
  "chf",
  "sek",
  "nok",
  "dkk",
  "pln",
  "mxn",
  "zar",
  "sgd",
];

// Formatters a currency: enough of them to make the file 2,000 lines long.
const FORMAT_VARIANTS: number = 14;

const BUGGY_DISCOUNT: string =
  "  return totalCents - Math.round(totalCents * percentOff);";
const FIXED_DISCOUNT: string =
  "  return totalCents - Math.round((totalCents * percentOff) / 100);";

interface BillingFile {
  text: string;
  // The lines the stack trace names.
  throwLine: number;
  callLine: number;
}

function billingFile(): BillingFile {
  const lines: Array<string> = [
    '"use strict";',
    "",
    "/*",
    " * Billing: invoices, line items, discounts and the money formats of",
    " * every currency the shop sells in.",
    " */",
    "",
  ];

  // Formatting helpers, one set a currency: most of the file.
  for (const currency of CURRENCIES) {
    for (let variant: number = 0; variant < FORMAT_VARIANTS; variant++) {
      const name: string = `format_${currency}_${variant}`;

      lines.push(
        `// Formats an amount in ${currency.toUpperCase()}, style ${variant}.`,
        `function ${name}(cents) {`,
        "  const whole = Math.floor(Math.abs(cents) / 100);",
        '  const part = String(Math.abs(cents) % 100).padStart(2, "0");',
        `  const sign = cents < 0 ? "-" : "";`,
        `  return \`\${sign}${currency.toUpperCase()} \${whole}.\${part} (${variant})\`;`,
        "}",
        "",
      );
    }
  }

  lines.push(
    "const FORMATTERS = {",
    ...CURRENCIES.flatMap((currency: string): Array<string> => {
      return Array.from(
        { length: FORMAT_VARIANTS },
        (_: unknown, variant: number) => {
          return `  format_${currency}_${variant},`;
        },
      );
    }),
    "};",
    "",
    "// A line's total: its quantity times its unit price.",
    "function lineTotalCents(item) {",
    "  return Math.round(Number(item.quantity) * Number(item.unitCents));",
    "}",
    "",
    "function subtotalCents(items) {",
    "  return items.reduce((sum, item) => {",
    "    return sum + lineTotalCents(item);",
    "  }, 0);",
    "}",
    "",
    "/*",
    " * A discount code's percentage off, applied to a total: 15 means",
    " * fifteen percent.",
    " */",
    "function applyDiscount(totalCents, percentOff) {",
    BUGGY_DISCOUNT,
    "}",
    "",
    "function assertNonNegative(cents) {",
    "  if (cents < 0) {",
  );

  const throwLine: number = lines.length + 1;

  lines.push(
    "    throw new Error(`Invoice total must not be negative (got ${cents})`);",
    "  }",
    "",
    "  return cents;",
    "}",
    "",
    "function createInvoice(order) {",
    "  const subtotal = subtotalCents(order.items);",
    "  const total = order.discountPercent",
    "    ? applyDiscount(subtotal, order.discountPercent)",
    "    : subtotal;",
    "",
    "  return {",
    "    subtotalCents: subtotal,",
  );

  const callLine: number = lines.length + 1;

  lines.push(
    "    totalCents: assertNonNegative(total),",
    '    currency: order.currency || "USD",',
    "  };",
    "}",
    "",
    "module.exports = {",
    "  FORMATTERS,",
    "  applyDiscount,",
    "  createInvoice,",
    "  lineTotalCents,",
    "  subtotalCents,",
    "};",
    "",
  );

  return { text: lines.join("\n"), throwLine, callLine };
}

const LONG_FILE_BUG: CodeAgentBenchmarkTask = {
  id: "discount-bug-in-long-file",
  title: "A discount code makes an invoice negative",
  shape: CodeAgentBenchmarkShape.LongFile,
  files: (): Record<string, string> => {
    return {
      "package.json": PACKAGE_JSON("billing-service"),
      "src/billing.js": billingFile().text,
      "src/server.js": [
        '"use strict";',
        "",
        'const { createInvoice } = require("./billing");',
        "",
        "// Checkout: the order a customer placed, as its invoice.",
        "function handleCheckout(order) {",
        "  return createInvoice(order);",
        "}",
        "",
        "module.exports = { handleCheckout };",
        "",
      ].join("\n"),
      "test/billing.test.js": [
        '"use strict";',
        "",
        'const test = require("node:test");',
        'const assert = require("node:assert");',
        'const { subtotalCents } = require("../src/billing");',
        "",
        'test("a subtotal adds up every line", () => {',
        "  assert.strictEqual(",
        "    subtotalCents([",
        "      { quantity: 2, unitCents: 1000 },",
        "      { quantity: 1, unitCents: 250 },",
        "    ]),",
        "    2250,",
        "  );",
        "});",
        "",
      ].join("\n"),
    };
  },
  prompt: ((): string => {
    const file: BillingFile = billingFile();

    return [
      "Fix the bug behind this exception, thrown in production when a customer checked out with the discount code SAVE15 (15% off). The order was two items of 1,000 cents each.",
      "",
      "Error: Invoice total must not be negative (got -28000)",
      `    at assertNonNegative (src/billing.js:${file.throwLine}:11)`,
      `    at createInvoice (src/billing.js:${file.callLine}:17)`,
      "    at handleCheckout (src/server.js:7:10)",
    ].join("\n");
  })(),
  check: async (repositoryPath: string): Promise<CodeAgentBenchmarkCheck> => {
    return allOf([
      await runHiddenCheck(
        repositoryPath,
        [
          'const billing = load("src/billing.js");',
          "const invoice = billing.createInvoice({ items: [{ quantity: 2, unitCents: 1000 }], discountPercent: 15 });",
          'assert.strictEqual(invoice.totalCents, 1700, "15% off 2,000 cents is 1,700");',
          "assert.strictEqual(billing.applyDiscount(10000, 50), 5000);",
          "assert.strictEqual(billing.applyDiscount(999, 0), 999);",
          "assert.strictEqual(billing.createInvoice({ items: [{ quantity: 3, unitCents: 100 }] }).totalCents, 300);",
          'assert.strictEqual(billing.FORMATTERS.format_eur_3(-1234), "-EUR 12.34 (3)");',
        ].join("\n"),
      ),
      await runRepositoryTests(repositoryPath),
    ]);
  },
  solve: (repositoryPath: string): void => {
    rewrite(repositoryPath, "src/billing.js", BUGGY_DISCOUNT, FIXED_DISCOUNT);
  },
};

/*
 * ---------------------------------------------------------------------------
 * A failing test: CI is red on two cases of a slug helper, and the fix
 * belongs in the code, never in the test.
 * ---------------------------------------------------------------------------
 */

const SLUGIFY_TEST: string = [
  '"use strict";',
  "",
  'const test = require("node:test");',
  'const assert = require("node:assert");',
  'const { slugify } = require("../src/slugify");',
  "",
  'test("lower-cases and joins words with dashes", () => {',
  '  assert.strictEqual(slugify("Hello World"), "hello-world");',
  "});",
  "",
  'test("drops punctuation at the ends", () => {',
  '  assert.strictEqual(slugify("  Hello, World!  "), "hello-world");',
  "});",
  "",
  'test("keeps the letters of accented words", () => {',
  '  assert.strictEqual(slugify("Crème brûlée"), "creme-brulee");',
  "});",
  "",
].join("\n");

const BUGGY_SLUGIFY: string =
  '  return String(title).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");';

const FAILING_TEST: CodeAgentBenchmarkTask = {
  id: "failing-slug-tests",
  title: "Two slug tests fail on main",
  shape: CodeAgentBenchmarkShape.FailingTest,
  files: (): Record<string, string> => {
    return {
      "package.json": PACKAGE_JSON("blog"),
      "src/slugify.js": [
        '"use strict";',
        "",
        "// A post's title as the part of its URL that names it.",
        "function slugify(title) {",
        BUGGY_SLUGIFY,
        "}",
        "",
        "module.exports = { slugify };",
        "",
      ].join("\n"),
      "test/slugify.test.js": SLUGIFY_TEST,
    };
  },
  prompt:
    "CI fails on main: `npm test` reports failing tests in test/slugify.test.js. Fix the code so the tests pass. Do not change the tests.",
  check: async (repositoryPath: string): Promise<CodeAgentBenchmarkCheck> => {
    const original: Record<string, string> = FAILING_TEST.files();
    const changedTests: Array<string> = changedFiles(repositoryPath, original, [
      "test/slugify.test.js",
    ]);

    return allOf([
      {
        passed: changedTests.length === 0,
        detail: `the test was changed: ${changedTests.join(", ")}`,
      },
      await runRepositoryTests(repositoryPath),
      await runHiddenCheck(
        repositoryPath,
        [
          'const { slugify } = load("src/slugify.js");',
          'assert.strictEqual(slugify("Ünïcödé — Test"), "unicode-test");',
          'assert.strictEqual(slugify("--A--B--"), "a-b");',
          'assert.strictEqual(slugify("Ça va?"), "ca-va");',
        ].join("\n"),
      ),
    ]);
  },
  solve: (repositoryPath: string): void => {
    rewrite(
      repositoryPath,
      "src/slugify.js",
      BUGGY_SLUGIFY,
      [
        "  return String(title)",
        '    .normalize("NFKD")',
        '    .replace(/[\\u0300-\\u036f]/g, "")',
        "    .trim()",
        "    .toLowerCase()",
        '    .replace(/[^a-z0-9]+/g, "-")',
        '    .replace(/^-+|-+$/g, "");',
      ].join("\n"),
    );
  },
};

/*
 * ---------------------------------------------------------------------------
 * A change across several files: the users API now says displayName, and
 * every page that greets a user still reads fullName, so it says
 * "undefined". The fix is in four places; a decoy already reads the new
 * name.
 * ---------------------------------------------------------------------------
 */

const READERS: Array<{ file: string; from: string }> = [
  {
    file: "src/views/profile.js",
    from: "<h1>${user.fullName}</h1>",
  },
  {
    file: "src/views/header.js",
    from: "Signed in as ${user.fullName}",
  },
  {
    file: "src/email/welcome.js",
    from: "Welcome, ${user.fullName}!",
  },
  {
    file: "src/email/digest.js",
    from: "Your weekly digest, ${user.fullName}",
  },
];

const MANY_FILES: CodeAgentBenchmarkTask = {
  id: "rename-across-files",
  title: "Every greeting says undefined after an API rename",
  shape: CodeAgentBenchmarkShape.ManyFiles,
  files: (): Record<string, string> => {
    return {
      "package.json": PACKAGE_JSON("accounts-web"),
      "src/api/users.js": [
        '"use strict";',
        "",
        "/*",
        " * The users API. Since v2 a user's name is displayName: fullName was",
        " * removed.",
        " */",
        "function getUser(id) {",
        "  return {",
        "    id,",
        "    displayName: `User ${id}`,",
        "    email: `user${id}@example.com`,",
        "  };",
        "}",
        "",
        "module.exports = { getUser };",
        "",
      ].join("\n"),
      "src/views/profile.js": [
        '"use strict";',
        "",
        "function renderProfile(user) {",
        "  return `<h1>${user.fullName}</h1><p>${user.email}</p>`;",
        "}",
        "",
        "module.exports = { renderProfile };",
        "",
      ].join("\n"),
      "src/views/header.js": [
        '"use strict";',
        "",
        "function renderHeader(user) {",
        "  return `<nav>Signed in as ${user.fullName}</nav>`;",
        "}",
        "",
        "module.exports = { renderHeader };",
        "",
      ].join("\n"),
      "src/views/settings.js": [
        '"use strict";',
        "",
        "function renderSettings(user) {",
        "  return `<h2>Settings for ${user.displayName}</h2>`;",
        "}",
        "",
        "module.exports = { renderSettings };",
        "",
      ].join("\n"),
      "src/email/welcome.js": [
        '"use strict";',
        "",
        "function welcomeEmail(user) {",
        "  return {",
        "    to: user.email,",
        "    subject: `Welcome, ${user.fullName}!`,",
        '    body: "Thanks for signing up.",',
        "  };",
        "}",
        "",
        "module.exports = { welcomeEmail };",
        "",
      ].join("\n"),
      "src/email/digest.js": [
        '"use strict";',
        "",
        "function digestEmail(user, posts) {",
        "  return {",
        "    to: user.email,",
        "    subject: `Your weekly digest, ${user.fullName}`,",
        '    body: posts.join("\\n"),',
        "  };",
        "}",
        "",
        "module.exports = { digestEmail };",
        "",
      ].join("\n"),
      "test/users.test.js": [
        '"use strict";',
        "",
        'const test = require("node:test");',
        'const assert = require("node:assert");',
        'const { getUser } = require("../src/api/users");',
        "",
        'test("a user has a display name", () => {',
        '  assert.strictEqual(getUser(7).displayName, "User 7");',
        "});",
        "",
      ].join("\n"),
    };
  },
  prompt:
    'Since the users API returns displayName instead of fullName, every page and email that greets a user says "undefined": the profile page, the header, the welcome email and the weekly digest. Make them use the user\'s display name again.',
  check: async (repositoryPath: string): Promise<CodeAgentBenchmarkCheck> => {
    const stillFullName: Array<string> = READERS.map(
      (reader: { file: string }): string => {
        return reader.file;
      },
    ).filter((relative: string): boolean => {
      const full: string = path.join(repositoryPath, relative);
      return (
        !fs.existsSync(full) ||
        fs.readFileSync(full, "utf8").includes("fullName")
      );
    });

    return allOf([
      {
        passed: stillFullName.length === 0,
        detail: `still reads fullName: ${stillFullName.join(", ")}`,
      },
      await runHiddenCheck(
        repositoryPath,
        [
          'const user = load("src/api/users.js").getUser(7);',
          'const profile = load("src/views/profile.js").renderProfile(user);',
          'assert.ok(profile.includes("<h1>User 7</h1>"), profile);',
          'assert.ok(load("src/views/header.js").renderHeader(user).includes("Signed in as User 7"));',
          'assert.strictEqual(load("src/email/welcome.js").welcomeEmail(user).subject, "Welcome, User 7!");',
          'assert.strictEqual(load("src/email/digest.js").digestEmail(user, ["a"]).subject, "Your weekly digest, User 7");',
          'assert.strictEqual(load("src/views/settings.js").renderSettings(user), "<h2>Settings for User 7</h2>");',
        ].join("\n"),
      ),
      await runRepositoryTests(repositoryPath),
    ]);
  },
  solve: (repositoryPath: string): void => {
    for (const reader of READERS) {
      rewrite(
        repositoryPath,
        reader.file,
        reader.from,
        reader.from.replace("fullName", "displayName"),
      );
    }
  },
};

/*
 * ---------------------------------------------------------------------------
 * A slow test suite: the nightly integration suite takes about two and a
 * half minutes - longer than a command gets unless the agent asks for more
 * - and catches a job that gives up one attempt too early.
 * ---------------------------------------------------------------------------
 */

// The suite's waits: 30 tests of 5 seconds, about two and a half minutes.
export const SLOW_SUITE_TESTS: number = 30;
export const SLOW_SUITE_WAIT_MS: number = 5_000;

const BUGGY_ATTEMPTS: string =
  "  for (let attempt = 1; attempt < maxAttempts; attempt++) {";
const FIXED_ATTEMPTS: string =
  "  for (let attempt = 1; attempt <= maxAttempts; attempt++) {";

function slowSuite(waitMs: number): string {
  const lines: Array<string> = [
    '"use strict";',
    "",
    'const test = require("node:test");',
    'const assert = require("node:assert");',
    'const { processWithRetries } = require("../src/retryQueue");',
    "",
    "// The queue's broker is slow to settle between jobs: each test waits for it.",
    "function settle() {",
    "  return new Promise((resolve) => {",
    `    setTimeout(resolve, ${waitMs});`,
    "  });",
    "}",
    "",
    "function failingTimes(times) {",
    "  let calls = 0;",
    "  return async () => {",
    "    calls++;",
    "    if (calls <= times) {",
    '      throw new Error("broker busy");',
    "    }",
    '    return "done";',
    "  };",
    "}",
    "",
  ];

  for (let index: number = 0; index < SLOW_SUITE_TESTS - 1; index++) {
    lines.push(
      `test("job ${index + 1} that succeeds at once is done", async () => {`,
      "  await settle();",
      `  assert.strictEqual(await processWithRetries({ id: ${index + 1} }, failingTimes(0), 3), "done");`,
      "});",
      "",
    );
  }

  lines.push(
    'test("a job that succeeds on its last attempt is done", async () => {',
    "  await settle();",
    '  assert.strictEqual(await processWithRetries({ id: 99 }, failingTimes(2), 3), "done");',
    "});",
    "",
  );

  return lines.join("\n");
}

const SLOW_TESTS: CodeAgentBenchmarkTask = {
  id: "slow-suite-retry-bug",
  title: "The nightly suite catches a job given up too early",
  shape: CodeAgentBenchmarkShape.SlowTests,
  files: (): Record<string, string> => {
    return {
      "package.json": PACKAGE_JSON("job-queue"),
      "src/retryQueue.js": [
        '"use strict";',
        "",
        "/*",
        " * Runs a job, trying it again when it fails: at most maxAttempts",
        " * times in all.",
        " */",
        "async function processWithRetries(job, handler, maxAttempts) {",
        "  let lastError = null;",
        "",
        BUGGY_ATTEMPTS,
        "    try {",
        "      return await handler(job);",
        "    } catch (error) {",
        "      lastError = error;",
        "    }",
        "  }",
        "",
        "  throw lastError || new Error(`job ${job.id} was never attempted`);",
        "}",
        "",
        "module.exports = { processWithRetries };",
        "",
      ].join("\n"),
      "test/retryQueue.test.js": slowSuite(SLOW_SUITE_WAIT_MS),
    };
  },
  prompt:
    "The nightly integration suite (`npm test`, about two and a half minutes) fails in test/retryQueue.test.js. Find and fix the bug it catches.",
  check: async (repositoryPath: string): Promise<CodeAgentBenchmarkCheck> => {
    const original: Record<string, string> = SLOW_TESTS.files();
    const changedTests: Array<string> = changedFiles(repositoryPath, original, [
      "test/retryQueue.test.js",
    ]);

    return allOf([
      {
        passed: changedTests.length === 0,
        detail: `the suite was changed: ${changedTests.join(", ")}`,
      },
      // The suite's own cases, without its waits.
      await runHiddenCheck(
        repositoryPath,
        [
          'const { processWithRetries } = load("src/retryQueue.js");',
          'const failingTimes = (times) => { let calls = 0; return async () => { calls++; if (calls <= times) { throw new Error("busy"); } return "done"; }; };',
          "(async () => {",
          '  assert.strictEqual(await processWithRetries({ id: 1 }, failingTimes(0), 3), "done");',
          '  assert.strictEqual(await processWithRetries({ id: 2 }, failingTimes(2), 3), "done");',
          "  await assert.rejects(processWithRetries({ id: 3 }, failingTimes(3), 3), /busy/);",
          "})().catch((error) => { console.error(error); process.exit(1); });",
        ].join("\n"),
      ),
    ]);
  },
  solve: (repositoryPath: string): void => {
    rewrite(
      repositoryPath,
      "src/retryQueue.js",
      BUGGY_ATTEMPTS,
      FIXED_ATTEMPTS,
    );
  },
};

export const CODE_AGENT_BENCHMARK_TASKS: ReadonlyArray<CodeAgentBenchmarkTask> =
  [LONG_FILE_BUG, FAILING_TEST, MANY_FILES, SLOW_TESTS];

// The slow suite as a test writes it, with waits short enough to run.
export function slowSuiteWith(waitMs: number): string {
  return slowSuite(waitMs);
}
