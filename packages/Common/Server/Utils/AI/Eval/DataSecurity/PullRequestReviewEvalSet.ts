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
export function addedFile(filename: string, lines: Array<string>): EvalDiffFile {
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
      },
    ],
    ai: {
      keeps: { customer_ssn: true },
      fixMentions: [["encrypt", "token", "need", "must"]],
    },
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
  ...INFRASTRUCTURE,
  ...MIGRATIONS,
];

export default PULL_REQUEST_EVAL_DIFFS;
