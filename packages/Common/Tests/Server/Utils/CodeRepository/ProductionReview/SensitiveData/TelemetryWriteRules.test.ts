import { SensitiveDataCandidate } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataCandidate";
import { SensitiveNameMatcher } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataNames";
import { readPatchLines } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataPatch";
import {
  findTelemetryWrites,
  getSink,
  withoutEntry,
} from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/TelemetryWriteRules";
import {
  SensitiveDataLeakKind,
  SensitiveDataSink,
} from "../../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import DataSensitivity from "../../../../../../Types/DataSecurity/DataSensitivity";
import { fastestRun, FastestRun } from "../../../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A CHANGE WRITES TO TELEMETRY (#10376): a log call, a span's
 * attribute, a metric's label and a prompt to an AI provider, in each
 * language a service is written in - read for the names they are handed
 * that the catalog's hints point at, each a point at its line, with the
 * fix and, where the line allows, the line without it.
 */

const matcher: SensitiveNameMatcher = new SensitiveNameMatcher();

// The points of a file all of whose lines the change adds.
function writesIn(
  path: string,
  lines: Array<string>,
): Array<SensitiveDataCandidate> {
  return findTelemetryWrites({
    path,
    lines: readPatchLines(
      [
        `@@ -0,0 +1,${lines.length} @@`,
        ...lines.map((line: string): string => {
          return `+${line}`;
        }),
      ].join("\n"),
    ),
    matcher,
  });
}

function subjectsIn(path: string, lines: Array<string>): Array<string> {
  return writesIn(path, lines).map((point: SensitiveDataCandidate): string => {
    return point.subject;
  });
}

function onlyPoint(path: string, lines: Array<string>): SensitiveDataCandidate {
  const points: Array<SensitiveDataCandidate> = writesIn(path, lines);

  expect(points).toHaveLength(1);

  return points[0]!;
}

describe("a log call", () => {
  test('logger.info("signup", { email }): an email address, its line, its fix and the line without it', () => {
    const point: SensitiveDataCandidate = onlyPoint("src/signup.ts", [
      "export async function signup(email: string): Promise<void> {",
      '  logger.info("signup", { email });',
      "}",
    ]);

    expect(point).toMatchObject({
      kind: SensitiveDataLeakKind.Telemetry,
      checkId: "sensitive-data-in-telemetry",
      sink: SensitiveDataSink.Log,
      path: "src/signup.ts",
      line: 2,
      subject: "email",
      where: "logger.info",
      sensitivity: DataSensitivity.Confidential,
      isBlocking: false,
      location: "attributes.email",
      text: "Writes an email address to a log: `email`, in `logger.info`.",
      fix: "Leave `email` out, or write a hash of it when you need to tell values apart.",
      suggestion: {
        startLine: 2,
        endLine: 2,
        original: ['  logger.info("signup", { email });'],
        replacement: ['  logger.info("signup");'],
        isByAi: false,
      },
    });
  });

  test("a key names what it writes, and the line keeps the other entries", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/signup.js", [
      "logger.debug({ email: user.email, plan: user.plan });",
    ]);

    expect(point.subject).toBe("email");
    expect(point.suggestion!.replacement).toEqual([
      "logger.debug({ plan: user.plan });",
    ]);
  });

  test("a value in the message is the log's body, with no change to suggest", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/signup.ts", [
      "console.log(`signup ${user.email}`);",
    ]);

    expect(point.subject).toBe("user.email");
    expect(point.location).toBe("body");
    expect(point.suggestion).toBeUndefined();
  });

  test("a password is a secret: its own check, and it can fail the check", () => {
    const point: SensitiveDataCandidate = onlyPoint("api/routes/login.js", [
      'console.error("login failed", { username, password });',
    ]);

    expect(point).toMatchObject({
      checkId: "secrets-in-telemetry",
      subject: "password",
      sensitivity: DataSensitivity.Restricted,
      isBlocking: true,
      fix: "Leave `password` out: everyone who reads the telemetry could read the secret.",
    });
  });

  test("Restricted personal data can fail the check too", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/applicant.ts", [
      'logger.warn("applicant", { ssn: applicant.ssn });',
    ]);

    expect(point.checkId).toBe("sensitive-data-in-telemetry");
    expect(point.sensitivity).toBe(DataSensitivity.Restricted);
    expect(point.isBlocking).toBe(true);
  });

  test.each([
    [
      "Python, %-style",
      "app/signup.py",
      ['logger.info("signup %s", email)'],
      ["email"],
    ],
    [
      "Python, f-string",
      "app/signup.py",
      ['log.info(f"signup {user.email}")'],
      ["user.email"],
    ],
    [
      "Python, keyword",
      "app/signup.py",
      ['logger.info("signup", extra={"email": email})'],
      ["email"],
    ],
    [
      "Ruby, no parentheses",
      "app/models/user.rb",
      ['Rails.logger.info "reset #{reset_token}"'],
      ["reset_token"],
    ],
    [
      "Go",
      "pkg/auth/login.go",
      ['log.Printf("login %s %s", user, password)'],
      ["password"],
    ],
    [
      "Go, structured",
      "pkg/auth/login.go",
      ['logger.Info("signup", "email", email)'],
      ["email"],
    ],
    // A getter is read as the field it gets.
    [
      "Java",
      "src/main/java/Signup.java",
      ['logger.info("signup {}", customer.getEmail());'],
      ["customer.email"],
    ],
    [
      "C#",
      "Signup.cs",
      ['_logger.LogInformation($"Signup {user.Email}");'],
      ["user.Email"],
    ],
    ["Kotlin", "Signup.kt", ['log.info("signup $email")'], ["email"]],
    [
      "PHP",
      "src/Signup.php",
      ['$logger->info("signup {$user->email}");'],
      ["user.email"],
    ],
    ["Rust", "src/signup.rs", ['info!("signup {}", email);'], ["email"]],
    ["Swift", "Signup.swift", ['logger.info("signup \\(email)")'], ["email"]],
  ])(
    "%s",
    (
      _language: string,
      path: string,
      lines: Array<string>,
      subjects: Array<string>,
    ) => {
      expect(subjectsIn(path, lines)).toEqual(subjects);
    },
  );

  test("a call that spans lines is read to its end", () => {
    expect(
      subjectsIn("src/signup.ts", [
        "logger.info(",
        '  "signup",',
        "  {",
        "    plan,",
        "    email,",
        "  },",
        ");",
      ]),
    ).toEqual(["email"]);
  });
});

