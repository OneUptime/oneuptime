/*
 * THE SENSITIVE DATA EVAL SET (#10376): PULL REQUESTS, AND THE POINTS EACH
 * SHOULD GET.
 *
 * Every diff here is made up, in the shapes hosts send - a file's unified
 * diff, hunk by hunk - and says the points a production review's rules
 * must give it (each by the name the rule reads, its check and whether it
 * can fail the check), and none other. It is read twice:
 *
 *   - by the rules' tests (ProductionReviewSensitiveDataEvalSet.test.ts),
 *     on every run: each diff gets exactly its points;
 *   - by the Data Security eval (DataSecurityEvalCases), for the diffs that
 *     say what OneUptime AI should keep of them: the read is asked as a
 *     review asks it, and scored on which points it keeps.
 *
 * A new rule, or a fix to one, adds its diff here: what it must find, and
 * what it must leave alone.
 */

import { SensitiveDataSink } from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";

export interface EvalDiffFile {
  filename: string;
  status: string;
  patch: string;
}

// One point a diff must get, by the name its rule reads.
export interface EvalExpectedPoint {
  subject: string;
  checkId: string;
  isBlocking: boolean;
  // Telemetry: where the value goes, when the diff says (#10778's exceptions).
  sink?: SensitiveDataSink | undefined;
  // A migration's table, when the diff names it (#10779): what production is asked of.
  where?: string | undefined;
}

export interface PullRequestEvalDiff {
  id: string;
  title: string;
  files: Array<EvalDiffFile>;
  // Exactly the points the rules give the diff, in any order.
  points: Array<EvalExpectedPoint>;
  // The repository fails its check on a leak.
  isFailOn?: boolean | undefined;
  // What OneUptime AI should keep of them, when the diff is an eval case.
  ai?:
    | {
        keeps: Record<string, boolean>;
        fixMentions?: Array<Array<string>> | undefined;
        never?: Array<string> | undefined;
      }
    | undefined;
}

// A new file's diff: every line added, from line 1.
export function addedFile(
  filename: string,
  lines: Array<string>,
): EvalDiffFile {
  return {
    filename,
    status: "added",
    patch: [
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line: string): string => {
        return `+${line}`;
      }),
    ].join("\n"),
  };
}

/*
 * A changed file's diff: one hunk at `start`, its lines as written - each
 * starting with "+", "-" or " ", as a patch's do.
 */
export function changedFile(
  filename: string,
  start: number,
  lines: Array<string>,
): EvalDiffFile {
  const before: number = lines.filter((line: string): boolean => {
    return !line.startsWith("+");
  }).length;
  const after: number = lines.filter((line: string): boolean => {
    return !line.startsWith("-");
  }).length;

  return {
    filename,
    status: "modified",
    patch: [`@@ -${start},${before} +${start},${after} @@`, ...lines].join(
      "\n",
    ),
  };
}

