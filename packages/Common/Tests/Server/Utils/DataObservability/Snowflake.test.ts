import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import SnowflakeSqlApi, {
  buildSnowflakeToken,
  getPublicKeyFingerprint,
  getSnowflakeHost,
  getTokenAccount,
  normalizePem,
  readSnowflakeConnection,
  readSnowflakeRows,
  SnowflakeConnection,
} from "../../../../Server/Utils/DataObservability/SnowflakeSqlApi";
import {
  readSnowflakeColumnType,
  readSnowflakeTableKind,
  snowflakeIdentifier,
  buildSnowflakeColumnLineageQuery,
  buildSnowflakeQueryLineageQuery,
  readSnowflakeObjectParts,
  SNOWFLAKE_VIEW_LINEAGE_QUERY,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import { readConnectionTarget } from "../../../../Server/Utils/DataObservability/TableHealthTarget";
import { buildDataCheckStatement } from "../../../../Server/Utils/DataObservability/DataCheckSql";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { JSONObject } from "../../../../Types/JSON";

/*
 * Snowflake is read over its SQL API, signed with a token made from the
 * user's private key: the key never leaves, the catalog is read with SHOW
 * (no warehouse, no credits), and only a data check runs on a warehouse.
 */

const KEYS: { privateKey: string; publicKey: string } =
  crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");

function connection(
  overrides: Partial<SnowflakeConnection> = {},
): SnowflakeConnection {
  return {
    account: "myorg-myaccount",
    user: "oneuptime_reader",
    privateKey: KEYS.privateKey,
    database: "ANALYTICS",
    warehouse: "CHECKS_WH",
    role: "ONEUPTIME_READER",
    ...overrides,
  };
}

function decodePart(part: string): JSONObject {
  return JSON.parse(
    Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    ),
  ) as JSONObject;
}

describe("readSnowflakeConnection", () => {
  test("reads the JSON a store keeps", () => {
    expect(
      readSnowflakeConnection(
        JSON.stringify({
          account: "https://xy12345.us-east-1.snowflakecomputing.com",
          user: "ONEUPTIME_READER",
          privateKey: KEYS.privateKey,
          database: "ANALYTICS",
          warehouse: "CHECKS_WH",
        }),
      ),
    ).toEqual({
      account: "xy12345.us-east-1",
      user: "ONEUPTIME_READER",
      privateKey: normalizePem(KEYS.privateKey),
      database: "ANALYTICS",
      warehouse: "CHECKS_WH",
      role: null,
    });
  });

  test("reads a snowflake:// URL with its key in base64, for a probe's variable", () => {
    const url: string = `snowflake://ONEUPTIME_READER@myorg-myaccount/ANALYTICS?warehouse=WH&role=READER&private_key=${encodeURIComponent(
      Buffer.from(KEYS.privateKey).toString("base64"),
    )}`;

    expect(readSnowflakeConnection(url)).toMatchObject({
      account: "myorg-myaccount",
      user: "ONEUPTIME_READER",
      database: "ANALYTICS",
      warehouse: "WH",
      role: "READER",
    });
  });

  test("a key pasted into one line is written back as PEM", () => {
    const oneLine: string = KEYS.privateKey.replace(/\n/g, " ");

    expect(normalizePem(oneLine)).toBe(normalizePem(KEYS.privateKey));
    expect(() => {
      return crypto.createPrivateKey(normalizePem(oneLine));
    }).not.toThrow();
  });

  test("says what is missing", () => {
    expect(() => {
      return readSnowflakeConnection("{}");
    }).toThrow("account identifier");
    expect(() => {
      return readSnowflakeConnection(
        JSON.stringify({ account: "a-b", user: "U", database: "D" }),
      );
    }).toThrow("private key");
    expect(() => {
      return readSnowflakeConnection("postgres://not-snowflake");
    }).toThrow();
  });
});

