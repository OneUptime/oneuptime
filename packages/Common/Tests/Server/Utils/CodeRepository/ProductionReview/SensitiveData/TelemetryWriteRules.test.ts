import { SensitiveDataCandidate } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataCandidate";
import { SensitiveNameMatcher } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataNames";
import { readPatchLines } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataPatch";
import {
  findMetricInstruments,
  findTelemetryWrites,
  getSink,
  isExceptionClassName,
  readSink,
  withoutEntry,
} from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/TelemetryWriteRules";
import { getCodeLanguage } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataCode";
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

/*
 * AN EXCEPTION IS TELEMETRY TOO (#10778): the message an error is made
 * with reaches the service's exceptions, as a log line does its logs - and
 * so does what an error tracker or a span is handed to report one. Each
 * language the section reads makes and throws its errors its own way.
 */
describe("an exception's message (#10778)", () => {
  test("throw new Error(`no account for ${email}`): an email address in the message, its line, its fix", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/accounts.ts", [
      "export function find(email: string): Account {",
      "  throw new Error(`no account for ${email}`);",
      "}",
    ]);

    expect(point).toMatchObject({
      kind: SensitiveDataLeakKind.Telemetry,
      checkId: "sensitive-data-in-telemetry",
      sink: SensitiveDataSink.Exception,
      path: "src/accounts.ts",
      line: 2,
      subject: "email",
      where: "Error",
      sensitivity: DataSensitivity.Confidential,
      isBlocking: false,
      location: "message",
      text: "Writes an email address to an exception's message: `email`, in `Error`.",
      fix: "Leave `email` out of the exception: name the field it is about, never what it holds.",
    });
    // A message's interpolation is no entry a line can lose whole.
    expect(point.suggestion).toBeUndefined();
  });

  test('raise ValueError(f"bad card {card_number}"): a card number, Restricted, so it can fail the check', () => {
    const point: SensitiveDataCandidate = onlyPoint("app/payments/cards.py", [
      "def charge(card_number: str) -> None:",
      '    raise ValueError(f"bad card {card_number}")',
    ]);

    expect(point).toMatchObject({
      sink: SensitiveDataSink.Exception,
      subject: "card_number",
      where: "ValueError",
      sensitivity: DataSensitivity.Restricted,
      isBlocking: true,
      location: "message",
      text: "Writes a card number to an exception's message: `card_number`, in `ValueError`.",
    });
  });

  test("a secret in a message is a secret: its own check, and its own fix", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/payments.js", [
      "throw new Error(`Payment provider refused the charge for key ${apiKey}`);",
    ]);

    expect(point).toMatchObject({
      sink: SensitiveDataSink.Exception,
      checkId: "secrets-in-telemetry",
      subject: "apiKey",
      isBlocking: true,
      fix: "Leave `apiKey` out: everyone who reads the telemetry could read the secret.",
    });
  });

  test.each([
    [
      "TypeScript, a template literal",
      "src/accounts.ts",
      ["throw new Error(`no account for ${email}`);"],
      "Error",
    ],
    [
      "JavaScript, Error without new",
      "src/accounts.js",
      ["throw Error('no account for ' + email);"],
      "Error",
    ],
    [
      "JavaScript, an error made by a factory and thrown",
      "src/accounts.js",
      ["throw createError(404, `no account for ${email}`);"],
      "createError",
    ],
    [
      "JavaScript, an error handed to a callback",
      "src/accounts.js",
      ["return next(new NotFoundError(`no account for ${email}`));"],
      "NotFoundError",
    ],
    [
      "Python, an f-string",
      "app/accounts.py",
      ['raise LookupError(f"no account for {email}")'],
      "LookupError",
    ],
    [
      "Python, a keyword argument",
      "app/views.py",
      [
        'raise HTTPException(status_code=404, detail=f"no account for {email}")',
      ],
      "HTTPException",
    ],
    [
      "Python, Flask's abort",
      "app/views.py",
      ['abort(404, description=f"no account for {email}")'],
      "abort",
    ],
    [
      "Go, fmt.Errorf",
      "pkg/accounts/find.go",
      ['return nil, fmt.Errorf("no account for %s", email)'],
      "fmt.Errorf",
    ],
    [
      "Go, errors.New",
      "pkg/accounts/find.go",
      ['return errors.New("no account for " + email)'],
      "errors.New",
    ],
    [
      "Go, a gRPC status",
      "pkg/accounts/find.go",
      ['return nil, status.Errorf(codes.NotFound, "no account for %s", email)'],
      "status.Errorf",
    ],
    [
      "Go, panic",
      "pkg/accounts/find.go",
      ['panic(fmt.Sprintf("no account for %s", email))'],
      "panic",
    ],
    [
      "Java",
      "src/main/java/Accounts.java",
      ['throw new IllegalArgumentException("No account for " + email);'],
      "IllegalArgumentException",
    ],
    [
      "Kotlin",
      "src/main/kotlin/Accounts.kt",
      ['throw IllegalStateException("No account for $email")'],
      "IllegalStateException",
    ],
    [
      "Scala",
      "src/main/scala/Accounts.scala",
      ['throw new IllegalArgumentException(s"No account for $email")'],
      "IllegalArgumentException",
    ],
    [
      "C#",
      "src/Accounts.cs",
      [
        'throw new ArgumentException($"No account for {email}", nameof(email));',
      ],
      "ArgumentException",
    ],
    [
      "PHP, the root namespace",
      "src/Accounts.php",
      ['throw new \\InvalidArgumentException("No account for {$email}");'],
      "InvalidArgumentException",
    ],
    [
      "Ruby, raise with no parentheses",
      "app/models/account.rb",
      ['raise ArgumentError, "no account for #{email}"'],
      "raise ArgumentError",
    ],
    [
      "Ruby, a message alone",
      "app/models/account.rb",
      ['raise "no account for #{email}"'],
      "raise",
    ],
    [
      "Ruby, fail",
      "app/models/account.rb",
      ['fail AccountMissing, "no account for #{email}"'],
      "fail AccountMissing",
    ],
    [
      "Elixir",
      "lib/accounts.ex",
      ['raise ArgumentError, message: "no account for #{email}"'],
      "raise ArgumentError",
    ],
    [
      "Rust, bail!",
      "src/accounts.rs",
      ['bail!("no account for {}", email);'],
      "bail",
    ],
    [
      "Rust, anyhow! with the value in the string",
      "src/accounts.rs",
      ['return Err(anyhow!("no account for {email}"));'],
      "anyhow",
    ],
    [
      "Swift",
      "Sources/Accounts.swift",
      ['throw AccountError.missing("no account for \\(email)")'],
      "AccountError.missing",
    ],
    [
      "Dart, a single-quoted string",
      "lib/accounts.dart",
      ["throw ArgumentError('no account for $email');"],
      "ArgumentError",
    ],
  ])(
    "%s",
    (_language: string, path: string, lines: Array<string>, where: string) => {
      const point: SensitiveDataCandidate = onlyPoint(path, lines);

      expect({
        sink: point.sink,
        subject: point.subject,
        where: point.where,
        location: point.location,
        text: point.text,
      }).toEqual({
        sink: SensitiveDataSink.Exception,
        subject: "email",
        where,
        location: "message",
        text: `Writes an email address to an exception's message: \`email\`, in \`${where}\`.`,
      });
    },
  );

  test("handed to the error under a key, it is in the exception, not only its message", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/accounts.ts", [
      "throw new AccountError({ email: customer.email, code: 404 });",
    ]);

    expect(point).toMatchObject({
      subject: "email",
      location: "message",
      text: "Writes an email address to an exception: `email`, in `AccountError`.",
    });
  });

  test("an error made where it is thrown across lines is read to its end", () => {
    expect(
      subjectsIn("src/accounts.ts", [
        "throw new HttpError(",
        "  404,",
        "  `no account for ${customer.email}`,",
        ");",
      ]),
    ).toEqual(["customer.email"]);
  });

  test("Ruby's statement modifier ends a call with no parentheses: what follows is only asked about", () => {
    expect(
      subjectsIn("app/services/customer_lookup.rb", [
        'raise ArgumentError, "unknown customer #{email}" unless customer',
      ]),
    ).toEqual(["email"]);
    // A log call with none, the same: `current_user` is a whole record only when written.
    expect(
      subjectsIn("app/controllers/sessions_controller.rb", [
        'logger.info "signed in #{email}" if current_user',
      ]),
    ).toEqual(["email"]);
    // Inside the call's own brackets, a word like `if` is the call's.
    expect(
      subjectsIn("app/services/customer_lookup.rb", [
        'raise ArgumentError, format("unknown %s", email) if strict',
      ]),
    ).toEqual(["email"]);
  });

  test("a log of an error made on the same line is the log's point, once", () => {
    const points: Array<SensitiveDataCandidate> = writesIn("src/accounts.ts", [
      "logger.error(new Error(`no account for ${email}`));",
    ]);

    expect(points).toHaveLength(1);
    expect(points[0]!.sink).toBe(SensitiveDataSink.Log);
  });
});