const TELEMETRY: Array<PullRequestEvalDiff> = [
  {
    id: "log-email-on-signup",
    title: "Log signups",
    files: [
      changedFile("services/checkout/src/signup.ts", 10, [
        " export async function signup(email: string): Promise<void> {",
        '+  logger.info("signup", { email });',
        "   await users.create({ email });",
      ]),
    ],
    points: [
      {
        subject: "email",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
      },
    ],
    ai: {
      keeps: { email: true },
      fixMentions: [["leave", "remove", "hash", "omit", "drop", "out"]],
    },
  },
  {
    id: "log-password-on-login",
    title: "Debug failed logins",
    isFailOn: true,
    files: [
      changedFile("api/routes/login.js", 21, [
        "   if (!user) {",
        '+    console.error("login failed", { username, password });',
        "     return res.status(401).end();",
      ]),
    ],
    points: [
      {
        subject: "password",
        checkId: "secrets-in-telemetry",
        isBlocking: true,
      },
    ],
    ai: {
      keeps: { password: true },
      fixMentions: [["password"]],
    },
  },
  {
    id: "log-hashed-email",
    title: "Count signups by email hash",
    files: [
      changedFile("src/metrics/signups.ts", 4, [
        " export function recordSignup(rawEmail: string): void {",
        "+  const email: string = sha256(rawEmail.toLowerCase());",
        '+  logger.info("signup", { email });',
        " }",
      ]),
    ],
    points: [
      {
        subject: "email",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
      },
    ],
    ai: { keeps: { email: false } },
  },
  {
    id: "log-hashed-in-the-call",
    title: "Log a hash of the email",
    files: [
      addedFile("src/audit.ts", [
        "export function audit(email: string): void {",
        '  logger.info("audit", { emailHash: sha256(email), id: hash(email) });',
        "}",
      ]),
    ],
    points: [],
  },
  {
    id: "key-only-names-a-field",
    title: "Say which field is missing",
    files: [
      addedFile("src/validate.ts", [
        'logger.warn("missing field", { field: "email" });',
        "logger.info({ emailVerified: user.emailVerified, email: user.id });",
        'logger.debug({ password: "***" });',
        "logger.info({ hasPassword: !!user.password });",
      ]),
    ],
    points: [],
  },
  {
    id: "model-token-counts",
    title: "Log token usage",
    files: [
      addedFile("src/ai/usage.py", [
        "def record(usage):",
        '    logger.info("usage", extra={"prompt_tokens": usage.prompt_tokens, "max_tokens": MAX_TOKENS})',
        '    logger.info(f"next page {next_page_token}")',
      ]),
    ],
    points: [],
  },
  {
    id: "test-file-logs-email",
    title: "Test the signup log",
    files: [
      addedFile("services/checkout/src/signup.test.ts", [
        'test("logs", () => {',
        '  logger.info("signup", { email: "ada@example.com", email2: email });',
        "});",
      ]),
    ],
    points: [],
  },
  {
    id: "marked-not-sensitive",
    title: "Log the support inbox",
    files: [
      addedFile("src/support.ts", [
        "// oneuptime:not-sensitive - the support inbox, not a person's",
        "logger.info({ email: SUPPORT_EMAIL });",
        "logger.info({ supportEmail }); // oneuptime:not-sensitive",
      ]),
    ],
    points: [],
  },
  {
    id: "span-attribute-ssn",
    title: "Trace applications",
    isFailOn: true,
    files: [
      changedFile("apply/handlers.py", 30, [
        "     with tracer.start_as_current_span('apply') as span:",
        '+        span.set_attribute("applicant.ssn", applicant.ssn)',
        "         return submit(applicant)",
      ]),
    ],
    points: [
      {
        subject: "applicant.ssn",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: true,
      },
    ],
  },
  {
    id: "metric-label-email",
    title: "Count logins per user",
    files: [
      addedFile("internal/auth/metrics.go", [
        "func recordLogin(u *User) {",
        "\tloginsTotal.WithLabelValues(u.Email).Inc()",
        "}",
      ]),
    ],
    points: [
      {
        subject: "u.Email",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
      },
    ],
  },
  {
    id: "prompt-with-diagnosis",
    title: "Summarize a patient's visit",
    files: [
      addedFile("src/visits/summary.ts", [
        "const answer = await openai.chat.completions.create({",
        '  model: "gpt-4o",',
        "  messages: [",
        '    { role: "user", content: `Summarize the visit for ${patient.diagnosisCode}` },',
        "  ],",
        "});",
      ]),
    ],
    points: [
      {
        subject: "patient.diagnosisCode",
        checkId: "sensitive-data-to-ai",
        isBlocking: true,
      },
    ],
  },
  {
    id: "log-request-body-and-headers",
    title: "Log incoming requests",
    files: [
      addedFile("src/middleware/requestLog.ts", [
        "export function requestLog(req: Request): void {",
        '  logger.debug("request", req.body);',
        "  logger.info({ headers: req.headers });",
        "}",
      ]),
    ],
    points: [
      {
        subject: "req.body",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
      },
      {
        subject: "req.headers",
        checkId: "secrets-in-telemetry",
        isBlocking: true,
      },
    ],
  },
  {
    id: "log-access-token",
    title: "Debug the OAuth callback",
    files: [
      addedFile("auth/oauth.rb", [
        "def callback",
        '  Rails.logger.info "token #{access_token}"',
        "end",
      ]),
    ],
    points: [
      {
        subject: "access_token",
        checkId: "secrets-in-telemetry",
        isBlocking: true,
      },
    ],
  },
  {
    id: "example-code-logs-email",
    title: "Add a logging example",
    files: [
      addedFile("examples/logging/quickstart.ts", [
        "// How to log with the SDK.",
        'logger.info("user signed up", { email: "you@example.com", phone });',
      ]),
    ],
    points: [
      {
        subject: "phone",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
      },
    ],
    ai: { keeps: { phone: false } },
  },
];