describe("the token", () => {
  test("the account a token names: upper case, a locator without its region", () => {
    expect(getTokenAccount("xy12345.us-east-1")).toBe("XY12345");
    expect(getTokenAccount("myorg-myaccount")).toBe("MYORG-MYACCOUNT");
    expect(getSnowflakeHost("MyOrg-MyAccount")).toBe(
      "myorg-myaccount.snowflakecomputing.com",
    );
  });

  test("is signed with the user's key, names its public key's fingerprint, and lasts under an hour", () => {
    const token: string = buildSnowflakeToken({
      connection: connection(),
      now: NOW,
    });
    const [header, payload, signature] = token.split(".");
    const claims: JSONObject = decodePart(payload!);
    const expectedFingerprint: string = `SHA256:${crypto
      .createHash("sha256")
      .update(
        crypto
          .createPublicKey(KEYS.publicKey)
          .export({ type: "spki", format: "der" }),
      )
      .digest("base64")}`;

    expect(decodePart(header!)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(getPublicKeyFingerprint(KEYS.privateKey)).toBe(expectedFingerprint);
    expect(claims["iss"]).toBe(
      `MYORG-MYACCOUNT.ONEUPTIME_READER.${expectedFingerprint}`,
    );
    expect(claims["sub"]).toBe("MYORG-MYACCOUNT.ONEUPTIME_READER");
    expect(Number(claims["exp"]) - Number(claims["iat"])).toBeLessThan(3600);
    expect(
      crypto.verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        KEYS.publicKey,
        Buffer.from(signature!.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
      ),
    ).toBe(true);
  });
});

describe("SnowflakeSqlApi", () => {
  function answer(
    statusCode: number,
    body: JSONObject,
  ): DataSourceHttpResponse {
    return { statusCode, bodyText: JSON.stringify(body), bodyJson: body };
  }

  test("a result's rows, keyed by column", () => {
    expect(
      readSnowflakeRows({
        resultSetMetaData: { rowType: [{ name: "NAME" }, { name: "rows" }] },
        data: [
          ["ORDERS", "120"],
          ["CUSTOMERS", null],
        ],
      }),
    ).toEqual([
      { name: "ORDERS", rows: "120" },
      { name: "CUSTOMERS", rows: null },
    ]);
  });

  test("waits for a statement still running, then reads every partition", async () => {
    const sent: Array<DataSourceHttpRequest> = [];
    const answers: Array<DataSourceHttpResponse> = [
      answer(202, { statementHandle: "h-1", code: "333334" }),
      answer(200, {
        statementHandle: "h-1",
        resultSetMetaData: {
          rowType: [{ name: "VALUE" }],
          partitionInfo: [{ rowCount: 1 }, { rowCount: 1 }],
        },
        data: [["1"]],
      }),
      answer(200, { data: [["2"]] }),
    ];
    const api: SnowflakeSqlApi = new SnowflakeSqlApi({
      connection: connection(),
      now: (): Date => {
        return NOW;
      },
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        sent.push(request);
        return answers.shift()!;
      },
    });

    const rows: Array<Record<string, unknown>> = await api.query({
      statement: "SELECT COUNT(*) FROM T WHERE S = ?",
      bindings: ["paid"],
      useWarehouse: true,
    });

    expect(rows).toEqual([{ value: "1" }, { value: "2" }]);
    expect(sent[0]!.url).toMatch(
      /^https:\/\/myorg-myaccount\.snowflakecomputing\.com\/api\/v2\/statements\?requestId=/,
    );
    expect(sent[0]!.headers?.["X-Snowflake-Authorization-Token-Type"]).toBe(
      "KEYPAIR_JWT",
    );
    expect(JSON.parse(String(sent[0]!.body))).toMatchObject({
      database: "ANALYTICS",
      warehouse: "CHECKS_WH",
      role: "ONEUPTIME_READER",
      bindings: { "1": { type: "TEXT", value: "paid" } },
    });
    expect(sent[1]!.url).toBe(
      "https://myorg-myaccount.snowflakecomputing.com/api/v2/statements/h-1",
    );
    expect(sent[2]!.url).toBe(
      "https://myorg-myaccount.snowflakecomputing.com/api/v2/statements/h-1?partition=1",
    );
  });

  test("SHOW names no warehouse; a check without one is refused before it is sent", async () => {
    const sent: Array<DataSourceHttpRequest> = [];
    const api: SnowflakeSqlApi = new SnowflakeSqlApi({
      connection: connection({ warehouse: null }),
      transport: async (
        request: DataSourceHttpRequest,
      ): Promise<DataSourceHttpResponse> => {
        sent.push(request);
        return answer(200, { resultSetMetaData: { rowType: [] }, data: [] });
      },
    });

    await api.query({ statement: "SHOW TABLES IN DATABASE ANALYTICS" });
    expect(JSON.parse(String(sent[0]!.body))["warehouse"]).toBe(undefined);
    await expect(
      api.query({ statement: "SELECT 1", useWarehouse: true }),
    ).rejects.toThrow("Name a warehouse");
  });

  test("Snowflake's error is the error", async () => {
    const api: SnowflakeSqlApi = new SnowflakeSqlApi({
      connection: connection(),
      transport: async (): Promise<DataSourceHttpResponse> => {
        return answer(422, {
          message: "SQL compilation error: Object 'X' does not exist",
        });
      },
    });

    await expect(api.query({ statement: "SHOW TABLES" })).rejects.toThrow(
      "SQL compilation error",
    );
  });
});

