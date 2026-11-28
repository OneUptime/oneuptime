import ScopeTemplateDashboardVariablesToTheirResources from "../../../FeatureSet/Workers/DataMigrations/ScopeTemplateDashboardVariablesToTheirResources";
import Entities from "Common/Models/DatabaseModels/Index";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import DashboardService from "Common/Server/Services/DashboardService";
import logger from "Common/Server/Utils/Logger";
import { DashboardResourceScope } from "Common/Types/Dashboard/DashboardResourceScope";
import {
  DashboardTemplate,
  DashboardTemplateType,
  DashboardTemplates,
  getTemplateConfig,
} from "Common/Types/Dashboard/DashboardTemplates";
import DashboardVariable, {
  DashboardVariableType,
} from "Common/Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { DataSource } from "Common/node_modules/typeorm";
import fs from "fs";
import path from "path";
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

/*
 * THE TEMPLATE DASHBOARDS PEOPLE ALREADY HAVE, SCOPED TO THEIR KIND OF
 * RESOURCE ON A MIGRATED POSTGRES (#11258).
 *
 * A template is copied into a dashboard when the dashboard is made, so a
 * Kubernetes, Hosts, Docker Swarm, Proxmox, VMware, XCP-ng, OpenStack, Ceph
 * or storage array board made before this release kept reading the whole
 * project at "All". ScopeTemplateDashboardVariablesToTheirResources gives
 * its template variable the kind the template now ships it with. Which
 * variables, on which boards, is pinned in Common's
 * TemplateVariableResourceScopeRepair tests; what is pinned here is the
 * walk, on the real statements against a copy of the migrated table:
 *
 *   - every template's board as it was made before - its config stored as
 *     the app stores it - gets its variable's kind, and nothing else of it
 *     changes;
 *   - a board a person kept using - a pick made, a widget of their own -
 *     keeps all of it;
 *   - nothing else is touched: a person's own board with a variable of the
 *     same name and key, a template board whose variable they renamed or
 *     already gave a kind, the templates that read the whole project;
 *   - a board saved while the migration runs keeps that save;
 *   - a second run changes nothing, and two runs at once come to the same
 *     as one.
 *
 * Opt in with RUN_POSTGRES_TEMPLATE_DASHBOARD_SCOPES_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database, right after its drift check. The Dashboard table's
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema), dropped afterwards; every row is synthetic. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * TEMPLATE_DASHBOARD_SCOPES_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from TEMPLATE_DASHBOARD_SCOPES_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_TEMPLATE_DASHBOARD_SCOPES_TESTS"] === "true"
    ? describe
    : describe.skip;

const MIGRATION_NAME: string =
  "ScopeTemplateDashboardVariablesToTheirResources";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const PROJECT: string = "11258000-0000-4000-8000-0000000000a1";

// When every seeded board was last saved: the walk must not say otherwise.
const SAVED_AT: Date = new Date("2026-06-01T00:00:00.000Z");

function id(suffix: number): string {
  return `11258000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
}

// The templates whose variables name a kind, and the kinds they name.
const SCOPED_TEMPLATES: Array<[DashboardTemplateType, DashboardResourceScope]> =
  [
    [
      DashboardTemplateType.Kubernetes,
      DashboardResourceScope.KubernetesCluster,
    ],
    [
      DashboardTemplateType.KubernetesCost,
      DashboardResourceScope.KubernetesCluster,
    ],
    [DashboardTemplateType.Host, DashboardResourceScope.Host],
    [DashboardTemplateType.Proxmox, DashboardResourceScope.ProxmoxCluster],
    [DashboardTemplateType.VMware, DashboardResourceScope.VMwareVCenter],
    [DashboardTemplateType.XcpNg, DashboardResourceScope.XcpNgPool],
    [DashboardTemplateType.OpenStack, DashboardResourceScope.OpenStackCloud],
    [DashboardTemplateType.Ceph, DashboardResourceScope.CephCluster],
    [DashboardTemplateType.StorageArray, DashboardResourceScope.StorageArray],
    [
      DashboardTemplateType.DockerSwarm,
      DashboardResourceScope.DockerSwarmCluster,
    ],
  ];

// A config as the app stores it: JSON, an ObjectID as its JSON form.
function asStored(config: DashboardViewConfig): JSONObject {
  return JSON.parse(JSON.stringify(config)) as JSONObject;
}

// A template's board as it was made before its variables named a kind.
function madeBeforeTheUpgrade(type: DashboardTemplateType): JSONObject {
  const stored: JSONObject = asStored(getTemplateConfig(type)!);

  for (const variable of (stored["variables"] || []) as Array<JSONObject>) {
    delete variable["resourceScope"];
  }

  return stored;
}

// That board after the upgrade: the template's variables name their kinds.
function afterTheUpgrade(
  stored: JSONObject,
  type: DashboardTemplateType,
): JSONObject {
  const expected: JSONObject = JSON.parse(JSON.stringify(stored));
  const templateVariables: Array<DashboardVariable> =
    getTemplateConfig(type)!.variables || [];

  for (const variable of (expected["variables"] || []) as Array<JSONObject>) {
    const template: DashboardVariable | undefined = templateVariables.find(
      (candidate: DashboardVariable) => {
        return (
          candidate.name === variable["name"] &&
          candidate.attributeKey === variable["attributeKey"]
        );
      },
    );

    if (template?.resourceScope) {
      variable["resourceScope"] = template.resourceScope;
    }
  }

  return expected;
}

interface StoredDashboard {
  _id: string;
  dashboardViewConfig: JSONObject;
  updatedAt: Date;
  version: number;
}

describe(MIGRATION_NAME, () => {
  test("is imported and instantiated in DataMigrations/Index.ts once, after the Hosts' and before the two slots kept last", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );
    const instantiations: Array<string> = Array.from(
      indexSource.matchAll(/new\s+(\w+)\(\)/g),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(indexSource).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );
    expect(
      instantiations.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(instantiations.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      instantiations.indexOf("ArchiveHostsRegisteredFromNonHostTelemetry"),
    );
    expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
      instantiations.length - 2,
    );
  });

  test("is recorded under its class name, and its rollback changes nothing", async () => {
    const migration: ScopeTemplateDashboardVariablesToTheirResources =
      new ScopeTemplateDashboardVariablesToTheirResources();

    expect(migration.name).toBe(MIGRATION_NAME);
    await expect(migration.rollback()).resolves.toBeUndefined();
  });

  test("covers every template whose variable names a kind, and only those", () => {
    const scoped: Array<[DashboardTemplateType, DashboardResourceScope]> = [];

    for (const template of DashboardTemplates as Array<DashboardTemplate>) {
      for (const variable of getTemplateConfig(template.type)?.variables ||
        []) {
        if (variable.resourceScope) {
          scoped.push([template.type, variable.resourceScope]);
        }
      }
    }

    expect(scoped.sort()).toEqual([...SCOPED_TEMPLATES].sort());
  });
});

describePostgres(
  "the template dashboards people already have (Postgres)",
  () => {
    const schema: string = `template_dashboard_scopes_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;

    jest.setTimeout(240000);

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["TEMPLATE_DASHBOARD_SCOPES_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["TEMPLATE_DASHBOARD_SCOPES_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["TEMPLATE_DASHBOARD_SCOPES_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."Dashboard" (LIKE public."Dashboard" INCLUDING ALL)`,
      );
    }, 120000);

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
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);

      await database.query(`DELETE FROM "${schema}"."Dashboard"`);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function insertDashboard(data: {
      id: string;
      name: string;
      config: JSONObject;
    }): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."Dashboard" ("_id", "projectId", "name", "slug", "version", "createdAt", "updatedAt", "dashboardViewConfig") VALUES ($1, $2, $3, $4, 1, $5, $5, $6)`,
        [
          data.id,
          PROJECT,
          data.name,
          data.name.toLowerCase().replace(/\s+/g, "-"),
          SAVED_AT,
          JSON.stringify(data.config),
        ],
      );
    }

    async function readDashboards(): Promise<Map<string, StoredDashboard>> {
      const rows: Array<StoredDashboard> = await database.query(
        `SELECT "_id", "dashboardViewConfig", "updatedAt", "version" FROM "${schema}"."Dashboard" ORDER BY "_id"`,
      );

      return new Map<string, StoredDashboard>(
        rows.map((row: StoredDashboard): [string, StoredDashboard] => {
          return [row._id, row];
        }),
      );
    }

    // Every template's board, made before the upgrade.
    interface Board {
      id: string;
      type: DashboardTemplateType;
      stored: JSONObject;
    }

    async function seedTemplateBoards(): Promise<Array<Board>> {
      const boards: Array<Board> = SCOPED_TEMPLATES.map(
        (
          [type]: [DashboardTemplateType, DashboardResourceScope],
          index: number,
        ): Board => {
          return {
            id: id(100 + index),
            type: type,
            stored: madeBeforeTheUpgrade(type),
          };
        },
      );

      for (const board of boards) {
        await insertDashboard({
          id: board.id,
          name: `${board.type} board`,
          config: board.stored,
        });
      }

      return boards;
    }

    // Boards the migration has no business with.
    async function seedOtherBoards(): Promise<Array<string>> {
      // A person's own board with a "cluster" variable on the same key.
      const own: JSONObject = {
        _type: "DashboardViewConfig",
        components: [
          {
            _type: "DashboardComponent",
            componentType: "Chart",
            componentId: { _type: "ObjectID", value: id(901) },
            topInDashboardUnits: 0,
            leftInDashboardUnits: 0,
            widthInDashboardUnits: 6,
            heightInDashboardUnits: 3,
            minHeightInDashboardUnits: 3,
            minWidthInDashboardUnits: 6,
            arguments: {
              chartTitle: "Checkout latency",
              metricQueryConfig: {
                metricQueryData: {
                  filterData: { metricName: "http.server.duration" },
                },
              },
            },
          },
        ],
        variables: [
          {
            id: id(902),
            name: "cluster",
            label: "Cluster",
            type: DashboardVariableType.TelemetryAttribute,
            attributeKey: "resource.k8s.cluster.name",
            isMultiSelect: false,
          },
        ],
        heightInDashboardUnits: 12,
      };

      // A Hosts board whose variable a person renamed.
      const renamed: JSONObject = madeBeforeTheUpgrade(
        DashboardTemplateType.Host,
      );
      (renamed["variables"] as Array<JSONObject>)[0]!["name"] = "machine";

      // A Kubernetes board made after the upgrade: its variable names its kind.
      const current: JSONObject = asStored(
        getTemplateConfig(DashboardTemplateType.Kubernetes)!,
      );

      const others: Array<[string, string, JSONObject]> = [
        [id(201), "Checkout", own],
        [id(202), "Machines", renamed],
        [id(203), "Kubernetes after the upgrade", current],
        [
          id(204),
          "Metrics",
          madeBeforeTheUpgrade(DashboardTemplateType.Metrics),
        ],
        [
          id(205),
          "Monitors",
          madeBeforeTheUpgrade(DashboardTemplateType.Monitor),
        ],
        [id(206), "RUM", madeBeforeTheUpgrade(DashboardTemplateType.Rum)],
      ];

      for (const [boardId, name, config] of others) {
        await insertDashboard({ id: boardId, name, config });
      }

      return others.map(([boardId]: [string, string, JSONObject]) => {
        return boardId;
      });
    }

    test("every template's board gets its variable's kind, and nothing else of it changes", async () => {
      const boards: Array<Board> = await seedTemplateBoards();

      await new ScopeTemplateDashboardVariablesToTheirResources().migrate();

      const after: Map<string, StoredDashboard> = await readDashboards();

      for (const board of boards) {
        expect([board.type, after.get(board.id)!.dashboardViewConfig]).toEqual([
          board.type,
          afterTheUpgrade(board.stored, board.type),
        ]);
      }

      // Each named the kind its template names.
      for (const [index, [type, scope]] of SCOPED_TEMPLATES.entries()) {
        const variables: Array<JSONObject> = after.get(id(100 + index))!
          .dashboardViewConfig["variables"] as Array<JSONObject>;

        expect([type, variables[0]!["resourceScope"]]).toEqual([type, scope]);
      }
    });

    test("a board a person kept using keeps its pick, its own widget and its layout", async () => {
      const stored: JSONObject = madeBeforeTheUpgrade(
        DashboardTemplateType.Kubernetes,
      );
      const variables: Array<JSONObject> = stored[
        "variables"
      ] as Array<JSONObject>;
      variables[0]!["selectedValue"] = "shop-cluster";
      variables[1]!["selectedValues"] = ["checkout", "payments"];

      const components: Array<JSONObject> = stored[
        "components"
      ] as Array<JSONObject>;
      components[1]!["topInDashboardUnits"] = 40;
      components.push({
        _type: "DashboardComponent",
        componentType: "Chart",
        componentId: { _type: "ObjectID", value: id(903) },
        topInDashboardUnits: 41,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 6,
        heightInDashboardUnits: 3,
        minHeightInDashboardUnits: 3,
        minWidthInDashboardUnits: 6,
        arguments: {
          chartTitle: "Checkout latency",
          metricQueryConfig: {
            metricQueryData: {
              filterData: { metricName: "http.server.duration" },
            },
          },
        },
      });

      await insertDashboard({
        id: id(301),
        name: "Production cluster",
        config: stored,
      });

      await new ScopeTemplateDashboardVariablesToTheirResources().migrate();

      const after: JSONObject = (await readDashboards()).get(
        id(301),
      )!.dashboardViewConfig;

      expect(after).toEqual(
        afterTheUpgrade(stored, DashboardTemplateType.Kubernetes),
      );
      expect((after["variables"] as Array<JSONObject>)[0]).toEqual({
        ...variables[0],
        resourceScope: DashboardResourceScope.KubernetesCluster,
      });
      // The namespace variable names no kind: the cluster's narrows it.
      expect((after["variables"] as Array<JSONObject>)[1]).toEqual(
        variables[1],
      );
    });

    test("leaves every other board exactly as it is: a person's own, a renamed variable, one already scoped, the whole-project templates", async () => {
      const others: Array<string> = await seedOtherBoards();
      const before: Map<string, StoredDashboard> = await readDashboards();

      await new ScopeTemplateDashboardVariablesToTheirResources().migrate();

      const after: Map<string, StoredDashboard> = await readDashboards();

      for (const boardId of others) {
        expect([boardId, after.get(boardId)]).toEqual([
          boardId,
          before.get(boardId),
        ]);
      }
    });

    test("a board saved while the migration runs keeps that save", async () => {
      const stored: JSONObject = madeBeforeTheUpgrade(
        DashboardTemplateType.Host,
      );
      await insertDashboard({ id: id(401), name: "Hosts", config: stored });

      // A person's save lands between the migration's read and its write.
      const theirSave: JSONObject = JSON.parse(JSON.stringify(stored));
      (theirSave["variables"] as Array<JSONObject>)[0]!["label"] = "Machine";

      const read: typeof DashboardService.findOneById =
        DashboardService.findOneById.bind(DashboardService);

      jest
        .spyOn(DashboardService, "findOneById")
        .mockImplementation(async (...args: Array<unknown>) => {
          const found: Dashboard | null = await read(
            ...(args as Parameters<typeof DashboardService.findOneById>),
          );

          await database.query(
            `UPDATE "${schema}"."Dashboard" SET "dashboardViewConfig" = $1, "version" = "version" + 1 WHERE "_id" = $2`,
            [JSON.stringify(theirSave), id(401)],
          );

          return found;
        });

      await new ScopeTemplateDashboardVariablesToTheirResources().migrate();

      expect(
        (await readDashboards()).get(id(401))!.dashboardViewConfig,
      ).toEqual(theirSave);
    });

    test("a second run changes nothing, and two runs at once come to the same as one", async () => {
      const boards: Array<Board> = await seedTemplateBoards();
      await seedOtherBoards();

      await Promise.all([
        new ScopeTemplateDashboardVariablesToTheirResources().migrate(),
        new ScopeTemplateDashboardVariablesToTheirResources().migrate(),
      ]);

      const once: Map<string, StoredDashboard> = await readDashboards();

      for (const board of boards) {
        expect(once.get(board.id)!.dashboardViewConfig).toEqual(
          afterTheUpgrade(board.stored, board.type),
        );
      }

      await new ScopeTemplateDashboardVariablesToTheirResources().migrate();

      expect(await readDashboards()).toEqual(once);
    });
  },
);