const INFRASTRUCTURE: Array<PullRequestEvalDiff> = [
  {
    id: "terraform-public-bucket",
    title: "Host the marketing site",
    isFailOn: true,
    files: [
      addedFile("infra/website.tf", [
        'resource "aws_s3_bucket" "website" {',
        '  bucket = "acme-website"',
        '  acl    = "public-read"',
        "}",
      ]),
    ],
    points: [{ subject: "acl", checkId: "public-read", isBlocking: true }],
    ai: { keeps: { acl: true } },
  },
  {
    id: "terraform-web-and-database-firewalls",
    title: "Open the load balancer and the database",
    files: [
      addedFile("infra/network.tf", [
        'resource "aws_security_group_rule" "https" {',
        '  type        = "ingress"',
        "  from_port   = 443",
        "  to_port     = 443",
        '  protocol    = "tcp"',
        '  cidr_blocks = ["0.0.0.0/0"]',
        "}",
        "",
        'resource "aws_security_group_rule" "postgres" {',
        '  type        = "ingress"',
        "  from_port   = 5432",
        "  to_port     = 5432",
        '  protocol    = "tcp"',
        '  cidr_blocks = ["0.0.0.0/0"]',
        "}",
        "",
        'resource "aws_security_group_rule" "all_out" {',
        '  type        = "egress"',
        "  from_port   = 0",
        "  to_port     = 0",
        '  protocol    = "-1"',
        '  cidr_blocks = ["0.0.0.0/0"]',
        "}",
      ]),
    ],
    points: [
      {
        subject: "cidr_blocks",
        checkId: "open-to-all-addresses",
        isBlocking: false,
      },
    ],
  },
  {
    id: "terraform-open-database",
    title: "Make the reporting database reachable",
    files: [
      addedFile("infra/reporting.tf", [
        'resource "aws_db_instance" "reporting" {',
        '  identifier              = "reporting"',
        "  publicly_accessible     = true",
        "  storage_encrypted       = false",
        "  backup_retention_period = 0",
        "  deletion_protection     = true",
        "}",
      ]),
    ],
    points: [
      {
        subject: "publicly_accessible",
        checkId: "internet-reachable",
        isBlocking: false,
      },
      {
        subject: "storage_encrypted",
        checkId: "not-encrypted-at-rest",
        isBlocking: false,
      },
      {
        subject: "backup_retention_period",
        checkId: "no-backups",
        isBlocking: false,
      },
    ],
    ai: {
      keeps: {
        publicly_accessible: true,
        storage_encrypted: true,
        backup_retention_period: true,
      },
    },
  },
  {
    id: "cloudformation-public-bucket",
    title: "Add the exports bucket",
    files: [
      addedFile("stacks/exports.yaml", [
        "AWSTemplateFormatVersion: '2010-09-09'",
        "Resources:",
        "  Exports:",
        "    Type: AWS::S3::Bucket",
        "    Properties:",
        "      BucketName: acme-exports",
        "      AccessControl: PublicRead",
      ]),
    ],
    points: [
      { subject: "AccessControl", checkId: "public-read", isBlocking: true },
    ],
  },
  {
    id: "kubernetes-database-load-balancer",
    title: "Expose Postgres",
    files: [
      addedFile("deploy/postgres-service.yaml", [
        "apiVersion: v1",
        "kind: Service",
        "metadata:",
        "  name: postgres",
        "spec:",
        "  type: LoadBalancer",
        "  ports:",
        "    - port: 5432",
        "      targetPort: 5432",
      ]),
      addedFile("deploy/redis-service.yaml", [
        "apiVersion: v1",
        "kind: Service",
        "metadata:",
        "  name: redis",
        "  annotations:",
        '    service.beta.kubernetes.io/aws-load-balancer-internal: "true"',
        "spec:",
        "  type: LoadBalancer",
        "  ports:",
        "    - port: 6379",
      ]),
    ],
    points: [
      { subject: "type", checkId: "internet-reachable", isBlocking: false },
    ],
  },
  {
    id: "bicep-public-container",
    title: "Share the reports container",
    files: [
      addedFile("infra/storage.bicep", [
        "resource reports 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {",
        "  name: 'reports'",
        "  properties: {",
        "    publicAccess: 'Blob'",
        "  }",
        "}",
      ]),
    ],
    points: [
      { subject: "publicAccess", checkId: "public-read", isBlocking: true },
    ],
  },
];