describe("what is no leak", () => {
  test.each([
    ["an id", ['logger.info("signup", { userId });']],
    ["a name about the data", ['logger.info("sent", { emailTemplate });']],
    ["a hash of it", ['logger.info("signup", { email: hash(email) });']],
    ["a masked value", ['logger.info("signup", { email: maskEmail(email) });']],
    ["a count", ['logger.info("sent", { emailCount: emails.length });']],
    ["a yes or no", ['logger.info("signup", { hasEmail: Boolean(email) });']],
    ["a message alone", ['logger.info("Sending the password reset email");']],
    [
      "a model's token counts",
      ['logger.info("usage", { promptTokens, completionTokens });'],
    ],
    ["a literal", ['logger.info("signup", { email: null });']],
    [
      "no sink",
      ["dialog.open(email);", "catalog.add(email);", "emails.push(email);"],
    ],
    [
      "a key that names a field, its value another thing",
      ['logger.info("bounce", { email: bounce.status });'],
    ],
  ])("%s", (_what: string, lines: Array<string>) => {
    expect(writesIn("src/signup.ts", lines)).toEqual([]);
  });

  test("a line the change only shows, or removes, is not its own", () => {
    expect(
      findTelemetryWrites({
        path: "src/signup.ts",
        lines: readPatchLines(
          [
            "@@ -10,3 +10,3 @@",
            ' logger.info("signup", { email });',
            '-logger.info("plan", { plan, email });',
            '+logger.info("plan", { plan });',
          ].join("\n"),
        ),
        matcher,
      }),
    ).toEqual([]);
  });

  test("a line marked not sensitive, or under a comment that marks it", () => {
    expect(
      writesIn("src/signup.ts", [
        'logger.info("signup", { email }); // oneuptime:not-sensitive',
        "// oneuptime:not-sensitive: the address is the support inbox's",
        'logger.info("support", { email: SUPPORT_EMAIL });',
      ]),
    ).toEqual([]);
  });
});

describe("a span, a metric and a prompt", () => {
  test("a span's attribute: its key names the data", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/tracing.ts", [
      'span.setAttribute("user.email", email);',
    ]);

    expect(point).toMatchObject({
      sink: SensitiveDataSink.Span,
      checkId: "sensitive-data-in-telemetry",
      subject: "user.email",
      text: "Writes an email address to a span: `user.email`, in `span.setAttribute`.",
    });
  });

  test("a span's attributes in Python", () => {
    expect(
      subjectsIn("app/tracing.py", [
        'span.set_attribute("ssn", applicant.ssn)',
      ]),
    ).toEqual(["ssn"]);
  });

  test("a metric's label", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/metrics.ts", [
      "signupCounter.add(1, { email: user.email });",
    ]);

    expect(point.sink).toBe(SensitiveDataSink.Metric);
    expect(point.text).toBe(
      "Puts an email address in a metric label: `email`, in `signupCounter.add`.",
    );
  });

  test("a prompt to an AI provider: its own check, and its own fix", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/summary.ts", [
      "const answer = await openai.chat.completions.create({",
      '  model: "gpt-4o",',
      '  messages: [{ role: "user", content: `Summarize: ${patient.diagnosisCode}` }],',
      "});",
    ]);

    expect(point).toMatchObject({
      sink: SensitiveDataSink.AiPrompt,
      checkId: "sensitive-data-to-ai",
      subject: "patient.diagnosisCode",
      line: 3,
      fix: "Leave `patient.diagnosisCode` out of the prompt, or put a placeholder in its place that the answer does not need.",
    });
  });
});

