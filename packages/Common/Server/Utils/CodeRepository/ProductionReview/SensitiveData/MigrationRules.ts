import {
  CARD_NUMBERS_READABLE_CHECK_ID,
  CARD_SECURITY_CODES_STORED_CHECK_ID,
  NEW_PERSONAL_DATA_COLUMN_CHECK_ID,
  PLAINTEXT_PASSWORDS_CHECK_ID,
  SENSITIVE_DATA_LIMITS,
  SensitiveDataColumn,
  SensitiveDataLeakKind,
} from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import DataCategory from "../../../../../Types/DataSecurity/DataCategory";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import { getBuiltInDataType } from "../../../../../Types/DataSecurity/DataTypeCatalog";
import { DOWN_STEP, isMigrationPath } from "../ProductionReviewDataImpact";
import { SensitiveDataCandidate } from "./SensitiveDataCandidate";
import {
  highestSensitivity,
  isHeadOf,
  NamedDataType,
  SensitiveNameMatcher,
} from "./SensitiveDataNames";
import {
  extensionOf,
  fileNameOfPath,
  isMarkedNotSensitive,
  PatchLine,
  PatchLineKind,
  readNewLines,
} from "./SensitiveDataPatch";
import { describeDataType } from "./SensitiveDataWords";

/*
 * MIGRATIONS AND MODELS THAT ADD A COLUMN OF SENSITIVE DATA (#10376).
 *
 * Data Security finds a new column of personal data, a password stored as
 * it is, and card numbers or security codes once a store's content scan
 * reads them - after the migration ran and the table filled. A pull
 * request shows the column first, by its name, in the migration that adds
 * it or the model that declares it: SQL (CREATE TABLE, ALTER TABLE ...
 * ADD), Rails, Django, Alembic and SQLAlchemy, Sequelize, TypeORM, Knex,
 * Prisma, Ecto, Entity Framework and Liquibase.
 *
 * Each new column's name is read as a name in code is
 * (SensitiveNameMatcher), and is a point when it is:
 *
 *   - a password, with nothing in its name that says it is hashed:
 *     `password` is one, `password_hash`, `password_digest` and
 *     `encrypted_password` are not. A change that hashes passwords itself
 *     (bcrypt, Argon2, scrypt, PBKDF2) makes it a question, not a failure;
 *   - a card's security code, which PCI DSS says may never be stored;
 *   - a card number;
 *   - any other kind of personal data the catalog or the project's own
 *     types name: `customer_ssn`, `date_of_birth`, `email`.
 *
 * Only what a migration does is read: its down step, which undoes it, is
 * left out, as Data Observability's section leaves it out.
 */

// The words of a password's name, and of one that says it is hashed.
const PASSWORD_HINTS: ReadonlyArray<ReadonlyArray<string>> = [
  ["password"],
  ["passwd"],
  ["pwd"],
  ["passphrase"],
  ["pass", "phrase"],
];

const HASHED_WORDS: ReadonlySet<string> = new Set<string>([
  "hash",
  "hashed",
  "digest",
  "crypt",
  "crypted",
  "encrypted",
  "enc",
  "bcrypt",
  "scrypt",
  "argon",
  "argon2",
  "pbkdf2",
  "salt",
  "salted",
  "sha",
  "sha256",
  "sha512",
  "hmac",
]);

/*
 * What a change that hashes passwords writes: a column named `password` is
 * then likely a hash, and a question rather than a failure.
 */
export const PASSWORD_HASHING_MARKERS: ReadonlyArray<string> = [
  "bcrypt",
  "argon2",
  "scrypt",
  "pbkdf2",
  "password_hash(",
  "hashpw(",
  "make_password(",
  "has_secure_password",
  "devise",
  "passwordhasher",
  "hashpassword(",
  "hash_password(",
  "generate_password_hash(",
  "check_password_hash(",
  "password_verify(",
];

// The card security code's own names: a "security code" alone may be a sign-in code.
const CARD_SECURITY_CODE_HINTS: ReadonlyArray<ReadonlyArray<string>> = [
  ["cvv"],
  ["cvc"],
  ["cvv2"],
  ["cvv", "2"],
  ["card", "verification"],
  ["card", "security", "code"],
];

const CARD_NUMBER_TYPE_ID: string = "credit-card-number";
const CARD_SECURITY_CODE_TYPE_ID: string = "card-verification-code";
const GENERIC_SECRET_TYPE_ID: string = "generic-secret";