/*
 * EXCEPTIONS (#10778): the message an error is made with, and what an
 * error tracker is handed, reach the service's exceptions in telemetry.
 * A message that names only the field it is about holds nothing.
 */
const EXCEPTIONS: Array<PullRequestEvalDiff> = [
  {
    id: "exception-message-with-email",
    title: "Say which account was not found",
    files: [
      changedFile("services/accounts/src/find.ts", 18, [
        "   const account = await accounts.findOne({ email });",
        "   if (!account) {",
        "-    throw new NotFoundError();",
        "+    throw new NotFoundError(`no account for ${email}`);",
        "   }",
      ]),
    ],
    points: [
      {
        subject: "email",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
        sink: SensitiveDataSink.Exception,
      },
    ],
    ai: {
      keeps: { email: true },
      fixMentions: [["leave", "remove", "omit", "out", "field"]],
    },
  },
  {
    id: "exception-message-names-only-the-field",
    title: "Validate the sign-up form",
    files: [
      changedFile("services/accounts/src/signup.ts", 4, [
        " export function validate(email: string, password: string): void {",
        '+  if (!email) throw new ValidationError("email is required");',
        '+  if (password.length < 12) throw new ValidationError("password", "is too short");',
        " }",
      ]),
    ],
    points: [],
  },
  {
    id: "python-raise-with-card-number",
    title: "Reject cards the processor declines",
    isFailOn: true,
    files: [
      changedFile("billing/cards.py", 30, [
        "     if not result.approved:",
        '+        raise ValueError(f"card {card_number} was declined")',
        "     return result",
      ]),
    ],
    points: [
      {
        subject: "card_number",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: true,
        sink: SensitiveDataSink.Exception,
      },
    ],
    ai: {
      keeps: { card_number: true },
    },
  },
  {
    id: "go-errorf-with-email",
    title: "Wrap lookup errors",
    files: [
      changedFile("internal/users/store.go", 52, [
        " \tif err != nil {",
        '+\t\treturn nil, fmt.Errorf("find user %s: %w", email, err)',
        " \t}",
      ]),
    ],
    points: [
      {
        subject: "email",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
        sink: SensitiveDataSink.Exception,
      },
    ],
  },
  {
    id: "go-errorf-with-an-id",
    title: "Wrap lookup errors by id",
    files: [
      changedFile("internal/users/store.go", 52, [
        " \tif err != nil {",
        '+\t\treturn nil, fmt.Errorf("find user %s: %w", userID, err)',
        " \t}",
      ]),
    ],
    points: [],
  },
  {
    id: "java-exception-with-ssn",
    title: "Explain rejected tax forms",
    files: [
      changedFile("src/main/java/com/acme/tax/TaxForms.java", 40, [
        "         if (!validator.isValid(form)) {",
        '+            throw new IllegalArgumentException("Invalid tax form for " + ssn);',
        "         }",
      ]),
    ],
    points: [
      {
        subject: "ssn",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: true,
        sink: SensitiveDataSink.Exception,
      },
    ],
  },
  {
    id: "ruby-raise-with-email",
    title: "Fail loudly on unknown customers",
    files: [
      changedFile("app/services/customer_lookup.rb", 12, [
        "     customer = Customer.find_by(email: email)",
        '+    raise ArgumentError, "unknown customer #{email}" unless customer',
        "     customer",
      ]),
    ],
    points: [
      {
        subject: "email",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
        sink: SensitiveDataSink.Exception,
      },
    ],
  },
  {
    id: "sentry-user-and-extra",
    title: "Report checkout failures to Sentry",
    files: [
      changedFile("web/src/checkout/pay.ts", 60, [
        "   } catch (error) {",
        "+    Sentry.setUser({ id: customer.id, email: customer.email });",
        "+    Sentry.captureException(error, { extra: { cardNumber } });",
        "     throw error;",
      ]),
    ],
    points: [
      {
        subject: "email",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
        sink: SensitiveDataSink.Exception,
      },
      {
        subject: "cardNumber",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: true,
        sink: SensitiveDataSink.Exception,
      },
    ],
    ai: {
      keeps: { email: true, cardNumber: true },
    },
  },
  {
    id: "sentry-scope-tag-ssn",
    title: "Tag applicant errors",
    files: [
      changedFile("api/applicants.js", 8, [
        " Sentry.withScope((scope) => {",
        '+  scope.setTag("ssn", applicant.ssn);',
        "   Sentry.captureException(error);",
        " });",
      ]),
    ],
    points: [
      {
        subject: "ssn",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: true,
        sink: SensitiveDataSink.Exception,
      },
    ],
  },
  {
    id: "sentry-capture-alone",
    title: "Report payment failures",
    files: [
      changedFile("web/src/checkout/pay.ts", 60, [
        "   } catch (error) {",
        "+    Sentry.captureException(error);",
        "     throw error;",
      ]),
    ],
    points: [],
  },
  {
    id: "span-record-exception-with-attribute",
    title: "Record failed sign-ins on the span",
    files: [
      changedFile("auth/signin.py", 22, [
        "     except AuthError as error:",
        '+        span.record_exception(error, attributes={"user.email": email})',
        "         raise",
      ]),
    ],
    points: [
      {
        subject: "user.email",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
        sink: SensitiveDataSink.Exception,
      },
    ],
  },
  {
    id: "react-state-named-like-a-tracker",
    title: "Keep the signed-in user in state",
    files: [
      changedFile("web/src/profile/Profile.tsx", 14, [
        "   const [user, setUser] = useState<User | null>(null);",
        "+  const save = (email: string): void => setUser({ ...user, email });",
      ]),
    ],
    points: [],
  },
];