describe("an error tracker's report, and a span's recorded exception (#10778)", () => {
  test("Sentry.captureException(error, { extra: { email } }): an email address in the report, under its key", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/checkout.ts", [
      "Sentry.captureException(error, { extra: { email } });",
    ]);

    expect(point).toMatchObject({
      sink: SensitiveDataSink.Exception,
      checkId: "sensitive-data-in-telemetry",
      subject: "email",
      where: "Sentry.captureException",
      location: "attributes.email",
      text: "Writes an email address to an error report: `email`, in `Sentry.captureException`.",
      fix: "Leave `email` out of the error report, or send a hash of it when you need to tell values apart.",
    });
  });

  test("Sentry.setUser({ email, id }): every report after it carries it, and the line can lose it", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/session.ts", [
      "Sentry.setUser({ email, id: user.id });",
    ]);

    expect(point).toMatchObject({
      sink: SensitiveDataSink.Exception,
      subject: "email",
      where: "Sentry.setUser",
      suggestion: {
        startLine: 1,
        endLine: 1,
        original: ["Sentry.setUser({ email, id: user.id });"],
        replacement: ["Sentry.setUser({ id: user.id });"],
        isByAi: false,
      },
    });
  });

  test('scope.setTag("ssn", ssn): its key is its first string, and Restricted data can fail the check', () => {
    const point: SensitiveDataCandidate = onlyPoint("src/applicants.ts", [
      "Sentry.withScope((scope) => {",
      '  scope.setTag("ssn", ssn);',
      "});",
    ]);

    expect(point).toMatchObject({
      sink: SensitiveDataSink.Exception,
      subject: "ssn",
      where: "scope.setTag",
      sensitivity: DataSensitivity.Restricted,
      isBlocking: true,
      location: "attributes.ssn",
    });
  });

  test.each([
    [
      "Python, sentry_sdk.set_user",
      "app/session.py",
      ['sentry_sdk.set_user({"email": email})'],
      "email",
      "sentry_sdk.set_user",
    ],
    [
      "Python, set_user imported on its own",
      "app/session.py",
      ['set_user({"email": email})'],
      "email",
      "set_user",
    ],
    [
      "Python, a scope's extra",
      "app/session.py",
      ['    scope.set_extra("email", email)'],
      "email",
      "scope.set_extra",
    ],
    [
      "Python, a span's recorded exception and its attributes",
      "app/session.py",
      ['span.record_exception(error, attributes={"user.email": email})'],
      "user.email",
      "span.record_exception",
    ],
    [
      "Ruby, Sentry with keywords",
      "app/controllers/sessions_controller.rb",
      ["Sentry.set_user(email: user.email)"],
      "email",
      "Sentry.set_user",
    ],
    [
      "Go, a scope's user",
      "pkg/session/session.go",
      ["scope.SetUser(sentry.User{Email: email})"],
      "Email",
      "scope.SetUser",
    ],
    [
      "Java, Sentry's extra",
      "src/main/java/Session.java",
      ['Sentry.setExtra("email", email);'],
      "email",
      "Sentry.setExtra",
    ],
    [
      "C#, Application Insights",
      "src/Session.cs",
      [
        'telemetryClient.TrackException(ex, new Dictionary<string, string> { { "email", email } });',
      ],
      "email",
      "telemetryClient.TrackException",
    ],
    [
      "PHP, a scope's user",
      "src/Session.php",
      ["$scope->setUser(['email' => $email]);"],
      "email",
      "scope.setUser",
    ],
    [
      "Bugsnag's metadata on its event",
      "src/session.ts",
      [
        'Bugsnag.notify(error, (event) => { event.addMetadata("user", { email }); });',
      ],
      "user.email",
      "Bugsnag.notify",
    ],
    [
      "Rollbar",
      "src/session.ts",
      ['rollbar.error("sign-in failed", { email });'],
      "email",
      "rollbar.error",
    ],
    [
      "Honeybadger",
      "src/session.ts",
      ["Honeybadger.setContext({ email });"],
      "email",
      "Honeybadger.setContext",
    ],
    [
      "New Relic",
      "src/session.ts",
      ["newrelic.noticeError(error, { email });"],
      "email",
      "newrelic.noticeError",
    ],
    [
      "a span's recorded exception made on its line",
      "src/session.ts",
      ["span.recordException(new Error(`sign-in failed for ${email}`));"],
      "email",
      "span.recordException",
    ],
  ])(
    "%s",
    (
      _what: string,
      path: string,
      lines: Array<string>,
      subject: string,
      where: string,
    ) => {
      const point: SensitiveDataCandidate = onlyPoint(path, lines);

      expect({
        sink: point.sink,
        subject: point.subject,
        where: point.where,
        text: point.text,
      }).toEqual({
        sink: SensitiveDataSink.Exception,
        subject,
        where,
        text: `Writes an email address to an error report: \`${subject}\`, in \`${where}\`.`,
      });
    },
  );
});