// The SQL words a CREATE TABLE line starts with that are no column.
const NOT_COLUMN_WORDS: ReadonlySet<string> = new Set<string>([
  "constraint",
  "primary",
  "foreign",
  "unique",
  "check",
  "index",
  "key",
  "exclude",
  "like",
  "period",
  "fulltext",
  "spatial",
]);

// Rails' column types: t.string :ssn.
const RAILS_COLUMN_TYPES: ReadonlySet<string> = new Set<string>([
  "string",
  "text",
  "integer",
  "bigint",
  "float",
  "decimal",
  "numeric",
  "date",
  "datetime",
  "time",
  "timestamp",
  "boolean",
  "binary",
  "json",
  "jsonb",
  "uuid",
  "citext",
  "column",
  "inet",
]);

// A new column a line adds: its name, and the table it is added to when known.
export interface NewColumn {
  column: string;
  table: string | null;
}

/*
 * The column a line declares, in the ORM languages, each one line: none for
 * a line that declares none. SQL is read across lines (readSqlColumns).
 */
const LINE_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  read: (match: RegExpMatchArray) => NewColumn | null;
}> = [
  // Rails: add_column :customers, :ssn, :string
  {
    pattern:
      /\badd_column\s{0,10}\(?\s{0,10}:?["']?(\w{1,120})["']?\s{0,10},\s{0,10}:?["']?(\w{1,120})/,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: match[1]!, column: match[2]! };
    },
  },
  // Rails' create_table block: t.string :ssn
  {
    pattern: /\bt\.(\w{1,30})\s{0,10}\(?\s{0,10}:?["']?(\w{1,120})/,
    read: (match: RegExpMatchArray): NewColumn | null => {
      return RAILS_COLUMN_TYPES.has(match[1]!.toLowerCase())
        ? { table: null, column: match[2]! }
        : null;
    },
  },
  // Django: ssn = models.CharField(...)
  {
    pattern: /^\s{0,40}(\w{1,120})\s{0,10}=\s{0,10}models\.\w{1,40}Field\(/,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: null, column: match[1]! };
    },
  },
  // Django's CreateModel: ("ssn", models.CharField(...))
  {
    pattern:
      /\(\s{0,10}["'](\w{1,120})["']\s{0,10},\s{0,10}models\.\w{1,40}Field\(/,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: null, column: match[1]! };
    },
  },
  // Alembic and SQLAlchemy: sa.Column("ssn", ...), Column('ssn', ...)
  {
    pattern: /\bColumn\(\s{0,10}["'](\w{1,120})["']/,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: null, column: match[1]! };
    },
  },
  // SQLAlchemy's models: ssn = Column(...), ssn: Mapped[str] = mapped_column(...)
  {
    pattern:
      /^\s{0,40}(\w{1,120})\s{0,10}(?::\s{0,10}Mapped\[[^\]\n]{0,120}\]\s{0,10})?=\s{0,10}(?:db\.|sa\.|sqlalchemy\.)?(?:Column|mapped_column)\(/,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: null, column: match[1]! };
    },
  },
  // Sequelize: queryInterface.addColumn("customers", "ssn", {...})
  {
    pattern:
      /\baddColumn\(\s{0,10}["'`](\w{1,120})["'`]\s{0,10},\s{0,10}["'`](\w{1,120})["'`]/,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: match[1]!, column: match[2]! };
    },
  },
  // Sequelize's attributes: ssn: { type: DataTypes.STRING }, ssn: Sequelize.STRING
  {
    pattern:
      /^\s{0,40}["']?(\w{1,120})["']?\s{0,10}:\s{0,10}(?:\{\s{0,10}type\s{0,10}:\s{0,10})?(?:DataTypes|Sequelize|DataType)\.[A-Z]\w{0,40}/,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: null, column: match[1]! };
    },
  },
  // TypeORM's migrations: new TableColumn({ name: "ssn", type: "varchar" })
  {
    pattern: /\bname\s{0,10}:\s{0,10}["'`](\w{1,120})["'`]\s{0,10},\s{0,10}type\s{0,10}:/,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: null, column: match[1]! };
    },
  },
  // Knex: table.string("ssn")
  {
    pattern:
      /\b(?:table|t)\.(?:string|text|integer|bigInteger|boolean|date|dateTime|datetime|timestamp|decimal|float|double|json|jsonb|uuid|binary|enu|enum|specificType|char|varchar)\(\s{0,10}["'`](\w{1,120})["'`]/,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: null, column: match[1]! };
    },
  },
  // Prisma: ssn String, in a model
  {
    pattern:
      /^\s{0,40}(\w{1,120})\s{1,40}(?:String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)\b/,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: null, column: match[1]! };
    },
  },
  // Ecto: add :ssn, :string - field :ssn, :string
  {
    pattern: /\b(?:add|field)\s{1,10}:(\w{1,120})\s{0,10},\s{0,10}:\w{1,40}/,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: null, column: match[1]! };
    },
  },
  // Entity Framework's migrations: Ssn = table.Column<string>(...)
  {
    pattern: /\b(\w{1,120})\s{0,10}=\s{0,10}table\.Column</,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: null, column: match[1]! };
    },
  },
  // Entity Framework: migrationBuilder.AddColumn<string>(name: "Ssn", table: "Customers")
  {
    pattern: /\bAddColumn<\w{1,40}>\(\s{0,20}name:\s{0,10}"(\w{1,120})"/,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: null, column: match[1]! };
    },
  },
  // Liquibase: <column name="ssn" type="varchar(11)"/>
  {
    pattern: /<column\b[^>\n]{0,200}\bname\s{0,5}=\s{0,5}"(\w{1,120})"/,
    read: (match: RegExpMatchArray): NewColumn => {
      return { table: null, column: match[1]! };
    },
  },
];