describe("the Snowflake catalog", () => {
  test("tables, never a temporary or an external one", () => {
    expect(readSnowflakeTableKind({ kind: "TABLE" })).toBe(DataAssetKind.Table);
    expect(readSnowflakeTableKind({ kind: "TRANSIENT" })).toBe(
      DataAssetKind.Table,
    );
    expect(readSnowflakeTableKind({ kind: "TEMPORARY" })).toBe(null);
    expect(readSnowflakeTableKind({ kind: "TABLE", is_external: "Y" })).toBe(
      null,
    );
  });

  test("a column's type as Snowflake writes it", () => {
    expect(
      readSnowflakeColumnType(
        JSON.stringify({
          type: "FIXED",
          precision: 38,
          scale: 0,
          nullable: false,
        }),
      ),
    ).toEqual({ dataType: "NUMBER(38,0)", isNullable: false });
    expect(
      readSnowflakeColumnType(
        JSON.stringify({ type: "TEXT", length: 255, nullable: true }),
      ),
    ).toEqual({ dataType: "VARCHAR(255)", isNullable: true });
    expect(readSnowflakeColumnType("not json")).toEqual({
      dataType: "UNKNOWN",
      isNullable: true,
    });
  });

  test("names are bare when they can be", () => {
    expect(snowflakeIdentifier("ANALYTICS")).toBe("ANALYTICS");
    expect(snowflakeIdentifier("my db")).toBe('"my db"');
  });

  test("the target is the account and database, never the key", () => {
    const target: unknown = readConnectionTarget({
      engine: "snowflake",
      connectionString: JSON.stringify({
        account: "myorg-myaccount",
        user: "U",
        privateKey: KEYS.privateKey,
        database: "ANALYTICS",
      }),
    });

    expect(target).toEqual({
      databaseName: "ANALYTICS",
      host: "myorg-myaccount.snowflakecomputing.com",
      port: 443,
    });
    expect(JSON.stringify(target)).not.toContain("PRIVATE");
  });

  test("a check binds by position, and a pattern searches each value", () => {
    const statement: { sql: string; params: Array<string> } =
      buildDataCheckStatement("snowflake", {
        type: DataCheckType.FormatMismatchPercent,
        schemaName: "PUBLIC",
        tableName: "ORDERS",
        columnName: "EMAIL",
        pattern: "@",
        segmentColumn: null,
        acceptedValues: null,
        referenceSchemaName: null,
        referenceTableName: null,
        referenceColumnName: null,
        customSql: null,
      });

    expect(statement.sql).toContain(
      'REGEXP_INSTR(CAST("EMAIL" AS TEXT), ?) = 0',
    );
    expect(statement.sql).toContain('FROM "PUBLIC"."ORDERS"');
    expect(statement.params).toEqual(["@"]);
  });
});

describe("Snowflake's lineage", () => {
  test("a view's lineage comes from its dependencies", () => {
    expect(SNOWFLAKE_VIEW_LINEAGE_QUERY).toContain("OBJECT_DEPENDENCIES");
    expect(SNOWFLAKE_VIEW_LINEAGE_QUERY).toContain(
      "UPPER(d.referencing_database) = UPPER(?)",
    );
  });

  test("a job's lineage looks back as far as asked, in whole seconds", () => {
    const query: string = buildSnowflakeQueryLineageQuery(3600.7);

    expect(query).toContain("ACCESS_HISTORY");
    expect(query).toContain("base_objects_accessed");
    expect(query).toContain("objects_modified");
    expect(query).toContain("DATEADD('second', -3600,");
  });

  test("a column's lineage reads each written column and the base columns behind it", () => {
    const query: string = buildSnowflakeColumnLineageQuery(21600);

    expect(query).toContain("baseSources");
    expect(query).toContain("upstream_column");
    expect(query).toContain("downstream_column");
    expect(query).toContain("GROUP BY 1, 2, 3, 4");
    expect(query).toContain("DATEADD('second', -21600,");
  });

  test("an object's name says its database only when it is another's", () => {
    expect(readSnowflakeObjectParts("SHOP.PUBLIC.ORDERS", "shop")).toEqual({
      database: "",
      schema: "PUBLIC",
      table: "ORDERS",
    });
    expect(readSnowflakeObjectParts("RAW.PUBLIC.ORDERS", "SHOP")).toEqual({
      database: "RAW",
      schema: "PUBLIC",
      table: "ORDERS",
    });
  });

  test("a name that is not three parts is not an object", () => {
    expect(readSnowflakeObjectParts("PUBLIC.ORDERS", "SHOP")).toBeNull();
    expect(readSnowflakeObjectParts("A..C", "SHOP")).toBeNull();
    expect(readSnowflakeObjectParts(null, "SHOP")).toBeNull();
  });
});