/*
 * A web application's front end (#11395): who it tells its session
 * recorder or product analytics SDK the session's user is, and what its
 * browser logs. An email as the user, or among the user's traits, is a
 * point; an opaque id - the user's id, a hash - is none.
 */
const FRONT_END: Array<PullRequestEvalDiff> = [
  {
    id: "session-identified-by-email",
    title: "Identify recorded sessions",
    files: [
      changedFile("web/src/session.ts", 12, [
        " export function startSession(customer: Customer): void {",
        "+  OneUptimeReplay.identify(customer.email, { plan: customer.plan });",
        " }",
      ]),
    ],
    points: [
      {
        subject: "customer.email",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
        sink: SensitiveDataSink.Session,
      },
    ],
  },
  {
    id: "session-identified-by-user-id",
    title: "Identify recorded sessions by the user's id",
    files: [
      changedFile("web/src/session.ts", 12, [
        " export function startSession(customer: Customer): void {",
        "+  OneUptimeReplay.identify(customer.id, { plan: customer.plan });",
        " }",
      ]),
    ],
    points: [],
  },
  {
    id: "datadog-rum-user-with-email",
    title: "Tell Datadog RUM who the user is",
    files: [
      addedFile("web/src/rum.ts", [
        'import { datadogRum } from "@datadog/browser-rum";',
        "",
        "export function identifyUser(user: User): void {",
        "  datadogRum.setUser({ id: user.id, name: user.name, email: user.email });",
        "}",
      ]),
    ],
    points: [
      {
        subject: "email",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
        sink: SensitiveDataSink.Session,
      },
    ],
  },
  {
    id: "fullstory-identity-with-email",
    title: "Identify FullStory sessions",
    files: [
      addedFile("web/src/fullstory.js", [
        "export function identifyForFullStory(user) {",
        '  FS("setIdentity", { uid: user.id, properties: { displayName: user.name, email: user.email } });',
        "}",
      ]),
    ],
    points: [
      {
        subject: "email",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
        sink: SensitiveDataSink.Session,
      },
    ],
  },
  {
    id: "replay-queue-identified-by-email",
    title: "Identify the session before the recorder loads",
    files: [
      addedFile("web/public/identify.js", [
        "(window.OneUptimeReplayQueue = window.OneUptimeReplayQueue || []).push([",
        '  "identify",',
        "  window.currentUser.email,",
        "  { plan: window.currentUser.plan },",
        "]);",
      ]),
    ],
    points: [
      {
        subject: "window.currentUser.email",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
        sink: SensitiveDataSink.Session,
      },
    ],
  },
  {
    id: "posthog-identified-by-a-hash",
    title: "Identify product analytics users by a hash",
    files: [
      changedFile("web/src/analytics.ts", 30, [
        "   if (user) {",
        "+    posthog.identify(sha256(user.email), { plan: user.plan });",
        "   }",
      ]),
    ],
    points: [],
  },
  {
    id: "react-state-named-like-an-identify",
    title: "Keep the signed-in user's id in state",
    files: [
      changedFile("web/src/profile/Account.tsx", 8, [
        "   const [userId, setUserId] = useState<string | null>(null);",
        "+  useEffect(() => setUserId(account.email), [account]);",
      ]),
    ],
    points: [],
  },
  {
    id: "browser-log-with-email",
    title: "Log declined payments in the browser",
    files: [
      changedFile("web/src/checkout/payment.js", 6, [
        "   if (cart.total > customer.limit) {",
        '+    logger.warn("Payment declined", { "user.email": customer.email, "cart.total": cart.total });',
        "     return { paid: false };",
      ]),
    ],
    points: [
      {
        subject: "user.email",
        checkId: "sensitive-data-in-telemetry",
        isBlocking: false,
        sink: SensitiveDataSink.Log,
      },
    ],
  },
];