// The words a property's declaration may start with: TypeORM's columns.
const PROPERTY_MODIFIERS: ReadonlySet<string> = new Set<string>([
  "public",
  "private",
  "protected",
  "readonly",
  "declare",
  "override",
]);

/*
 * The name a class property declares (`public ssn?: string`), read word by
 * word: null for a line that declares none.
 */
export function readPropertyName(text: string): string | null {
  const words: Array<string> = text.trim().split(" ").filter(Boolean);

  for (const word of words) {
    if (PROPERTY_MODIFIERS.has(word)) {
      continue;
    }

    let name: string = "";

    for (const character of word) {
      const code: number = character.charCodeAt(0);
      const isNameCharacter: boolean =
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        code === 0x5f;

      if (!isNameCharacter) {
        break;
      }

      name += character;
    }

    const rest: string = word.slice(name.length);

    if (
      name &&
      name.length <= 120 &&
      (rest.startsWith(":") || rest.startsWith("?:") || rest.startsWith("!:"))
    ) {
      return name;
    }

    return null;
  }

  return null;
}

// A name as SQL writes it - bare, or in "", `` or [] - and where it ends.
function readSqlName(
  text: string,
  from: number,
): { name: string; end: number } | null {
  let index: number = from;

  while (index < text.length && (text.charAt(index) === " " || text.charAt(index) === "\t")) {
    index++;
  }

  const open: string = text.charAt(index);
  const close: string = open === "[" ? "]" : open;

  if (open === '"' || open === "`" || open === "[") {
    const end: number = text.indexOf(close, index + 1);

    if (end < 0 || end - index > 121) {
      return null;
    }

    return { name: text.slice(index + 1, end), end: end + 1 };
  }

  let end: number = index;

  while (end < text.length && end - index <= 120) {
    const code: number = text.charCodeAt(end);
    const isNameCharacter: boolean =
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      code === 0x5f ||
      code === 0x24;

    if (!isNameCharacter) {
      break;
    }

    end++;
  }

  return end > index ? { name: text.slice(index, end), end } : null;
}

// A table's name after CREATE TABLE or ALTER TABLE: its last part, schema left off.
function readTableName(text: string, from: number): { name: string; end: number } | null {
  let index: number = from;
  const lower: string = text.toLowerCase();

  for (const skip of ["if not exists", "if exists", "only"]) {
    const at: number = lower.indexOf(skip, index);

    if (at >= 0 && lower.slice(index, at).trim() === "") {
      index = at + skip.length;
    }
  }

  let read: { name: string; end: number } | null = readSqlName(text, index);

  while (read && text.charAt(read.end) === ".") {
    const next: { name: string; end: number } | null = readSqlName(text, read.end + 1);

    if (!next) {
      break;
    }

    read = next;
  }

  return read;
}

/*
 * A CREATE TABLE's column definitions on one line, at the table's own
 * depth: each segment between commas that starts with a name and a type.
 */
