import {
  findSensitiveColumns,
  isCardSecurityCodeName,
  isModelPath,
  isPlaintextPasswordName,
  readNewColumns,
} from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/MigrationRules";
import { SensitiveDataCandidate } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataCandidate";
import { SensitiveNameMatcher } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataNames";
import {
  readNewLines,
  readPatchLines,
} from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataPatch";
import {
  SensitiveDataColumn,
  SensitiveDataLeakKind,
} from "../../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import DataSensitivity from "../../../../../../Types/DataSecurity/DataSensitivity";
import { fastestRun, FastestRun } from "../../../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A CHANGE'S MIGRATIONS AND MODELS ADD (#10376): a column whose name
 * says it holds personal data, a password stored as it is, card numbers
 * readable to whoever reads the table, a card's security code - in SQL and
 * in each ORM's own way of declaring one - each a point at the line that
 * adds it.
 */

const matcher: SensitiveNameMatcher = new SensitiveNameMatcher();

function patchOf(lines: Array<string>): string {
  return [
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line: string): string => {
      return `+${line}`;
    }),
  ].join("\n");
}

function columnsIn(
  path: string,
  lines: Array<string>,
  hashesPasswords: boolean = false,
): Array<SensitiveDataCandidate> {
  return findSensitiveColumns({
    path,
    lines: readPatchLines(patchOf(lines)),
    matcher,
    hashesPasswords,
  });
}

function subjectsIn(path: string, lines: Array<string>): Array<string> {
  return columnsIn(path, lines).map((point: SensitiveDataCandidate): string => {
    return point.subject;
  });
}

describe("a migration adding customer_ssn", () => {
  test("is a point: a column for a US Social Security number, at its line, of its table", () => {
    const points: Array<SensitiveDataCandidate> = columnsIn(
      "db/migrate/20261120_add_ssn_to_customers.rb",
      [
        "class AddSsnToCustomers < ActiveRecord::Migration[7.1]",
        "  def change",
        "    add_column :customers, :customer_ssn, :string",
        "  end",
        "end",
      ],
    );

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      kind: SensitiveDataLeakKind.Migration,
      checkId: "new-personal-data-column",
      column: SensitiveDataColumn.PersonalData,
      line: 3,
      subject: "customer_ssn",
      where: "customers",
      sensitivity: DataSensitivity.Restricted,
      isBlocking: false,
      text: "Adds the column `customer_ssn` to `customers`, whose name says it holds a US Social Security number.",
    });
    expect(points[0]!.fix).toContain("encrypted or tokenized");
  });
});

describe("a password column", () => {
  const lines: Array<string> = [
    "def upgrade():",
    "    op.add_column('api_users', sa.Column('password', sa.String(255)))",
  ];

  test("stored as it is, with nothing in the change hashing it: it can fail the check", () => {
    const points: Array<SensitiveDataCandidate> = columnsIn(
      "db/migrations/2026_11_20_add_api_password.py",
      lines,
    );

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      checkId: "plaintext-passwords",
      column: SensitiveDataColumn.PlaintextPassword,
      subject: "password",
      where: "api_users",
      isBlocking: true,
    });
    expect(points[0]!.text).toContain("stored as it is");
    expect(points[0]!.fix).toContain("password_hash");
  });

  test("beside a change that hashes passwords: a question about its name, not a failure", () => {
    const points: Array<SensitiveDataCandidate> = columnsIn(
      "db/migrations/2026_11_20_add_api_password.py",
      lines,
      true,
    );

    expect(points).toHaveLength(1);
    expect(points[0]!.isBlocking).toBe(false);
    expect(points[0]!.text).toContain("name it as one");
  });

  test("password_hash, with bcrypt: none", () => {
    expect(
      subjectsIn("db/migrate/20261120_add_password_hash.rb", [
        "class AddPasswordHash < ActiveRecord::Migration[7.1]",
        "  def change",
        "    add_column :users, :password_hash, :string",
        "  end",
        "end",
      ]),
    ).toEqual([]);
  });

  test.each([
    ["password", true],
    ["user_password", true],
    ["passwd", true],
    ["password_hash", false],
    ["hashed_password", false],
    ["encrypted_password", false],
    ["password_digest", false],
    ["password_reset_token", false],
    ["password_changed_at", false],
  ])("%s is a plain password: %s", (name: string, isPlain: boolean) => {
    expect(isPlaintextPasswordName(name)).toBe(isPlain);
  });
});

describe("card data", () => {
  test("a model's card number and card security code; its last four digits are none", () => {
    const points: Array<SensitiveDataCandidate> = columnsIn(
      "payments/models.py",
      [
        "class SavedCard(models.Model):",
        "    card_number = models.CharField(max_length=19)",
        "    cvv = models.CharField(max_length=4)",
        "    card_last4 = models.CharField(max_length=4)",
      ],
    );

    expect(
      points.map((point: SensitiveDataCandidate) => {
        return {
          subject: point.subject,
          checkId: point.checkId,
          isBlocking: point.isBlocking,
        };
      }),
    ).toEqual([
      {
        subject: "card_number",
        checkId: "card-numbers-readable",
        isBlocking: false,
      },
      {
        subject: "cvv",
        checkId: "card-security-codes-stored",
        isBlocking: true,
      },
    ]);
  });

  test.each([
    ["cvv", true],
    ["cvc", true],
    ["card_cvv", true],
    ["card_security_code", true],
    ["cvv2", true],
    ["security_code", false],
    ["cvv_checked", false],
  ])("%s is a card's security code: %s", (name: string, isCode: boolean) => {
    expect(isCardSecurityCodeName(name)).toBe(isCode);
  });
});

