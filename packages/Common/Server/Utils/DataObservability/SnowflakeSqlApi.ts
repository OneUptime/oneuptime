import crypto from "crypto";
import { JSONObject } from "../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";
import {
  DataSourceUnreachedError,
  failedAnswerError,
  isRequestId,
  readBodyText,
  readErrorCode,
  unreachedError,
} from "../DataSource/HttpFailure";
import DataSourceHttpRetry, {
  HttpRetryExchange,
  HttpRetryReason,
  HttpRetryVerdict,
} from "../DataSource/HttpRetry";

/*
 * SNOWFLAKE, OVER ITS SQL API, WITH KEY-PAIR AUTHENTICATION.
 *
 * No driver: each statement is one HTTPS request to the account's own SQL
 * API, signed with a JSON Web Token made from the user's private key - the
 * key never leaves where the collection runs, only a token valid for an
 * hour does. Statements that wait are polled; results come in partitions.
 *
 * The connection is JSON - { account, user, privateKey, database,
 * warehouse, role } - or a URL:
 * snowflake://USER@ACCOUNT/DATABASE?warehouse=WH&role=ROLE&private_key=<the
 * PEM, base64>, either as a store's saved connection string or in a probe's
 * environment variable. The account is the account identifier
 * (orgname-accountname) or a locator with its region (xy12345.us-east-1).
 *
 * An answer that may pass is asked again (DataSourceHttpRetry), as the SQL
 * API's reference says to: a 429, too many requests or too much at once,
 * and a 500, 502, 503 or 504, with backoff. A 408 is not: the statement ran
 * past its timeout and was cancelled, and would again. A statement sent
 * again carries the request ID of its first sending and retry=true, so
 * Snowflake runs it once however many times it is sent ("Resubmitting a
 * request to execute SQL statements").
 */

export interface SnowflakeConnection {
  account: string;
  user: string;
  // An unencrypted PKCS#8 key, PEM.
  privateKey: string;
  database: string;
  warehouse: string | null;
  role: string | null;
}

export type SnowflakeTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

// How long one statement may run on Snowflake's side, in seconds.
export const SNOWFLAKE_STATEMENT_TIMEOUT_IN_SECONDS: number = 30;

// How many times a statement still running is asked after.
const MAX_POLLS: number = 20;
const POLL_WAIT_IN_MS: number = 500;
const MAX_PARTITIONS: number = 50;
// A token is valid for at most an hour; one a minute short of it.
const TOKEN_LIFETIME_IN_SECONDS: number = 59 * 60;
// The longest name of a statement's kind a failure names: SHOW TABLES, SHOW COLUMNS.
const STATEMENT_KIND: RegExp = /^\s*(SHOW\s+[A-Z]+)/i;

/*
 * The answers of the SQL API worth asking again, as its reference ("Response
 * codes for all operations") lists them: a 429 turned the request away (rate
 * limits and excessive concurrency); a 503 was not processed, a timeout on
 * the server's side; a 500, 502 or 504 failed for now. A 408 is the
 * statement itself running past its timeout, cancelled: it would again.
 */
export function classifySnowflakeAnswer(
  response: DataSourceHttpResponse,
): HttpRetryVerdict | null {
  switch (response.statusCode) {
    case 429:
      return { reason: HttpRetryReason.Throttled };
    case 503:
      return { reason: HttpRetryReason.Unavailable, isUndone: true };
    case 500:
    case 502:
    case 504:
      return { reason: HttpRetryReason.Unavailable };
    default:
      return null;
  }
}

// What a statement reads, as a failure says it: running SHOW TABLES, or running a query.
export function describeSnowflakeStatement(statement: string): string {
  const kind: RegExpMatchArray | null = statement.match(STATEMENT_KIND);

  return kind
    ? `running ${kind[1]!.replace(/\s+/g, " ").toUpperCase()}`
    : "running a query";
}