describe("an exception that is no leak (#10778)", () => {
  test.each([
    [
      "a message that names only a field",
      ['throw new Error("email is required");'],
    ],
    [
      "a message that names only a field, under a check of it",
      ['if (!email) throw new Error("email is required");'],
    ],
    [
      "a field's name and what is wrong with it",
      ['throw new ValidationError("email", "is required");'],
    ],
    [
      "a field's name as a value",
      [
        'throw new ValidationError({ field: "email", message: "is required" });',
      ],
    ],
    [
      "a password's rule, not the password",
      ['throw new Error("password must be at least 8 characters");'],
    ],
    [
      "something else in the message",
      ["throw new Error(`no format ${format}`);"],
    ],
    ["an id", ["throw new Error(`no account ${user.id}`);"]],
    ["a yes or no", ["throw new Error(`verified: ${user.emailVerified}`);"]],
    [
      "only asked about",
      ['throw new Error(`${email ? "an" : "no"} address`);'],
    ],
    ["a hash of it", ["throw new Error(`no account for ${hash(email)}`);"]],
    ["an error thrown again", ["throw error;"]],
    [
      "an error reported with nothing else",
      ["Sentry.captureException(error);"],
    ],
    ["a span's recorded exception alone", ["span.recordException(error);"]],
    ["a list of errors", ["errors.push(email);"]],
    [
      "a form's error, shown to the person",
      ['setError("email", { message: "Invalid" });'],
    ],
    [
      "a component's state named like a tracker's setter",
      ["setUser({ email: value });"],
    ],
    ["a class's own setter", ["this.setUser({ email });"]],
    ["a store's setter", ["store.setUser({ email });"]],
    ["a scope that is no tracker's", ["scope.render({ email });"]],
    ["an object that is no error", ["const customer = new Customer(email);"]],
    ["a controller's abort", ["controller.abort(email);"]],
    [
      "a line marked not sensitive",
      [
        "throw new Error(`no account for ${email}`); // oneuptime:not-sensitive",
      ],
    ],
  ])("%s", (_what: string, lines: Array<string>) => {
    expect(writesIn("src/accounts.ts", lines)).toEqual([]);
  });

  test.each([
    [
      "Python, a password's rule",
      "app/accounts.py",
      ['raise ValueError("password must be at least 8 characters")'],
    ],
    ["Python, a bare raise", "app/accounts.py", ["raise"]],
    ["Ruby, a bare raise", "app/models/account.rb", ["raise"]],
    [
      "Go, an id and the error it wraps",
      "pkg/accounts/find.go",
      ['return fmt.Errorf("decode account %s: %w", accountID, err)'],
    ],
    [
      "Go, another package's New",
      "pkg/accounts/find.go",
      ["validationErrors.New(email)"],
    ],
    [
      "C#, a model's validation error, shown to the person",
      "src/Accounts.cs",
      ['ModelState.AddModelError("Email", $"{email} is taken");'],
    ],
  ])("%s", (_what: string, path: string, lines: Array<string>) => {
    expect(writesIn(path, lines)).toEqual([]);
  });
});