describe("a whole object", () => {
  test("a request's body", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/routes.ts", [
      'logger.info("request", req.body);',
    ]);

    expect(point).toMatchObject({
      isWholeObject: true,
      subject: "req.body",
      isBlocking: false,
      fix: "Write only the fields you need, by name, and none of its secrets.",
    });
    expect(point.text).toContain("a whole request body");
  });

  test("a request's headers carry its authorization: Restricted, and it can fail the check", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/routes.ts", [
      'logger.info("request", { headers: req.headers });',
    ]);

    expect(point.isWholeObject).toBe(true);
    expect(point.sensitivity).toBe(DataSensitivity.Restricted);
    expect(point.isBlocking).toBe(true);
    expect(point.location).toBe("attributes.headers");
  });
});

describe("the change's own redaction helper", () => {
  test("is the fix it suggests, where the change uses one", () => {
    const points: Array<SensitiveDataCandidate> = writesIn("src/signup.ts", [
      'logger.info("signup", { email: redactEmail(email) });',
      'logger.info("welcome", { email });',
    ]);

    expect(points).toHaveLength(1);
    expect(points[0]!.line).toBe(2);
    expect(points[0]!.fix).toBe(
      "Pass `email` through `redactEmail` first, as this change does elsewhere, or leave it out.",
    );
  });
});

describe("one point a line and name", () => {
  test("the same name twice on a line is one point", () => {
    expect(
      subjectsIn("src/signup.ts", [
        "logger.info(`${email} signed up`, { email });",
      ]),
    ).toEqual(["email"]);
  });

  test("each line is its own point", () => {
    expect(
      subjectsIn("src/signup.ts", [
        'logger.info("one", { email });',
        'logger.info("two", { email });',
      ]),
    ).toEqual(["email", "email"]);
  });
});

describe("what a call writes to", () => {
  test.each([
    ["logger.info", SensitiveDataSink.Log],
    ["this.logger.warn", SensitiveDataSink.Log],
    ["_logger.LogError", SensitiveDataSink.Log],
    ["console.error", SensitiveDataSink.Log],
    ["span.setAttribute", SensitiveDataSink.Span],
    ["span.setAttributes", SensitiveDataSink.Span],
    ["requestCounter.add", SensitiveDataSink.Metric],
    ["anthropic.messages.create", SensitiveDataSink.AiPrompt],
  ])("%s writes to %s", (name: string, sink: SensitiveDataSink) => {
    expect(getSink({ name, isMacro: false, isConstructor: false })).toBe(sink);
  });

  test.each(["dialog.info", "catalog.add", "list.add", "user.create", "info"])(
    "%s writes to no telemetry",
    (name: string) => {
      expect(
        getSink({ name, isMacro: false, isConstructor: false }),
      ).toBeNull();
    },
  );

  test("a Rust macro", () => {
    expect(getSink({ name: "info", isMacro: true, isConstructor: false })).toBe(
      SensitiveDataSink.Log,
    );
    expect(
      getSink({ name: "vec", isMacro: true, isConstructor: false }),
    ).toBeNull();
  });
});

describe("the line without one entry", () => {
  test.each([
    [
      'logger.info("signup", { email, plan });',
      "email",
      'logger.info("signup", { plan });',
    ],
    [
      "logger.info({ email: user.email, plan })",
      "email",
      "logger.info({ plan })",
    ],
    [
      'logger.info("signup", { "email": email, plan });',
      "email",
      'logger.info("signup", { plan });',
    ],
    ['logger.info("signup", { email });', "email", 'logger.info("signup");'],
  ])("%s without %s", (line: string, key: string, expected: string) => {
    expect(withoutEntry(line, key)).toBe(expected);
  });

  test.each([
    // Nothing to keep, and no argument before it: a person decides.
    ["logger.info({ email })", "email"],
    // Nested: the entries do not split cleanly.
    ['logger.info("x", { user: { email } })', "email"],
    // Not on the line.
    ['logger.info("x", { plan })', "email"],
    // No object at all.
    ['logger.info("x", email)', "email"],
  ])("%s has no line without %s", (line: string, key: string) => {
    expect(withoutEntry(line, key)).toBeNull();
  });
});

describe("time in line with the change, whatever it holds", () => {
  test.each([
    ["calls that never close", 'logger.info("x", { email,'],
    ["brackets", "logger.info(((((((((((((((((((("],
    ["a long chain", `logger.info(${"a.".repeat(400)}email)`],
  ])("%s", (_what: string, line: string) => {
    const lines: Array<string> = [];

    for (let index: number = 0; index < 2000; index++) {
      lines.push(line);
    }

    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        return writesIn("src/many.ts", lines).length;
      },
      limitInMs: 3000,
    });

    expect(run.inMs).toBeLessThan(3000);
  });
});
