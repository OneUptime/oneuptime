import crypto from "crypto";
import { JSONObject } from "../../../Types/JSON";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";

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
  const publicKey: crypto.KeyObject = crypto.createPublicKey(
    crypto.createPrivateKey(privateKeyPem),
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
  private readonly transport: SnowflakeTransport;
  private readonly now: () => Date;
  private token: { value: string; expiresAt: number } | null = null;

  public constructor(data: {
    connection: SnowflakeConnection;
    transport?: SnowflakeTransport | undefined;
    now?: (() => Date) | undefined;
  }) {
    this.connection = data.connection;
    this.transport =
      data.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
    this.now =
      data.now ||
      ((): Date => {
        return new Date();
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

  private async send(
    method: "GET" | "POST",
    path: string,
    body?: JSONObject,
  ): Promise<{ statusCode: number; body: JSONObject }> {
    const response: DataSourceHttpResponse = await this.transport({
      method,
      url: `https://${getSnowflakeHost(this.connection.account)}${path}`,
      headers: this.headers(),
      ...(body ? { body: JSON.stringify(body) } : {}),
      timeoutInMs: (SNOWFLAKE_STATEMENT_TIMEOUT_IN_SECONDS + 15) * 1000,
      acceptAnyStatus: true,
    } as DataSourceHttpRequest);
    const json: JSONObject =
      response.bodyJson && typeof response.bodyJson === "object"
        ? (response.bodyJson as JSONObject)
        : {};

    if (response.statusCode >= 400) {
      throw new Error(
        `Snowflake answered ${response.statusCode}: ${readText(json["message"]) || response.bodyText.slice(0, 300)}`,
      );
    }

    return { statusCode: response.statusCode, body: json };
  }

  /*
   * One statement's rows. A warehouse is named only for a statement that
   * needs one: SHOW reads the catalog without starting a warehouse, so a
   * collection costs no credits.
   */
  public async query(data: {
    statement: string;
    bindings?: Array<string> | undefined;
    useWarehouse?: boolean | undefined;
  }): Promise<Array<Record<string, unknown>>> {
    if (data.useWarehouse && !this.connection.warehouse) {
      throw new Error(
        "Name a warehouse in the Snowflake connection to run checks: a query on a table's rows needs one.",
      );
    }

    const bindings: JSONObject = {};

    (data.bindings || []).forEach((value: string, index: number) => {
      bindings[String(index + 1)] = { type: "TEXT", value };
    });

    let answer: { statusCode: number; body: JSONObject } = await this.send(
      "POST",
      `/api/v2/statements?requestId=${crypto.randomUUID()}`,
      {
        statement: data.statement,
        timeout: SNOWFLAKE_STATEMENT_TIMEOUT_IN_SECONDS,
        database: this.connection.database,
        ...(data.useWarehouse && this.connection.warehouse
          ? { warehouse: this.connection.warehouse }
          : {}),
        ...(this.connection.role ? { role: this.connection.role } : {}),
        ...(Object.keys(bindings).length > 0 ? { bindings } : {}),
      },
    );
    const handle: string = readText(answer.body["statementHandle"]);

    for (let poll: number = 0; answer.statusCode === 202; poll++) {
      if (poll >= MAX_POLLS || !handle) {
        throw new Error("The Snowflake statement did not finish in time.");
      }

      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, POLL_WAIT_IN_MS);
      });
      answer = await this.send(
        "GET",
        `/api/v2/statements/${encodeURIComponent(handle)}`,
      );
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
      const next: { statusCode: number; body: JSONObject } = await this.send(
        "GET",
        `/api/v2/statements/${encodeURIComponent(handle)}?partition=${partition}`,
      );
      const page: Array<Record<string, unknown>> = readSnowflakeRows({
        ...next.body,
        resultSetMetaData: answer.body["resultSetMetaData"],
      });

      rows.push(...page);
    }

    return rows;
  }
}