function readColumnDefinitions(
  text: string,
  startDepth: number,
): { columns: Array<string>; depth: number } {
  const columns: Array<string> = [];
  let depth: number = startDepth;
  let segment: string = "";
  let quote: string = "";

  const flush: () => void = (): void => {
    if (depth === 1) {
      const name: { name: string; end: number } | null = readSqlName(segment, 0);
      const rest: string = name ? segment.slice(name.end).trim() : "";

      if (
        name &&
        rest.length > 0 &&
        !NOT_COLUMN_WORDS.has(name.name.toLowerCase()) &&
        !name.name.startsWith("--")
      ) {
        columns.push(name.name);
      }
    }

    segment = "";
  };

  for (const character of text) {
    if (quote) {
      if (character === quote) {
        quote = "";
      }

      if (depth === 1) {
        segment += character;
      }

      continue;
    }

    if (character === "'") {
      quote = character;
    }

    if (character === "-" && segment.endsWith("-")) {
      // A comment: the rest of the line says nothing a database does.
      segment = segment.slice(0, -1);
      break;
    }

    if (character === "(") {
      depth++;
      continue;
    }

    if (character === ")") {
      if (depth === 1) {
        flush();
      }

      depth--;

      if (depth <= 0) {
        return { columns, depth: 0 };
      }

      continue;
    }

    if (character === "," && depth === 1) {
      flush();
      continue;
    }

    if (depth === 1) {
      segment += character;
    }
  }

  if (depth === 1 && segment.trim()) {
    flush();
  }

  return { columns, depth };
}

/*
 * The columns SQL adds, line by line, with the line each is on: a CREATE
 * TABLE's definitions, across the lines its parentheses span, and each
 * ALTER TABLE ... ADD [COLUMN].
 */
export function readSqlColumns(
  texts: ReadonlyArray<string>,
): Array<NewColumn & { line: number }> {
  const found: Array<NewColumn & { line: number }> = [];
  let createTable: string | null = null;
  let depth: number = 0;

  texts.forEach((text: string, line: number): void => {
    const lower: string = text.toLowerCase();

    if (createTable !== null) {
      const read: { columns: Array<string>; depth: number } = readColumnDefinitions(text, depth);

      for (const column of read.columns) {
        found.push({ column, table: createTable, line });
      }

      depth = read.depth;

      if (depth <= 0) {
        createTable = null;
      }

      return;
    }

    const create: number = lower.indexOf("create table");

    if (create >= 0) {
      const table: { name: string; end: number } | null = readTableName(
        text,
        create + "create table".length,
      );
      const open: number = table ? text.indexOf("(", table.end) : -1;

      if (table && open >= 0) {
        const read: { columns: Array<string>; depth: number } = readColumnDefinitions(
          text.slice(open + 1),
          1,
        );

        for (const column of read.columns) {
          found.push({ column, table: table.name, line });
        }

        if (read.depth > 0) {
          createTable = table.name;
          depth = read.depth;
        }
      } else if (table) {
        // CREATE TABLE customers on its own line, its "(" on the next.
        createTable = table.name;
        depth = 0;
      }

      return;
    }

    if (createTable === null) {
      const alter: number = lower.indexOf("alter table");

      if (alter < 0) {
        return;
      }

      const table: { name: string; end: number } | null = readTableName(
        text,
        alter + "alter table".length,
      );

      if (!table) {
        return;
      }

      let from: number = table.end;

      for (;;) {
        const add: number = lower.indexOf("add ", from);

        if (add < 0) {
          break;
        }

        let at: number = add + "add ".length;

        for (const skip of ["column ", "if not exists "]) {
          const rest: string = lower.slice(at).trimStart();

          if (rest.startsWith(skip)) {
            at = lower.length - rest.length + skip.length;
          }
        }

        const name: { name: string; end: number } | null = readSqlName(text, at);

        if (name && !NOT_COLUMN_WORDS.has(name.name.toLowerCase())) {
          found.push({ column: name.name, table: table.name, line });
        }

        from = name ? name.end : at;
      }
    }
  });

  // A CREATE TABLE whose "(" opens on its next line.
  return found;
}

// Whether the file declares a model: its columns are new ones when added.
export function isModelPath(path: string): boolean {
  const lower: string = path.toLowerCase();
  const name: string = fileNameOfPath(path);
  const extension: string = extensionOf(path);

  return (
    name === "models.py" ||
    name === "schema.prisma" ||
    extension === "prisma" ||
    name.endsWith(".entity.ts") ||
    name.endsWith(".entity.js") ||
    name.endsWith(".model.ts") ||
    name.endsWith(".model.js") ||
    (lower.includes("/models/") &&
      ["py", "rb", "ts", "js", "ex", "exs", "cs"].includes(extension)) ||
    (lower.includes("/migrations/") && extension === "cs")
  );
}