describe("what a call writes to: exceptions (#10778)", () => {
  test.each([
    ["fmt.Errorf", SensitiveDataSink.Exception],
    ["status.Errorf", SensitiveDataSink.Exception],
    ["errors.New", SensitiveDataSink.Exception],
    ["pkgerrors.Wrapf", SensitiveDataSink.Exception],
    ["Sentry.captureException", SensitiveDataSink.Exception],
    ["Sentry.captureMessage", SensitiveDataSink.Exception],
    ["Sentry.setUser", SensitiveDataSink.Exception],
    ["Sentry.Context.set_user_context", SensitiveDataSink.Exception],
    ["sentry_sdk.set_tag", SensitiveDataSink.Exception],
    ["scope.setTag", SensitiveDataSink.Exception],
    ["hub.captureException", SensitiveDataSink.Exception],
    ["Bugsnag.notify", SensitiveDataSink.Exception],
    ["rollbar.error", SensitiveDataSink.Exception],
    ["Honeybadger.notify", SensitiveDataSink.Exception],
    ["newrelic.noticeError", SensitiveDataSink.Exception],
    ["span.recordException", SensitiveDataSink.Exception],
    ["activity.AddException", SensitiveDataSink.Exception],
    ["telemetryClient.TrackException", SensitiveDataSink.Exception],
    ["captureException", SensitiveDataSink.Exception],
    ["set_user", SensitiveDataSink.Exception],
    ["panic", SensitiveDataSink.Exception],
    // A logger's own error methods are its logs.
    ["log.Errorf", SensitiveDataSink.Log],
    ["logger.Errorf", SensitiveDataSink.Log],
    ["logger.error", SensitiveDataSink.Log],
    // A tag on a span is the span's; a tracer's user is on its trace.
    ["span.setTag", SensitiveDataSink.Span],
    ["tracer.setUser", SensitiveDataSink.Span],
  ])("%s writes to %s", (name: string, sink: SensitiveDataSink) => {
    expect(getSink({ name, isMacro: false, isConstructor: false })).toBe(sink);
  });

  test.each([
    "setUser",
    "this.setUser",
    "store.setContext",
    "scope.render",
    "errors.push",
    "ModelState.AddModelError",
    "handleError",
    "controller.abort",
  ])("%s writes to no telemetry", (name: string) => {
    expect(getSink({ name, isMacro: false, isConstructor: false })).toBeNull();
  });

  test("an error made with new is an exception; another class is not", () => {
    expect(
      getSink({ name: "Error", isMacro: false, isConstructor: true }),
    ).toBe(SensitiveDataSink.Exception);
    expect(
      getSink({
        name: "errors.NotFoundException",
        isMacro: false,
        isConstructor: true,
      }),
    ).toBe(SensitiveDataSink.Exception);
    expect(
      getSink({ name: "Customer", isMacro: false, isConstructor: true }),
    ).toBeNull();
  });

  test("whatever is thrown or raised where it is made is an exception", () => {
    for (const name of ["createError", "Boom.notFound", "ValueError"]) {
      expect(
        getSink({ name, isMacro: false, isConstructor: false, isThrown: true }),
      ).toBe(SensitiveDataSink.Exception);
    }
  });

  test("Rust's error macros, beside its log macros", () => {
    for (const name of ["bail", "anyhow", "panic", "ensure", "eyre"]) {
      expect(getSink({ name, isMacro: true, isConstructor: false })).toBe(
        SensitiveDataSink.Exception,
      );
    }

    expect(
      getSink({ name: "error", isMacro: true, isConstructor: false }),
    ).toBe(SensitiveDataSink.Log);
    expect(
      getSink({ name: "vec", isMacro: true, isConstructor: false }),
    ).toBeNull();
  });

  test("a report is told from a message: a tracker's or a span's, not an error made", () => {
    expect(
      readSink({
        name: "Sentry.setUser",
        isMacro: false,
        isConstructor: false,
      }),
    ).toEqual({ sink: SensitiveDataSink.Exception, isErrorReport: true });
    expect(
      readSink({ name: "fmt.Errorf", isMacro: false, isConstructor: false }),
    ).toEqual({ sink: SensitiveDataSink.Exception, isErrorReport: false });
    expect(
      readSink({ name: "Error", isMacro: false, isConstructor: true }),
    ).toEqual({ sink: SensitiveDataSink.Exception, isErrorReport: false });
  });

  test.each([
    ["Error", true],
    ["TypeError", true],
    ["IllegalArgumentException", true],
    ["errors.NotFoundException", true],
    ["handleError", false],
    ["ErrorBoundary", false],
    ["ValidationErrors", false],
    ["error", false],
  ])("%s is a class of error: %s", (name: string, isClass: boolean) => {
    expect(isExceptionClassName(name)).toBe(isClass);
  });
});

