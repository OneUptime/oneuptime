import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import HostService from "Common/Server/Services/HostService";
import MonitorService from "Common/Server/Services/MonitorService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import InfrastructureResourceBinding, {
  RESOURCE_KEYS,
} from "Common/Server/Utils/Monitor/InfrastructureResourceBinding";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import BindInfrastructureMonitorSteps, {
  PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/BindInfrastructureMonitorSteps";
import fs from "fs";
import path from "path";

/*
 * Infrastructure monitors stored before their steps kept the resource's id:
 * this binds each one once, so a rename of its cluster, vCenter or host name
 * from then on keeps the monitor on its resource. What binding settles is
 * pinned in Common (InfrastructureResourceBinding.test.ts); what is pinned
 * here is which rows are read and written, with what, and that a row is only
 * written while it still holds what was read.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "BindInfrastructureMonitorSteps";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";

const mockedLogger: { error: jest.Mock; info: jest.Mock } =
  logger as unknown as { error: jest.Mock; info: jest.Mock };

function hostSteps(hostIdentifier: string): JSONObject {
  return {
    _type: "MonitorSteps",
    value: {
      monitorStepsInstanceArray: [
        {
          _type: "MonitorStep",
          value: {
            id: "0b9b1f47-1e8e-4a8b-9f43-3d2b8f4c1a11",
            hostMonitor: {
              hostIdentifier,
              metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
            },
          },
        },
      ],
    },
  };
}

function hostConfigOf(monitorSteps: JSONObject): JSONObject {
  return (
    (
      (monitorSteps["value"] as JSONObject)[
        "monitorStepsInstanceArray"
      ] as Array<JSONObject>
    )[0]!["value"] as JSONObject
  )["hostMonitor"] as JSONObject;
}

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

interface StoredRow {
  _id: string;
  projectId: string;
  monitorType: string;
  monitorSteps: unknown;
}

interface StubbedTable {
  statements: Array<Statement>;
  rows: Array<StoredRow>;
  failUpdatesFor: Set<string>;
}

/*
 * Answers the migration's SELECT from `rows` - only the types it asks for,
 * paged by id as Postgres would page it - and records every statement.
 */
function stubTable(): StubbedTable {
  const table: StubbedTable = {
    statements: [],
    rows: [],
    failUpdatesFor: new Set<string>(),
  };

  const query: jest.Mock = jest.fn(
    async (sql: unknown, parameters: unknown): Promise<unknown> => {
      const statement: Statement = {
        sql: String(sql),
        parameters: (parameters as Array<unknown>) || [],
      };
      table.statements.push(statement);

      if (statement.sql.startsWith("SELECT")) {
        const limit: number = statement.parameters[0] as number;
        const types: Array<string> = statement.parameters[1] as Array<string>;
        const after: string | undefined = statement.parameters[2] as
          | string
          | undefined;

        return table.rows
          .filter((row: StoredRow) => {
            return (
              types.includes(row.monitorType) && (!after || row._id > after)
            );
          })
          .sort((a: StoredRow, b: StoredRow) => {
            return a._id < b._id ? -1 : 1;
          })
          .slice(0, limit);
      }

      if (table.failUpdatesFor.has(statement.parameters[1] as string)) {
        throw new Error("could not write");
      }

      return [];
    },
  ) as unknown as jest.Mock;

  jest
    .spyOn(
      MonitorService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue({
      metadata: { tableName: "Monitor" },
      manager: { query },
    } as never);

  return table;
}

function updatesOf(table: StubbedTable): Array<Statement> {
  return table.statements.filter((statement: Statement) => {
    return statement.sql.startsWith("UPDATE");
  });
}

function selectsOf(table: StubbedTable): Array<Statement> {
  return table.statements.filter((statement: Statement) => {
    return statement.sql.startsWith("SELECT");
  });
}

// The part of a spy the assertions read.
interface SpyLike {
  mock: { calls: Array<Array<unknown>> };
}

// Binds every step to HOST_ID, as a host named in the step would be.
function bindEveryStep(): SpyLike {
  return jest
    .spyOn(InfrastructureResourceBinding, "bindMonitorStepsJSON")
    .mockImplementation(
      async (data: { monitorStepsJSON: JSONObject }): Promise<boolean> => {
        const config: JSONObject = hostConfigOf(data.monitorStepsJSON);

        if (config["resourceId"] === HOST_ID) {
          return false;
        }

        config["resourceId"] = HOST_ID;
        return true;
      },
    ) as unknown as SpyLike;
}

describe("BindInfrastructureMonitorSteps", () => {
  const migration: BindInfrastructureMonitorSteps =
    new BindInfrastructureMonitorSteps();

  let monitors: StubbedTable;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    monitors = stubTable();
  });

  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    function registeredMigrations(): Array<string> {
      return Array.from(indexSource.matchAll(/new\s+(\w+)\(\)/g)).map(
        (match: RegExpMatchArray) => {
          return match[1]!;
        },
      );
    }

    test("is imported and instantiated in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(indexSource).toContain(`new ${MIGRATION_NAME}()`);
    });

    test("sits before the last slot, which AddAuditLogMcpClientColumns keeps", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations[instantiations.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
        instantiations.length - 1,
      );
    });

    test("is registered exactly once", () => {
      expect(
        registeredMigrations().filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }).length,
      ).toBe(1);
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("what it reads", () => {
    test("only the monitor types whose steps name a resource", async () => {
      bindEveryStep();

      await migration.migrate();

      const types: Array<string> = selectsOf(monitors)[0]!
        .parameters[1] as Array<string>;

      expect([...types].sort()).toEqual(Object.keys(RESOURCE_KEYS).sort());
      for (const type of [
        MonitorType.Host,
        MonitorType.Docker,
        MonitorType.Podman,
        MonitorType.Kubernetes,
        MonitorType.DockerSwarm,
        MonitorType.Proxmox,
        MonitorType.VMware,
        MonitorType.Ceph,
        MonitorType.StorageArray,
        MonitorType.IoTDevice,
      ]) {
        expect(types).toContain(type);
      }
      expect(types).not.toContain(MonitorType.Website);
    });

    test("binds each monitor in its own project, as its own type", async () => {
      const bind: SpyLike = bindEveryStep();
      monitors.rows = [
        {
          _id: "a",
          projectId: PROJECT_ID,
          monitorType: MonitorType.Host,
          monitorSteps: hostSteps("web-01"),
        },
      ];

      await migration.migrate();

      expect(bind.mock.calls).toHaveLength(1);
      const args: {
        projectId: { toString: () => string };
        monitorType: string;
      } = bind.mock.calls[0]![0] as never;
      expect(args.projectId.toString()).toBe(PROJECT_ID);
      expect(args.monitorType).toBe(MonitorType.Host);
    });
  });

  describe("what it writes", () => {
    test("the bound steps, only while the row still holds what was read", async () => {
      bindEveryStep();
      const stored: JSONObject = hostSteps("web-01");
      monitors.rows = [
        {
          _id: "a",
          projectId: PROJECT_ID,
          monitorType: MonitorType.Host,
          monitorSteps: stored,
        },
      ];

      await migration.migrate();

      const updates: Array<Statement> = updatesOf(monitors);
      expect(updates).toHaveLength(1);
      expect(updates[0]!.sql).toBe(
        `UPDATE "Monitor" SET "monitorSteps" = $1 WHERE "_id" = $2 AND "monitorSteps" = $3::jsonb`,
      );
      expect(
        hostConfigOf(JSON.parse(updates[0]!.parameters[0] as string)),
      ).toEqual({
        hostIdentifier: "web-01",
        resourceId: HOST_ID,
        metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
      });
      expect(updates[0]!.parameters[1]).toBe("a");
      expect(JSON.parse(updates[0]!.parameters[2] as string)).toEqual(
        hostSteps("web-01"),
      );
    });

    test("with the real binding: a host name typed in another case gets the host's id and keeps its value", async () => {
      jest
        .spyOn(QueryHelper, "findWithSameText")
        .mockImplementation((text: string | number): never => {
          return { sameText: String(text).trim().toLowerCase() } as never;
        });
      jest
        .spyOn(HostService, "findOneBy")
        .mockImplementation(async (data: unknown): Promise<never> => {
          const query: Record<string, unknown> = (
            data as { query: Record<string, unknown> }
          ).query;
          const wanted: { sameText?: string } | undefined = query[
            "hostIdentifier"
          ] as { sameText?: string } | undefined;
          const isMatch: boolean =
            String(query["projectId"]) === PROJECT_ID &&
            wanted?.sameText === "web-01";

          return (
            isMatch ? { _id: HOST_ID, hostIdentifier: "web-01" } : null
          ) as never;
        });
      monitors.rows = [
        {
          _id: "a",
          projectId: PROJECT_ID,
          monitorType: MonitorType.Host,
          monitorSteps: hostSteps(" Web-01"),
        },
        {
          _id: "b",
          projectId: PROJECT_ID,
          monitorType: MonitorType.Host,
          monitorSteps: hostSteps("not-reporting-yet"),
        },
      ];

      await migration.migrate();

      const updates: Array<Statement> = updatesOf(monitors);
      expect(updates).toHaveLength(1);
      expect(updates[0]!.parameters[1]).toBe("a");
      expect(
        hostConfigOf(JSON.parse(updates[0]!.parameters[0] as string)),
      ).toMatchObject({ hostIdentifier: " Web-01", resourceId: HOST_ID });
    });

    test("leaves rows binding changes nothing in alone", async () => {
      jest
        .spyOn(InfrastructureResourceBinding, "bindMonitorStepsJSON")
        .mockResolvedValue(false);
      monitors.rows = [
        {
          _id: "a",
          projectId: PROJECT_ID,
          monitorType: MonitorType.Host,
          monitorSteps: hostSteps("web-01"),
        },
      ];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(0);
    });

    test("reads a column handed back as text", async () => {
      bindEveryStep();
      monitors.rows = [
        {
          _id: "a",
          projectId: PROJECT_ID,
          monitorType: MonitorType.Host,
          monitorSteps: JSON.stringify(hostSteps("web-01")),
        },
      ];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(1);
    });

    test("skips values that are not monitor steps, and rows with no project", async () => {
      const bind: SpyLike = bindEveryStep();
      monitors.rows = [
        {
          _id: "a",
          projectId: PROJECT_ID,
          monitorType: MonitorType.Host,
          monitorSteps: "not json",
        },
        {
          _id: "b",
          projectId: "",
          monitorType: MonitorType.Host,
          monitorSteps: hostSteps("web-01"),
        },
      ];

      await migration.migrate();

      expect(bind.mock.calls).toHaveLength(0);
      expect(updatesOf(monitors)).toHaveLength(0);
    });
  });

  describe("how it walks the table", () => {
    test("pages by id until a short page", async () => {
      bindEveryStep();
      monitors.rows = Array.from(
        { length: PAGE_SIZE + 3 },
        (_value: unknown, index: number) => {
          return {
            _id: `row-${String(index).padStart(5, "0")}`,
            projectId: PROJECT_ID,
            monitorType: MonitorType.Host,
            monitorSteps: hostSteps("web-01"),
          };
        },
      );

      await migration.migrate();

      const selects: Array<Statement> = selectsOf(monitors);
      expect(selects).toHaveLength(2);
      expect(selects[0]!.parameters).toHaveLength(2);
      expect(selects[1]!.parameters[2]).toBe(
        `row-${String(PAGE_SIZE - 1).padStart(5, "0")}`,
      );
      expect(updatesOf(monitors)).toHaveLength(PAGE_SIZE + 3);
    });

    test("keeps going after a row it cannot bind or write", async () => {
      jest
        .spyOn(InfrastructureResourceBinding, "bindMonitorStepsJSON")
        .mockImplementation(
          async (data: { monitorStepsJSON: JSONObject }): Promise<boolean> => {
            if (hostConfigOf(data.monitorStepsJSON)["hostIdentifier"] === "x") {
              throw new Error("lookup failed");
            }

            hostConfigOf(data.monitorStepsJSON)["resourceId"] = HOST_ID;
            return true;
          },
        );
      monitors.rows = [
        {
          _id: "a",
          projectId: PROJECT_ID,
          monitorType: MonitorType.Host,
          monitorSteps: hostSteps("x"),
        },
        {
          _id: "b",
          projectId: PROJECT_ID,
          monitorType: MonitorType.Host,
          monitorSteps: hostSteps("web-01"),
        },
        {
          _id: "c",
          projectId: PROJECT_ID,
          monitorType: MonitorType.Host,
          monitorSteps: hostSteps("web-02"),
        },
      ];
      monitors.failUpdatesFor.add("b");

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(
        updatesOf(monitors).map((statement: Statement) => {
          return statement.parameters[1];
        }),
      ).toEqual(["b", "c"]);
      expect(mockedLogger.error).toHaveBeenCalled();
    });

    test("a second run writes nothing", async () => {
      bindEveryStep();
      monitors.rows = [
        {
          _id: "a",
          projectId: PROJECT_ID,
          monitorType: MonitorType.Host,
          monitorSteps: hostSteps("web-01"),
        },
      ];

      await migration.migrate();

      // What the first run wrote is what the table now holds.
      monitors.rows = [
        {
          ...monitors.rows[0]!,
          monitorSteps: JSON.parse(
            updatesOf(monitors)[0]!.parameters[0] as string,
          ),
        },
      ];
      monitors.statements = [];

      await migration.migrate();

      expect(updatesOf(monitors)).toHaveLength(0);
    });
  });
});