const MIGRATIONS: Array<PullRequestEvalDiff> = [
  {
    id: "migration-customer-ssn",
    title: "Store customers' SSNs for tax forms",
    files: [
      addedFile("db/migrations/20261120_add_customer_ssn.sql", [
        "ALTER TABLE customers ADD COLUMN customer_ssn VARCHAR(11);",
      ]),
    ],
    points: [
      {
        subject: "customer_ssn",
        checkId: "new-personal-data-column",
        isBlocking: false,
        where: "customers",
      },
    ],
    ai: {
      keeps: { customer_ssn: true },
      fixMentions: [["encrypt", "token", "need", "must"]],
    },
  },
  /*
   * The table a column is added to, in each ORM's own way of naming it
   * (#10779): what a private repository's review asks Data Security of.
   */
  {
    id: "rails-create-table-with-ssn",
    title: "Keep customers' SSNs for tax forms",
    files: [
      addedFile("db/migrate/20261124090000_create_tax_profiles.rb", [
        "class CreateTaxProfiles < ActiveRecord::Migration[7.1]",
        "  def change",
        "    create_table :tax_profiles do |t|",
        "      t.references :customer",
        "      t.string :customer_ssn",
        "      t.timestamps",
        "    end",
        "  end",
        "end",
      ]),
    ],
    points: [
      {
        subject: "customer_ssn",
        checkId: "new-personal-data-column",
        isBlocking: false,
        where: "tax_profiles",
      },
    ],
  },
  {
    id: "django-add-field-date-of-birth",
    title: "Ask for a date of birth at sign-up",
    files: [
      addedFile("accounts/migrations/0007_customer_date_of_birth.py", [
        "from django.db import migrations, models",
        "",
        "",
        "class Migration(migrations.Migration):",
        '    dependencies = [("accounts", "0006_customer_plan")]',
        "",
        "    operations = [",
        "        migrations.AddField(",
        '            model_name="customer",',
        '            name="date_of_birth",',
        "            field=models.DateField(null=True),",
        "        ),",
        "    ]",
      ]),
    ],
    points: [
      {
        subject: "date_of_birth",
        checkId: "new-personal-data-column",
        isBlocking: false,
        where: "accounts_customer",
      },
    ],
  },
  {
    id: "knex-alter-table-billing-email",
    title: "Send invoices to a billing address",
    files: [
      addedFile("migrations/20261124_billing_email.js", [
        "exports.up = async (knex) => {",
        '  await knex.schema.alterTable("orders", (table) => {',
        '    table.string("billing_email");',
        "  });",
        "};",
        "",
        "exports.down = async (knex) => {",
        '  await knex.schema.alterTable("orders", (table) => {',
        '    table.dropColumn("billing_email");',
        "  });",
        "};",
      ]),
    ],
    points: [
      {
        subject: "billing_email",
        checkId: "new-personal-data-column",
        isBlocking: false,
        where: "orders",
      },
    ],
  },
  {
    id: "ecto-alter-table-ssn",
    title: "Store SSNs for payroll",
    files: [
      addedFile(
        "priv/repo/migrations/20261124100000_add_ssn_to_employees.exs",
        [
          "defmodule Payroll.Repo.Migrations.AddSsnToEmployees do",
          "  use Ecto.Migration",
          "",
          "  def change do",
          "    alter table(:employees) do",
          "      add :ssn, :string",
          "    end",
          "  end",
          "end",
        ],
      ),
    ],
    points: [
      {
        subject: "ssn",
        checkId: "new-personal-data-column",
        isBlocking: false,
        where: "employees",
      },
    ],
  },
  {
    id: "liquibase-add-column-phone",
    title: "Call customers about failed deliveries",
    files: [
      addedFile("db/changelog/2026-11-24-add-phone.xml", [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<databaseChangeLog>",
        '  <changeSet id="42" author="dana">',
        '    <addColumn tableName="customers">',
        '      <column name="phone_number" type="varchar(20)"/>',
        "    </addColumn>",
        "  </changeSet>",
        "</databaseChangeLog>",
      ]),
    ],
    points: [
      {
        subject: "phone_number",
        checkId: "new-personal-data-column",
        isBlocking: false,
        where: "customers",
      },
    ],
  },
  {
    id: "entity-framework-add-column-ssn",
    title: "Store SSNs for tax forms",
    files: [
      addedFile("src/Acme.Data/Migrations/20261124_AddCustomerSsn.cs", [
        "public partial class AddCustomerSsn : Migration",
        "{",
        "    protected override void Up(MigrationBuilder migrationBuilder)",
        "    {",
        "        migrationBuilder.AddColumn<string>(",
        '            name: "Ssn",',
        '            table: "Customers",',
        "            nullable: true);",
        "    }",
        "}",
      ]),
    ],
    points: [
      {
        subject: "Ssn",
        checkId: "new-personal-data-column",
        isBlocking: false,
        where: "Customers",
      },
    ],
  },
  {
    id: "migration-password-hash-with-bcrypt",
    title: "Hash passwords with bcrypt",
    files: [
      addedFile("db/migrate/20261120_add_password_hash.rb", [
        "class AddPasswordHash < ActiveRecord::Migration[7.1]",
        "  def change",
        "    add_column :users, :password_hash, :string",
        "  end",
        "end",
      ]),
      addedFile("app/models/user.rb", [
        "class User < ApplicationRecord",
        "  def password=(value)",
        "    self.password_hash = BCrypt::Password.create(value)",
        "  end",
        "end",
      ]),
    ],
    points: [],
  },
  {
    id: "migration-plaintext-password",
    title: "Add a password to API users",
    isFailOn: true,
    files: [
      addedFile("db/migrations/2026_11_20_add_api_password.py", [
        "def upgrade():",
        "    op.add_column('api_users', sa.Column('password', sa.String(255)))",
        "",
        "def downgrade():",
        "    op.drop_column('api_users', 'password')",
      ]),
    ],
    points: [
      {
        subject: "password",
        checkId: "plaintext-passwords",
        isBlocking: true,
      },
    ],
  },
  {
    id: "model-card-security-code",
    title: "Remember cards for one-click checkout",
    files: [
      addedFile("payments/models.py", [
        "class SavedCard(models.Model):",
        "    card_number = models.CharField(max_length=19)",
        "    cvv = models.CharField(max_length=4)",
        "    card_last4 = models.CharField(max_length=4)",
      ]),
    ],
    points: [
      {
        subject: "cvv",
        checkId: "card-security-codes-stored",
        isBlocking: true,
      },
      {
        subject: "card_number",
        checkId: "card-numbers-readable",
        isBlocking: false,
      },
    ],
  },
  {
    id: "prisma-date-of-birth",
    title: "Ask for a date of birth",
    files: [
      changedFile("prisma/schema.prisma", 12, [
        " model Customer {",
        "   id          String   @id",
        "+  dateOfBirth DateTime",
        "+  nickname    String",
        " }",
      ]),
    ],
    points: [
      {
        subject: "dateOfBirth",
        checkId: "new-personal-data-column",
        isBlocking: false,
      },
    ],
  },
  {
    id: "typeorm-entity-email",
    title: "Store a billing email",
    files: [
      changedFile("src/entities/Account.entity.ts", 20, [
        "   @Column()",
        "   public name!: string;",
        "+",
        "+  @Column({ nullable: true })",
        "+  public billingEmail?: string;",
      ]),
    ],
    points: [
      {
        subject: "billingEmail",
        checkId: "new-personal-data-column",
        isBlocking: false,
      },
    ],
  },
  {
    id: "migration-down-step-only",
    title: "Drop a column",
    files: [
      addedFile("migrations/20261120-drop-legacy.js", [
        "module.exports = {",
        "  up: async (queryInterface) => {",
        "    await queryInterface.removeColumn('users', 'legacy');",
        "  },",
        "  down: async (queryInterface, Sequelize) => {",
        "    await queryInterface.addColumn('users', 'ssn', { type: Sequelize.STRING });",
        "  },",
        "};",
      ]),
    ],
    points: [],
  },
];

export const PULL_REQUEST_EVAL_DIFFS: ReadonlyArray<PullRequestEvalDiff> = [
  ...TELEMETRY,
  ...EXCEPTIONS,
  ...FRONT_END,
  ...INFRASTRUCTURE,
  ...MIGRATIONS,
];

export default PULL_REQUEST_EVAL_DIFFS;