/*
 * A metric's instrument named for what it counts, found by the cross-check
 * with what Data Security locates after code ships (#10367's eval set):
 * `const ordersPlaced = meter.createCounter(...)` makes
 * `ordersPlaced.add(1, {...})` a metric's write, which its name alone
 * does not say.
 */
describe("a metric's instrument, by where the file makes it", () => {
  test("an OpenTelemetry counter named for what it counts", () => {
    const point: SensitiveDataCandidate = onlyPoint("src/metrics.js", [
      'const ordersPlaced = meter.createCounter("orders.placed");',
      "",
      "function countOrder(order) {",
      '  ordersPlaced.add(1, { "order.channel": order.channel, "user.email": order.email });',
      "}",
    ]);

    expect(point).toMatchObject({
      sink: SensitiveDataSink.Metric,
      subject: "user.email",
      where: "ordersPlaced.add",
      line: 4,
    });
  });

  test("an instrument made above the hunk, shown as context, still names its writes", () => {
    const points: Array<SensitiveDataCandidate> = findTelemetryWrites({
      path: "src/metrics.js",
      lines: readPatchLines(
        [
          "@@ -5,4 +5,5 @@",
          ' const ordersPlaced = meter.createCounter("orders.placed");',
          " ",
          " function countOrder(order) {",
          '+  ordersPlaced.add(1, { "user.email": order.email });',
          " }",
        ].join("\n"),
      ),
      matcher,
    });

    expect(
      points.map((point: SensitiveDataCandidate): string | undefined => {
        return point.sink;
      }),
    ).toEqual([SensitiveDataSink.Metric]);
  });

  test.each([
    [
      "JavaScript, OpenTelemetry",
      "ts",
      'const ordersPlaced = meter.createCounter("orders.placed");',
      "ordersplaced",
    ],
    [
      "Python, OpenTelemetry on self",
      "py",
      'self._orders_placed = meter.create_counter("orders.placed")',
      "orders_placed",
    ],
    ["Go", "go", 'placed := meter.Int64Counter("orders.placed")', "placed"],
    [
      "Go, with its error",
      "go",
      'placed, err := meter.Int64Counter("orders.placed")',
      "placed",
    ],
    [
      "C#, a generic counter",
      "cs",
      'private readonly Counter<long> _placed = meter.CreateCounter<long>("orders.placed");',
      "placed",
    ],
    [
      "Python, Prometheus",
      "py",
      'ORDERS = Counter("orders_total", "Orders placed", ["channel"])',
      "orders",
    ],
    [
      "JavaScript, Prometheus",
      "js",
      "const orders = new client.Counter({ name: 'orders_total', help: 'Orders' });",
      "orders",
    ],
  ])(
    "%s",
    (_language: string, extension: string, line: string, name: string) => {
      expect(
        Array.from(findMetricInstruments([line], getCodeLanguage(extension))),
      ).toEqual([name]);
    },
  );

  test("a set is no instrument, nor is a lower-case counter()", () => {
    expect(
      Array.from(
        findMetricInstruments(
          ["const seen = new Set();", "const count = counter(items);"],
          getCodeLanguage("ts"),
        ),
      ),
    ).toEqual([]);
    expect(
      writesIn("src/words.ts", ["const seen = new Set();", "seen.add(email);"]),
    ).toEqual([]);
  });
});

describe("Dart's single-quoted strings interpolate", () => {
  test("a log's message, as a double-quoted one does", () => {
    expect(
      subjectsIn("lib/signup.dart", ["log.info('signup $email');"]),
    ).toEqual(["email"]);
    expect(
      subjectsIn("lib/signup.dart", ['log.info("signup ${user.email}");']),
    ).toEqual(["user.email"]);
  });
});