/*
 * The new columns of a file's added lines, each with its line in `newLines`:
 * the SQL ones, and those each ORM declares.
 */
export function readNewColumns(
  newLines: Array<PatchLine>,
): Array<NewColumn & { index: number }> {
  const columns: Array<NewColumn & { index: number }> = [];
  const added: Array<{ text: string; index: number }> = [];

  for (let index: number = 0; index < newLines.length; index++) {
    const line: PatchLine = newLines[index]!;

    if (line.kind !== PatchLineKind.Added) {
      continue;
    }

    // A migration's down step undoes it: nothing from there on is read.
    if (DOWN_STEP.test(line.text)) {
      break;
    }

    added.push({ text: line.text, index });
  }

  for (const sql of readSqlColumns(
    added.map((line: { text: string }): string => {
      return line.text;
    }),
  )) {
    columns.push({ column: sql.column, table: sql.table, index: added[sql.line]!.index });
  }

  let isAfterColumnDecorator: boolean = false;
  let addFieldLines: number = 0;

  for (const line of added) {
    const text: string = line.text;

    for (const linePattern of LINE_PATTERNS) {
      const match: RegExpMatchArray | null = text.match(linePattern.pattern);
      const column: NewColumn | null = match ? linePattern.read(match) : null;

      if (column) {
        columns.push({ ...column, index: line.index });
        break;
      }
    }

    // TypeORM: @Column(...) on its line, the property on the next.
    if (isAfterColumnDecorator) {
      const property: string | null = readPropertyName(text);

      if (property) {
        columns.push({ column: property, table: null, index: line.index });
        isAfterColumnDecorator = false;
      }
    }

    if (text.includes("@Column(") || text.includes("@PrimaryColumn(")) {
      const after: string = text.slice(text.indexOf(")") + 1);
      const property: string | null = readPropertyName(after);

      if (property) {
        columns.push({ column: property, table: null, index: line.index });
      } else {
        isAfterColumnDecorator = true;
      }
    }

    // Django's AddField: its name on one of the lines after it.
    if (text.includes("AddField(")) {
      addFieldLines = 6;
    } else if (addFieldLines > 0) {
      addFieldLines--;

      const name: RegExpMatchArray | null = text.match(
        /^\s{0,40}name\s{0,10}=\s{0,10}["'](\w{1,120})["']/,
      );

      if (name) {
        columns.push({ column: name[1]!, table: null, index: line.index });
        addFieldLines = 0;
      }
    }
  }

  // Each column once, the first line that names it.
  const seen: Set<string> = new Set<string>();

  return columns.filter((column: NewColumn & { index: number }): boolean => {
    const key: string = `${column.index}\u0000${column.column.toLowerCase()}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

// Whether a column's name is a password's, with nothing in it saying it is hashed.
export function isPlaintextPasswordName(name: string): boolean {
  const words: Array<string> = SensitiveNameMatcher.wordsOf(name);

  if (
    words.some((word: string): boolean => {
      return HASHED_WORDS.has(word);
    })
  ) {
    return false;
  }

  return PASSWORD_HINTS.some((hint: ReadonlyArray<string>): boolean => {
    return isHeadOf(words, hint, { allowsPlural: false });
  });
}

export function isCardSecurityCodeName(name: string): boolean {
  const words: Array<string> = SensitiveNameMatcher.wordsOf(name);

  return CARD_SECURITY_CODE_HINTS.some((hint: ReadonlyArray<string>): boolean => {
    return isHeadOf(words, hint, { allowsPlural: false });
  });
}

function catalogType(id: string): NamedDataType | null {
  const info: ReturnType<typeof getBuiltInDataType> = getBuiltInDataType(id);

  return info
    ? {
        id: info.id,
        name: info.name,
        sensitivity: info.sensitivity,
        category: info.category,
      }
    : null;
}

/*
 * The candidates of one migration or model: the new columns whose names
 * say they hold sensitive data.
 */
export function findSensitiveColumns(data: {
  path: string;
  lines: Array<PatchLine>;
  matcher: SensitiveNameMatcher;
  // The change hashes passwords somewhere: a password column is a question.
  hashesPasswords: boolean;
}): Array<SensitiveDataCandidate> {
  if (!isMigrationPath(data.path) && !isModelPath(data.path)) {
    return [];
  }

  const newLines: Array<PatchLine> = readNewLines(data.lines);
  const candidates: Array<SensitiveDataCandidate> = [];

  for (const found of readNewColumns(newLines)) {
    const line: PatchLine = newLines[found.index]!;

    if (isMarkedNotSensitive(newLines, found.index)) {
      continue;
    }

    const candidate: SensitiveDataCandidate | null = toCandidate({
      path: data.path,
      line,
      column: found.column.slice(0, SENSITIVE_DATA_LIMITS.maxSubjectLength),
      table: found.table,
      matcher: data.matcher,
      hashesPasswords: data.hashesPasswords,
    });

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function toCandidate(data: {
  path: string;
  line: PatchLine;
  column: string;
  table: string | null;
  matcher: SensitiveNameMatcher;
  hashesPasswords: boolean;
}): SensitiveDataCandidate | null {
  const column: string = data.column;
  const ofTable: string = data.table ? ` to \`${data.table}\`` : "";
  const base: Pick<
    SensitiveDataCandidate,
    "kind" | "path" | "line" | "lineText" | "subject" | "where"
  > = {
    kind: SensitiveDataLeakKind.Migration,
    path: data.path,
    line: data.line.newLine,
    lineText: data.line.text,
    subject: column,
    ...(data.table
      ? { where: data.table.slice(0, SENSITIVE_DATA_LIMITS.maxSubjectLength) }
      : {}),
  };

  if (isCardSecurityCodeName(column)) {
    const type: NamedDataType | null = catalogType(CARD_SECURITY_CODE_TYPE_ID);

    return {
      ...base,
      checkId: CARD_SECURITY_CODES_STORED_CHECK_ID,
      column: SensitiveDataColumn.CardSecurityCode,
      dataTypes: type ? [type] : [],
      sensitivity: DataSensitivity.Restricted,
      isBlocking: true,
      text: `Adds the column \`${column}\`${ofTable}, for a card's security code, which may never be stored once a payment is authorized (PCI DSS).`,
      fix: "Remove the column: hand the code to your payment provider, and keep nothing of it.",
    };
  }

  if (isPlaintextPasswordName(column)) {
    const type: NamedDataType | null = catalogType(GENERIC_SECRET_TYPE_ID);

    return {
      ...base,
      checkId: PLAINTEXT_PASSWORDS_CHECK_ID,
      column: SensitiveDataColumn.PlaintextPassword,
      dataTypes: type ? [type] : [],
      sensitivity: DataSensitivity.Restricted,
      isBlocking: !data.hashesPasswords,
      text: data.hashesPasswords
        ? `Adds the column \`${column}\`${ofTable}, named for a password: if it holds a hash, as this change's hashing suggests, name it as one.`
        : `Adds the column \`${column}\`${ofTable}, for a password stored as it is: nothing in its name or this change says it is hashed.`,
      fix: "Store a hash of the password - bcrypt, scrypt or Argon2 - in a column named for it, such as `password_hash`, never the password itself.",
    };
  }

  const types: Array<NamedDataType> = data.matcher
    .match(column)
    .filter((type: NamedDataType): boolean => {
      // A secret's column is no personal data: its own check reads it.
      return (
        type.category !== DataCategory.SecretsAndCredentials &&
        type.id !== CARD_SECURITY_CODE_TYPE_ID
      );
    });

  if (types.length === 0) {
    return null;
  }

  if (
    types.some((type: NamedDataType): boolean => {
      return type.id === CARD_NUMBER_TYPE_ID;
    })
  ) {
    return {
      ...base,
      checkId: CARD_NUMBERS_READABLE_CHECK_ID,
      column: SensitiveDataColumn.CardNumber,
      dataTypes: types,
      sensitivity: DataSensitivity.Restricted,
      isBlocking: false,
      text: `Adds the column \`${column}\`${ofTable}, for card numbers, readable to whoever reads the table.`,
      fix: "Store your payment provider's token for the card, or only its last four digits, never the card number.",
    };
  }

  const sensitivity: DataSensitivity = highestSensitivity(types);

  return {
    ...base,
    checkId: NEW_PERSONAL_DATA_COLUMN_CHECK_ID,
    column: SensitiveDataColumn.PersonalData,
    dataTypes: types,
    sensitivity,
    isBlocking: false,
    text: `Adds the column \`${column}\`${ofTable}, whose name says it holds ${describeDataType(types[0]!)}.`,
    fix:
      sensitivity === DataSensitivity.Restricted
        ? "Store it only if you must, encrypted or tokenized, and say in your record of processing what it is for."
        : "Store it only if you must, keep it only as long as it is needed, and say in your record of processing what it is for.",
  };
}
