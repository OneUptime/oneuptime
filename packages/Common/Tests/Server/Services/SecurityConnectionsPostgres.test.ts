import Host from "../../../Models/DatabaseModels/Host";
import Entities from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import HostService from "../../../Server/Services/HostService";
import MonitorService from "../../../Server/Services/MonitorService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import SecurityConnectedRecords, {
  SecurityConnectedRecord,
  SecurityConnectedRecordsResult,
} from "../../../Server/Utils/SecurityEvent/Connections/SecurityConnectedRecords";
import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import IP from "../../../Types/IP/IP";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionReason,
} from "../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { DataSource } from "typeorm";

/*
 * Security Events' connections against a real Postgres, through the
 * services that read them: the hand-written query operators the unit
 * suites can only show as SQL text.
 *
 *   - Matching a case's host names to the project's hosts: the same name
 *     however it is cased (QueryHelper.findWithSameTextAnyOf), and the full
 *     names a bare one starts (QueryHelper.startsWithAnyOf) - a LIKE
 *     wildcard in a name read as itself, so web_1 never reaches webx1.
 *   - The open cases naming a record (ResourceSecurity, IncidentSecurity):
 *     a case whose entities hold the value however an event spelled it
 *     (QueryHelper.jsonArrayObjectsHaveTextAnyOf), and nothing - not an
 *     error - for an entities value that is not an array of objects.
 *   - The monitors checking a host, an address or a URL's host, found in
 *     their steps as stored (QueryHelper.textContainsAnyOf over the jsonb,
 *     with the texts getMonitorMentionTexts anchors where a step holds a
 *     host), so a common short word never reads every monitor; and the
 *     cloud resources of an ID, or answering on a name or an address.
 *
 * Opt in with RUN_POSTGRES_SECURITY_CONNECTIONS_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check (CI runs it in
 * .github/workflows/postgres-schema-drift.yaml). The tables these reads
 * touch are cloned (their STRUCTURE) into a unique schema, which is the
 * only one on the search_path, and dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * SECURITY_CONNECTIONS_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * SECURITY_CONNECTIONS_TEST_DATABASE_HOST / _PORT (default localhost:5400,
 * Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SECURITY_CONNECTIONS_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Host",
  "DockerHost",
  "PodmanHost",
  "KubernetesCluster",
  "NetworkDevice",
  "CloudResource",
  "Monitor",
  "MonitorStatus",
  "SecurityCase",
];

const DASHES: RegExp = /-/g;

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

describePostgres("Security Events' connections against Postgres", () => {
  const schema: string = `security_connections_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["SECURITY_CONNECTIONS_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["SECURITY_CONNECTIONS_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SECURITY_CONNECTIONS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // A fixture names only what a read looks at; ids stay NOT NULL.
    const columns: Array<{ table_name: string; column_name: string }> =
      await database.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = $1 AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema],
      );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const table of TABLES) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insertHost(data: {
    projectId?: ObjectID;
    name: string;
    hostIdentifier: string;
  }): Promise<string> {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "${schema}"."Host" ("_id", "projectId", "name", "hostIdentifier")
       VALUES ($1, $2, $3, $4)`,
      [
        id,
        (data.projectId || projectId).toString(),
        data.name,
        data.hostIdentifier,
      ],
    );

    return id;
  }

  async function insertCase(data: {
    projectId?: ObjectID;
    title: string;
    entities: unknown;
  }): Promise<string> {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "${schema}"."SecurityCase" ("_id", "projectId", "title", "entities")
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        id,
        (data.projectId || projectId).toString(),
        data.title,
        data.entities === null ? null : JSON.stringify(data.entities),
      ],
    );

    return id;
  }

  function hostsOf(
    result: SecurityConnectedRecordsResult,
  ): Array<[string, SecurityConnectionCertainty, SecurityConnectionReason]> {
    return result.records.map(
      (
        record: SecurityConnectedRecord,
      ): [string, SecurityConnectionCertainty, SecurityConnectionReason] => {
        return [record.name, record.certainty, record.matches[0]!.reason];
      },
    );
  }

  test("a host name finds the host that reports it however it is cased, and the full names it starts, in this project only", async () => {
    await insertHost({ name: "Web 1", hostIdentifier: "WEB-1" });
    await insertHost({
      name: "web-1.acme.internal",
      hostIdentifier: "web-1.acme.internal",
    });
    // Another machine: a longer name, not a full form of web-1.
    await insertHost({ name: "web-10", hostIdentifier: "web-10" });
    // Another project's web-1.
    await insertHost({
      projectId: otherProjectId,
      name: "web-1",
      hostIdentifier: "web-1",
    });

    const result: SecurityConnectedRecordsResult =
      await SecurityConnectedRecords.resolve({
        projectId,
        entities: [{ type: SecurityEntityType.Host, value: "web-1" }],
        props: ROOT,
      });

    expect(hostsOf(result)).toEqual([
      [
        "Web 1",
        SecurityConnectionCertainty.Exact,
        SecurityConnectionReason.HostName,
      ],
      [
        "web-1.acme.internal",
        SecurityConnectionCertainty.Possible,
        SecurityConnectionReason.ShortHostName,
      ],
    ]);
    // Every kind of record was read: nothing failed on real SQL.
    expect(result.failedKinds).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  test("a LIKE wildcard in a name is read as itself", async () => {
    await insertHost({
      name: "webx1.acme.internal",
      hostIdentifier: "webx1.acme.internal",
    });
    await insertHost({
      name: "web_1.acme.internal",
      hostIdentifier: "web_1.acme.internal",
    });
    await insertHost({
      name: "web%1.acme.internal",
      hostIdentifier: "web%1.acme.internal",
    });

    // The operator itself: only the names that start with the text as written.
    const read: (prefix: string) => Promise<Array<string>> = async (
      prefix: string,
    ): Promise<Array<string>> => {
      const hosts: Array<Host> = await HostService.findBy({
        query: {
          projectId,
          hostIdentifier: QueryHelper.startsWithAnyOf([prefix]),
        } as never,
        select: { _id: true, hostIdentifier: true },
        limit: 50,
        skip: 0,
        props: ROOT,
      });

      return hosts
        .map((host: Host): string => {
          return host.hostIdentifier || "";
        })
        .sort();
    };

    expect(await read("WEB_1.")).toEqual(["web_1.acme.internal"]);
    expect(await read("web%")).toEqual(["web%1.acme.internal"]);
    expect(await read("web")).toEqual([
      "web%1.acme.internal",
      "web_1.acme.internal",
      "webx1.acme.internal",
    ]);

    const result: SecurityConnectedRecordsResult =
      await SecurityConnectedRecords.resolve({
        projectId,
        entities: [{ type: SecurityEntityType.Host, value: "web_1" }],
        props: ROOT,
      });

    expect(
      result.records.map((record: SecurityConnectedRecord): string => {
        return record.name;
      }),
    ).toEqual(["web_1.acme.internal"]);
    expect(result.failedKinds).toEqual([]);
  });

  test("the cases whose entities name a value, however it was spelled; an entities value that is not an array of objects matches nothing", async () => {
    const named: string = await insertCase({
      title: "Brute force on WEB-1",
      entities: [
        { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
        { type: SecurityEntityType.Host, value: "WEB-1" },
      ],
    });
    const member: string = await insertCase({
      title: "Impossible travel",
      entities: [{ type: SecurityEntityType.User, value: "Kim@Acme.example" }],
    });
    await insertCase({ title: "Strings, not objects", entities: ["web-1"] });
    await insertCase({
      title: "An object, not an array",
      entities: { value: "web-1" },
    });
    await insertCase({
      title: "A number where the value goes",
      entities: [{ value: 1 }],
    });
    await insertCase({ title: "No entities", entities: null });
    await insertCase({
      projectId: otherProjectId,
      title: "Another project's web-1",
      entities: [{ type: SecurityEntityType.Host, value: "web-1" }],
    });

    const find: (texts: Array<string>) => Promise<Array<string>> = async (
      texts: Array<string>,
    ): Promise<Array<string>> => {
      const cases: Array<SecurityCase> = await SecurityCaseService.findBy({
        query: {
          projectId,
          entities: QueryHelper.jsonArrayObjectsHaveTextAnyOf({
            key: "value",
            texts,
          }),
        } as never,
        select: { _id: true },
        limit: 50,
        skip: 0,
        props: ROOT,
      });

      return cases
        .map((securityCase: SecurityCase): string => {
          return securityCase.id!.toString();
        })
        .sort();
    };

    expect(await find(["web-1"])).toEqual([named]);
    expect(await find([" Web-1 ", "kim@acme.example"])).toEqual(
      [named, member].sort(),
    );
    expect(await find(["db-9"])).toEqual([]);
  });

  async function insertMonitor(data: {
    projectId?: ObjectID;
    name: string;
    steps: Array<(step: MonitorStep) => MonitorStep>;
    isArchived?: boolean;
  }): Promise<string> {
    const id: string = ObjectID.generate().toString();
    const steps: MonitorSteps = new MonitorSteps();

    steps.setMonitorStepsInstanceArray(
      data.steps.map(
        (build: (step: MonitorStep) => MonitorStep): MonitorStep => {
          return build(new MonitorStep());
        },
      ),
    );

    // Stored as the Monitor column's transformer writes it: its JSON.
    await database.query(
      `INSERT INTO "${schema}"."Monitor" ("_id", "projectId", "name", "monitorSteps", "isArchived")
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        id,
        (data.projectId || projectId).toString(),
        data.name,
        JSON.stringify(steps.toJSON()),
        Boolean(data.isArchived),
      ],
    );

    return id;
  }

  function monitorsOf(
    result: SecurityConnectedRecordsResult,
  ): Array<[string, SecurityConnectionCertainty, SecurityConnectionReason]> {
    return result.records
      .filter((record: SecurityConnectedRecord): boolean => {
        return record.kind === SecurityConnectionKind.Monitor;
      })
      .map(
        (
          record: SecurityConnectedRecord,
        ): [string, SecurityConnectionCertainty, SecurityConnectionReason] => {
          return [record.name, record.certainty, record.matches[0]!.reason];
        },
      );
  }

  test("a monitor is found by the host, the address or the URL host its stored steps check - never by a mention elsewhere", async () => {
    await insertMonitor({
      name: "Checkout site",
      steps: [
        (step: MonitorStep): MonitorStep => {
          return step.setMonitorDestination(
            URL.fromString("https://Shop.Acme.example/health"),
          );
        },
      ],
    });
    await insertMonitor({
      name: "Edge ping",
      steps: [
        (step: MonitorStep): MonitorStep => {
          return step.setMonitorDestination(new IP("203.0.113.7"));
        },
      ],
    });
    await insertMonitor({
      name: "Checkout DNS",
      steps: [
        (step: MonitorStep): MonitorStep => {
          return step.setDnsMonitor({
            queryName: "shop.acme.example",
            hostname: "8.8.8.8",
          } as never);
        },
      ],
    });
    // Names the host in a header, and checks another one.
    await insertMonitor({
      name: "Status API",
      steps: [
        (step: MonitorStep): MonitorStep => {
          return step
            .setMonitorDestination(
              URL.fromString("https://status.acme.example"),
            )
            .setRequestHeaders({ "X-Forwarded-Host": "shop.acme.example" });
        },
      ],
    });
    // Archived: checks nothing any more.
    await insertMonitor({
      name: "Old checkout site",
      isArchived: true,
      steps: [
        (step: MonitorStep): MonitorStep => {
          return step.setMonitorDestination(
            URL.fromString("https://shop.acme.example/"),
          );
        },
      ],
    });
    // Another project's.
    await insertMonitor({
      projectId: otherProjectId,
      name: "Their checkout",
      steps: [
        (step: MonitorStep): MonitorStep => {
          return step.setMonitorDestination(
            URL.fromString("https://shop.acme.example/"),
          );
        },
      ],
    });

    const result: SecurityConnectedRecordsResult =
      await SecurityConnectedRecords.resolve({
        projectId,
        entities: [
          {
            type: SecurityEntityType.Url,
            value: "https://shop.acme.example/admin/login",
          },
          { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
        ],
        props: ROOT,
      });

    expect(monitorsOf(result)).toEqual([
      [
        "Checkout DNS",
        SecurityConnectionCertainty.Exact,
        SecurityConnectionReason.MonitorTarget,
      ],
      [
        "Checkout site",
        SecurityConnectionCertainty.Exact,
        SecurityConnectionReason.MonitorTarget,
      ],
      [
        "Edge ping",
        SecurityConnectionCertainty.Exact,
        SecurityConnectionReason.MonitorTarget,
      ],
    ]);
    expect(result.failedKinds).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  test("a common short word reads no monitor that merely starts with it, and a LIKE wildcard is read as itself", async () => {
    for (let index: number = 0; index < 20; index++) {
      await insertMonitor({
        name: `Site ${index}`,
        steps: [
          (step: MonitorStep): MonitorStep => {
            return step.setMonitorDestination(
              URL.fromString(`https://www.site-${index}.example/`),
            );
          },
        ],
      });
    }

    await insertMonitor({
      name: "Bare www",
      steps: [
        (step: MonitorStep): MonitorStep => {
          return step.setMonitorDestination(new Hostname("www"));
        },
      ],
    });
    await insertMonitor({
      name: "Underscore",
      steps: [
        (step: MonitorStep): MonitorStep => {
          return step.setMonitorDestination(new Hostname("webx1.acme.example"));
        },
      ],
    });

    const read: SpyInstance<typeof MonitorService.findBy> = jest.spyOn(
      MonitorService,
      "findBy",
    );
    const result: SecurityConnectedRecordsResult =
      await SecurityConnectedRecords.resolve({
        projectId,
        entities: [
          { type: SecurityEntityType.Host, value: "www.acme.example" },
          { type: SecurityEntityType.Host, value: "web_1.acme.example" },
        ],
        props: ROOT,
      });

    // Only the monitor of the short form itself, as a possible match.
    expect(monitorsOf(result)).toEqual([
      [
        "Bare www",
        SecurityConnectionCertainty.Possible,
        SecurityConnectionReason.ShortHostName,
      ],
    ]);
    // The database read no monitor of www.site-N, nor webx1 for web_1.
    const found: Array<Monitor> = (await read.mock.results[0]!
      .value) as Array<Monitor>;

    expect(
      found.map((monitor: Monitor): string => {
        return monitor.name || "";
      }),
    ).toEqual(["Bare www"]);
    expect(result.failedKinds).toEqual([]);
  });

  async function insertCloudResource(data: {
    projectId?: ObjectID;
    name: string;
    providerResourceId?: string;
    cloudEndpoints?: Array<string>;
  }): Promise<string> {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "${schema}"."CloudResource" ("_id", "projectId", "name", "providerResourceId", "cloudEndpoints")
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        id,
        (data.projectId || projectId).toString(),
        data.name,
        data.providerResourceId || null,
        data.cloudEndpoints ? JSON.stringify(data.cloudEndpoints) : null,
      ],
    );

    return id;
  }

  test("a cloud resource by its own ID however it is cased, and by the name and the address it answers on, in this project only", async () => {
    await insertCloudResource({
      name: "acme-prod-data",
      providerResourceId: "arn:aws:s3:::acme-prod-data",
    });
    await insertCloudResource({
      name: "checkout-alb",
      cloudEndpoints: [
        "checkout-1234.us-east-1.elb.amazonaws.com",
        "203.0.113.50",
      ],
    });
    // A longer name and a longer address: neither is one of its own.
    await insertCloudResource({
      name: "other-alb",
      cloudEndpoints: [
        "checkout-1234.us-east-1.elb.amazonaws.com.evil.example",
        "203.0.113.501",
      ],
    });
    await insertCloudResource({
      projectId: otherProjectId,
      name: "their bucket",
      providerResourceId: "arn:aws:s3:::acme-prod-data",
    });

    const result: SecurityConnectedRecordsResult =
      await SecurityConnectedRecords.resolve({
        projectId,
        entities: [
          {
            type: SecurityEntityType.Other,
            value: "ARN:AWS:S3:::ACME-PROD-DATA",
          },
          {
            type: SecurityEntityType.Domain,
            value: "checkout-1234.us-east-1.elb.amazonaws.com",
          },
          { type: SecurityEntityType.IpAddress, value: "203.0.113.50" },
        ],
        props: ROOT,
      });

    expect(
      result.records
        .filter((record: SecurityConnectedRecord): boolean => {
          return record.kind === SecurityConnectionKind.CloudResource;
        })
        .map((record: SecurityConnectedRecord) => {
          return [
            record.name,
            record.certainty,
            // Both exact: its name first, whichever read answered first.
            record.matches.map(
              (match: { reason: SecurityConnectionReason }) => {
                return match.reason;
              },
            ),
          ];
        }),
    ).toEqual([
      [
        "acme-prod-data",
        SecurityConnectionCertainty.Exact,
        [SecurityConnectionReason.ResourceId],
      ],
      [
        "checkout-alb",
        SecurityConnectionCertainty.Exact,
        [
          SecurityConnectionReason.CloudEndpoint,
          SecurityConnectionReason.Address,
        ],
      ],
    ]);
    expect(result.failedKinds).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });
});