describe("each way a column is declared", () => {
  test.each([
    [
      "SQL, ALTER TABLE",
      "db/migrations/V12__add_email.sql",
      ["ALTER TABLE customers ADD COLUMN email VARCHAR(255);"],
      ["email"],
    ],
    [
      "SQL, CREATE TABLE across lines",
      "migrations/0007_patients.sql",
      [
        "CREATE TABLE patients (",
        "  id SERIAL PRIMARY KEY,",
        "  date_of_birth DATE NOT NULL,",
        "  phone_number TEXT",
        ");",
      ],
      ["date_of_birth", "phone_number"],
    ],
    [
      "Rails, create_table",
      "db/migrate/20261120_create_contacts.rb",
      [
        "create_table :contacts do |t|",
        "  t.string :email",
        "  t.integer :age",
        "end",
      ],
      ["email"],
    ],
    [
      "Django, AddField",
      "app/migrations/0012_customer_phone.py",
      [
        "migrations.AddField(",
        "    model_name='customer',",
        "    name='phone_number',",
        "    field=models.CharField(max_length=20),",
        "),",
      ],
      ["phone_number"],
    ],
    [
      "SQLAlchemy, a model",
      "app/models/customer.py",
      [
        "class Customer(Base):",
        "    email: Mapped[str] = mapped_column(String(255))",
        "    plan = Column(String(20))",
      ],
      ["email"],
    ],
    [
      "Sequelize",
      "migrations/20261120-add-email.js",
      [
        "await queryInterface.addColumn('customers', 'email', {",
        "  type: Sequelize.STRING,",
        "});",
      ],
      ["email"],
    ],
    [
      "TypeORM, an entity",
      "src/customer/customer.entity.ts",
      [
        "  @Column()",
        "  email: string;",
        "",
        "  @Column({ nullable: true }) plan: string;",
      ],
      ["email"],
    ],
    [
      "Prisma",
      "prisma/schema.prisma",
      [
        "model Customer {",
        "  id          Int      @id",
        "  dateOfBirth DateTime",
        "}",
      ],
      ["dateOfBirth"],
    ],
  ])(
    "%s",
    (
      _how: string,
      path: string,
      lines: Array<string>,
      subjects: Array<string>,
    ) => {
      expect(subjectsIn(path, lines)).toEqual(subjects);
    },
  );

  test("a migration's down step undoes it: nothing from there on is read", () => {
    expect(
      subjectsIn("db/migrations/2026_11_20_email.py", [
        "def upgrade():",
        "    op.add_column('customers', sa.Column('plan', sa.String(20)))",
        "",
        "def downgrade():",
        "    op.add_column('customers', sa.Column('email', sa.String(255)))",
      ]),
    ).toEqual([]);
  });

  test("a column marked not sensitive is none", () => {
    expect(
      subjectsIn("db/migrations/V13__support_email.sql", [
        "-- oneuptime:not-sensitive: the support inbox's address, not a person's",
        "ALTER TABLE settings ADD COLUMN support_email TEXT;",
      ]),
    ).toEqual([]);
  });

  test("a file that is neither a migration nor a model is not read", () => {
    expect(
      subjectsIn("src/signup.ts", ["const customer_ssn = form.ssn;"]),
    ).toEqual([]);
  });

  test("a line a hunk only shows is not new", () => {
    expect(
      readNewColumns(
        readNewLines(
          readPatchLines(
            [
              "@@ -1,2 +1,2 @@",
              " ALTER TABLE customers ADD COLUMN email TEXT;",
              "+ALTER TABLE customers ADD COLUMN plan TEXT;",
            ].join("\n"),
          ),
        ),
      ).map((column: { column: string }): string => {
        return column.column;
      }),
    ).toEqual(["plan"]);
  });

  test.each([
    ["app/models.py", true],
    ["prisma/schema.prisma", true],
    ["src/users/user.entity.ts", true],
    ["app/models/user.rb", true],
    ["src/services/user.ts", false],
  ])("%s is a model: %s", (path: string, isModel: boolean) => {
    expect(isModelPath(path)).toBe(isModel);
  });
});

describe("time in line with the change, whatever it holds", () => {
  test.each([
    ["an open CREATE TABLE", "CREATE TABLE a (", `${"x ".repeat(400)}`],
    ["add_column with no end", "add_column :a, :b", `${":".repeat(900)}`],
    ["Column( with no name", "sa.Column(", `${"'".repeat(900)}`],
  ])("%s", (_what: string, first: string, rest: string) => {
    const lines: Array<string> = [];

    for (let index: number = 0; index < 1000; index++) {
      lines.push(`${first}${rest}`);
    }

    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        return columnsIn("db/migrations/V1__x.sql", lines).length;
      },
      limitInMs: 3000,
    });

    expect(run.inMs).toBeLessThan(3000);
  });
});