const ACCOUNT_PATTERN: RegExp = /^[a-z0-9][a-z0-9_.-]{1,250}$/i;
const NAME_PATTERN: RegExp = /^[^\s"]{1,255}$/;

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/[=]+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/*
 * A key pasted into one line, its breaks turned into spaces, written back as
 * PEM: the header, the body in lines of 64, the footer.
 */
export function normalizePem(value: string): string {
  const match: RegExpMatchArray | null = value.match(
    /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/,
  );

  if (!match) {
    return value;
  }

  const label: string = match[1]!;
  const body: string = (match[2] || "").replace(/\s+/g, "");
  const lines: Array<string> = body.match(/.{1,64}/g) || [];

  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

function fromUrl(value: string): JSONObject {
  const url: URL = new URL(value);
  const encodedKey: string = url.searchParams.get("private_key") || "";

  return {
    account: url.hostname,
    user: decodeURIComponent(url.username),
    privateKey: encodedKey
      ? Buffer.from(encodedKey, "base64").toString("utf8")
      : "",
    database: decodeURIComponent(url.pathname.replace(/^\/+/, "")),
    warehouse: url.searchParams.get("warehouse") || "",
    role: url.searchParams.get("role") || "",
  };
}

// The connection a store's string describes; why not, when it describes none.
export function readSnowflakeConnection(value: string): SnowflakeConnection {
  const text: string = (value || "").trim();
  let raw: JSONObject;

  try {
    raw = text.startsWith("{")
      ? (JSON.parse(text) as JSONObject)
      : text.toLowerCase().startsWith("snowflake://")
        ? fromUrl(text)
        : {};
  } catch {
    raw = {};
  }

  const account: string = readText(raw["account"])
    .replace(/^https?:\/\//i, "")
    .replace(/\.snowflakecomputing\.com.*$/i, "");
  const connection: SnowflakeConnection = {
    account,
    user: readText(raw["user"]),
    privateKey: normalizePem(readText(raw["privateKey"] ?? raw["private_key"])),
    database: readText(raw["database"]),
    warehouse: readText(raw["warehouse"]) || null,
    role: readText(raw["role"]) || null,
  };

  if (!ACCOUNT_PATTERN.test(connection.account)) {
    throw new Error(
      "The Snowflake connection needs the account identifier, such as myorg-myaccount or xy12345.us-east-1.",
    );
  }

  for (const [name, part] of [
    ["user", connection.user],
    ["database", connection.database],
  ] as Array<[string, string]>) {
    if (!NAME_PATTERN.test(part)) {
      throw new Error(`The Snowflake connection needs its ${name}.`);
    }
  }

  if (!connection.privateKey.includes("PRIVATE KEY")) {
    throw new Error(
      "The Snowflake connection needs the user's private key, an unencrypted PKCS#8 PEM.",
    );
  }

  return connection;
}

// The account's own host for its SQL API.
export function getSnowflakeHost(account: string): string {
  return `${account.toLowerCase()}.snowflakecomputing.com`;
}

/*
 * The account as a token names it: upper case, and for a locator with a
 * region (xy12345.us-east-1) the locator alone.
 */
export function getTokenAccount(account: string): string {
  return account.toUpperCase().split(".")[0]!;
}

// The fingerprint Snowflake keeps of the user's public key: SHA256:<base64>.
export function getPublicKeyFingerprint(privateKeyPem: string): string {
  /*
   * The public half of the user's private key, derived through its PKCS#8
   * export (this @types/node does not type createPublicKey(KeyObject)).
   */
  const privateKey: crypto.KeyObject = crypto.createPrivateKey(privateKeyPem);
  const publicKey: crypto.KeyObject = crypto.createPublicKey(
    privateKey.export({ type: "pkcs8", format: "pem" }),
  );
  const der: Buffer = publicKey.export({ type: "spki", format: "der" });

  return `SHA256:${crypto.createHash("sha256").update(der).digest("base64")}`;
}

export function buildSnowflakeToken(data: {
  connection: SnowflakeConnection;
  now: Date;
}): string {
  const privateKey: crypto.KeyObject = crypto.createPrivateKey(
    data.connection.privateKey,
  );
  const qualifiedUser: string = `${getTokenAccount(data.connection.account)}.${data.connection.user.toUpperCase()}`;
  const issuedAt: number = Math.floor(data.now.getTime() / 1000);
  const signingInput: string = `${base64Url(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  )}.${base64Url(
    JSON.stringify({
      iss: `${qualifiedUser}.${getPublicKeyFingerprint(data.connection.privateKey)}`,
      sub: qualifiedUser,
      iat: issuedAt,
      exp: issuedAt + TOKEN_LIFETIME_IN_SECONDS,
    }),
  )}`;
  const signature: Buffer = crypto.sign(
    "RSA-SHA256",
    Buffer.from(signingInput),
    privateKey,
  );

  return `${signingInput}.${base64Url(signature)}`;
}

// A result's rows, each keyed by its column's name in lower case.
export function readSnowflakeRows(
  body: JSONObject,
): Array<Record<string, unknown>> {
  const metadata: JSONObject = (body["resultSetMetaData"] || {}) as JSONObject;
  const names: Array<string> = (
    Array.isArray(metadata["rowType"]) ? metadata["rowType"] : []
  ).map((column: unknown): string => {
    return readText((column as JSONObject)?.["name"]).toLowerCase();
  });
  const rows: Array<Record<string, unknown>> = [];

  for (const values of Array.isArray(body["data"]) ? body["data"] : []) {
    if (!Array.isArray(values)) {
      continue;
    }

    const row: Record<string, unknown> = {};

    names.forEach((name: string, index: number) => {
      row[name] = values[index] ?? null;
    });
    rows.push(row);
  }

  return rows;
}

export default class SnowflakeSqlApi {
  private readonly connection: SnowflakeConnection;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  // Every request of the collection, asked again within one budget (DataSourceHttpRetry).
  private readonly retry: DataSourceHttpRetry;
  private token: { value: string; expiresAt: number } | null = null;

  public constructor(data: {
    connection: SnowflakeConnection;
    transport?: SnowflakeTransport | undefined;
    now?: (() => Date) | undefined;
    sleep?: ((ms: number) => Promise<void>) | undefined;
  }) {
    this.connection = data.connection;
    this.now =
      data.now ||
      ((): Date => {
        return new Date();
      });
    this.sleep =
      data.sleep ||
      ((ms: number): Promise<void> => {
        return DataSourceHttpRetry.sleep(ms);
      });
    this.retry = new DataSourceHttpRetry({
      transport:
        data.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
      classify: classifySnowflakeAnswer,
      provider: "Snowflake",
      now: (): number => {
        return this.now().getTime();
      },
      sleep: this.sleep,
    });
  }

  private headers(): Record<string, string> {
    const now: number = this.now().getTime();

    if (!this.token || this.token.expiresAt - 60_000 < now) {
      this.token = {
        value: buildSnowflakeToken({
          connection: this.connection,
          now: this.now(),
        }),
        expiresAt: now + TOKEN_LIFETIME_IN_SECONDS * 1000,
      };
    }

    return {
      Authorization: `Bearer ${this.token.value}`,
      "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /*
   * One request to the SQL API, asked again while its answer may pass. A
   * statement is sent again with retry=true beside the request ID of its
   * first sending, so it runs once. An answer of 400 or more says what was
   * being read and Snowflake's own code and message, with the query ID its
   * support finds the statement by.
   */
  private async send(data: {
    method: "GET" | "POST";
    path: string;
    body?: JSONObject | undefined;
    operation: string;
    // A statement's request ID: sent again with retry=true.
    requestId?: string | undefined;
  }): Promise<{ statusCode: number; body: JSONObject }> {
    let exchange: HttpRetryExchange;

    try {
      exchange = await this.retry.exchange({
        build: (attempt: number): DataSourceHttpRequest => {
          const search: string = data.requestId
            ? `?requestId=${encodeURIComponent(data.requestId)}${attempt > 1 ? "&retry=true" : ""}`
            : "";

          return {
            method: data.method,
            url: `https://${getSnowflakeHost(this.connection.account)}${data.path}${search}`,
            headers: this.headers(),
            ...(data.body ? { body: JSON.stringify(data.body) } : {}),
            timeoutInMs: (SNOWFLAKE_STATEMENT_TIMEOUT_IN_SECONDS + 15) * 1000,
            acceptAnyStatus: true,
          };
        },
        // A read, or a statement Snowflake tells apart by its request ID.
        isSafeToRepeat: true,
      });
    } catch (error) {
      // A failure of the request's own making (a sign-in refused) says itself.
      if (!(error instanceof DataSourceUnreachedError)) {
        throw error;
      }

      throw unreachedError({
        provider: "Snowflake",
        operation: data.operation,
        error,
        secrets: this.secrets(),
      });
    }

    const response: DataSourceHttpResponse = exchange.response;
    const json: JSONObject =
      response.bodyJson && typeof response.bodyJson === "object"
        ? (response.bodyJson as JSONObject)
        : {};

    if (response.statusCode >= 400) {
      const queryId: unknown = json["statementHandle"];

      throw failedAnswerError({
        provider: "Snowflake",
        statusCode: response.statusCode,
        errorCode: readErrorCode(json["code"]),
        operation: data.operation,
        message:
          readText(json["message"]) ||
          (response.bodyJson === undefined
            ? readBodyText(response.bodyText)
            : ""),
        attempts: exchange.attempts,
        requestId: isRequestId(queryId) ? queryId.trim() : null,
        requestIdLabel: "Query ID",
        refused: { who: "the user" },
        secrets: this.secrets(),
      });
    }

    return { statusCode: response.statusCode, body: json };
  }

  // What an answer could repeat that no error may: the token this client signed.
  private secrets(): Array<string> {
    return [this.token?.value || ""];
  }

  /*
   * One statement's rows. A warehouse is named only for a statement that
   * needs one: SHOW reads the catalog without starting a warehouse, so a
   * collection costs no credits. A failure says what was being read: the
   * operation given, else the statement's kind (running SHOW TABLES).
   */
  public async query(data: {
    statement: string;
    bindings?: Array<string> | undefined;
    useWarehouse?: boolean | undefined;
    operation?: string | undefined;
  }): Promise<Array<Record<string, unknown>>> {
    if (data.useWarehouse && !this.connection.warehouse) {
      throw new Error(
        "Name a warehouse in the Snowflake connection to run checks: a query on a table's rows needs one.",
      );
    }

    const operation: string =
      data.operation || describeSnowflakeStatement(data.statement);
    const bindings: JSONObject = {};

    (data.bindings || []).forEach((value: string, index: number) => {
      bindings[String(index + 1)] = { type: "TEXT", value };
    });

    let answer: { statusCode: number; body: JSONObject } = await this.send({
      method: "POST",
      path: "/api/v2/statements",
      requestId: crypto.randomUUID(),
      operation,
      body: {
        statement: data.statement,
        timeout: SNOWFLAKE_STATEMENT_TIMEOUT_IN_SECONDS,
        database: this.connection.database,
        ...(data.useWarehouse && this.connection.warehouse
          ? { warehouse: this.connection.warehouse }
          : {}),
        ...(this.connection.role ? { role: this.connection.role } : {}),
        ...(Object.keys(bindings).length > 0 ? { bindings } : {}),
      },
    });
    const handle: string = readText(answer.body["statementHandle"]);

    for (let poll: number = 0; answer.statusCode === 202; poll++) {
      if (poll >= MAX_POLLS || !handle) {
        throw new Error("The Snowflake statement did not finish in time.");
      }

      await this.sleep(POLL_WAIT_IN_MS);
      answer = await this.send({
        method: "GET",
        path: `/api/v2/statements/${encodeURIComponent(handle)}`,
        operation,
      });
    }

    const rows: Array<Record<string, unknown>> = readSnowflakeRows(answer.body);
    const metadata: JSONObject = (answer.body["resultSetMetaData"] ||
      {}) as JSONObject;
    const partitions: number = Array.isArray(metadata["partitionInfo"])
      ? metadata["partitionInfo"].length
      : 1;

    // A large result comes in partitions after the first.
    for (
      let partition: number = 1;
      partition < Math.min(partitions, MAX_PARTITIONS);
      partition++
    ) {
      const next: { statusCode: number; body: JSONObject } = await this.send({
        method: "GET",
        path: `/api/v2/statements/${encodeURIComponent(handle)}?partition=${partition}`,
        operation,
      });
      const page: Array<Record<string, unknown>> = readSnowflakeRows({
        ...next.body,
        resultSetMetaData: answer.body["resultSetMetaData"],
      });

      rows.push(...page);
    }

    return rows;
  }
}
