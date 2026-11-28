import GroupHostsDashboardChartsByHost from "../../../FeatureSet/Workers/DataMigrations/GroupHostsDashboardChartsByHost";
import ScopeTemplateDashboardVariablesToTheirResources from "../../../FeatureSet/Workers/DataMigrations/ScopeTemplateDashboardVariablesToTheirResources";
import Entities from "Common/Models/DatabaseModels/Index";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import logger from "Common/Server/Utils/Logger";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "Common/Types/Dashboard/DashboardTemplates";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  HOST_GROUP_BY_KEY,
  LEGACY_HOST_GROUP_BY_KEY,
} from "Common/Utils/Dashboard/HostsDashboardChartGroupingRepair";
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
 * THE HOSTS DASHBOARDS PEOPLE ALREADY HAVE, THEIR CHARTS BY HOST DRAWING A
 * LINE PER HOST ON A MIGRATED POSTGRES (#11258).
 *
 * The Hosts template's six charts by host grouped by a bare `host.name`,
 * which no row carries, so each drew every host as one line.
 * GroupHostsDashboardChartsByHost groups a dashboard made before the fix by
 * `resource.host.name`, as the template now does. Which charts is pinned in
 * Common's HostsDashboardChartGroupingRepair tests; what is pinned here is
 * the walk, on the real statements against a copy of the migrated table:
 * Postgres's containment finds them, a Hosts dashboard comes out as the
 * template makes it now (with the variable's kind, after
 * ScopeTemplateDashboardVariablesToTheirResources, as the upgrade runs
 * them), a person's own chart grouped by `host.name` and every other
 * dashboard are left exactly as they are, and a second run, or two at once,
 * changes nothing more.
 *
 * Opt in with RUN_POSTGRES_HOSTS_DASHBOARD_GROUPING_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database, right after its drift check. The Dashboard table's
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema), dropped afterwards; every row is synthetic. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * HOSTS_DASHBOARD_GROUPING_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from HOSTS_DASHBOARD_GROUPING_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_HOSTS_DASHBOARD_GROUPING_TESTS"] === "true"
    ? describe
    : describe.skip;

const MIGRATION_NAME: string = "GroupHostsDashboardChartsByHost";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const PROJECT: string = "11258000-0000-4000-8000-0000000000b1";

const SAVED_AT: Date = new Date("2026-06-01T00:00:00.000Z");

function id(suffix: number): string {
  return `11258000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
}

function groupingOf(component: JSONObject): JSONObject | undefined {
  return (
    (component["arguments"] as JSONObject | undefined)?.[
      "metricQueryConfig"
    ] as JSONObject | undefined
  )?.["metricQueryData"] as JSONObject | undefined;
}

// A Hosts dashboard as the template made it before either fix.
function hostsDashboardMadeBefore(): JSONObject {
  const stored: JSONObject = JSON.parse(
    JSON.stringify(getTemplateConfig(DashboardTemplateType.Host)!),
  );

  for (const variable of stored["variables"] as Array<JSONObject>) {
    delete variable["resourceScope"];
  }

  for (const component of stored["components"] as Array<JSONObject>) {
    const metricQueryData: JSONObject | undefined = groupingOf(component);

    if (
      JSON.stringify(metricQueryData?.["groupByAttributeKeys"]) ===
      JSON.stringify([HOST_GROUP_BY_KEY])
    ) {
      metricQueryData!["groupByAttributeKeys"] = [LEGACY_HOST_GROUP_BY_KEY];
    }
  }

  return stored;
}

// That dashboard as the template makes it now: its own ids, the fixes in.
function asTheTemplateMakesItNow(stored: JSONObject): JSONObject {
  const expected: JSONObject = JSON.parse(JSON.stringify(stored));
  const template: JSONObject = JSON.parse(
    JSON.stringify(getTemplateConfig(DashboardTemplateType.Host)!),
  );

  (expected["variables"] as Array<JSONObject>).forEach(
    (variable: JSONObject, index: number) => {
      const scope: JSONObject[string] = (
        template["variables"] as Array<JSONObject>
      )[index]!["resourceScope"];

      if (scope) {
        variable["resourceScope"] = scope;
      }
    },
  );

  (expected["components"] as Array<JSONObject>).forEach(
    (component: JSONObject, index: number) => {
      const templateGrouping: JSONObject | undefined = groupingOf(
        (template["components"] as Array<JSONObject>)[index]!,
      );
      const grouping: JSONObject | undefined = groupingOf(component);

      if (grouping && templateGrouping?.["groupByAttributeKeys"]) {
        grouping["groupByAttributeKeys"] =
          templateGrouping["groupByAttributeKeys"];
      }
    },
  );

  return expected;
}

interface StoredDashboard {
  _id: string;
  dashboardViewConfig: JSONObject;
  updatedAt: Date;
  version: number;
}

describe(MIGRATION_NAME, () => {
  test("is imported and instantiated in DataMigrations/Index.ts once, after the template variables' and before the two slots kept last", () => {
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
      instantiations.indexOf("ScopeTemplateDashboardVariablesToTheirResources"),
    );
    expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
      instantiations.length - 2,
    );
  });

  test("is recorded under its class name, and its rollback changes nothing", async () => {
    const migration: GroupHostsDashboardChartsByHost =
      new GroupHostsDashboardChartsByHost();

    expect(migration.name).toBe(MIGRATION_NAME);
    await expect(migration.rollback()).resolves.toBeUndefined();
  });
});

describePostgres("the Hosts dashboards people already have (Postgres)", () => {
  const schema: string = `hosts_dashboard_grouping_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;

  let database: DataSource;

  jest.setTimeout(240000);

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["HOSTS_DASHBOARD_GROUPING_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["HOSTS_DASHBOARD_GROUPING_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["HOSTS_DASHBOARD_GROUPING_TEST_DATABASE_NAME"] ||
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

  // A person's own dashboard with a chart grouped by a datapoint host.name.
  function ownDashboard(): JSONObject {
    return {
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
            chartTitle: "Queue depth by host",
            metricQueryConfig: {
              metricQueryData: {
                filterData: { metricName: "queue.depth" },
                groupByAttributeKeys: [LEGACY_HOST_GROUP_BY_KEY],
              },
            },
          },
        },
      ],
      variables: [],
      heightInDashboardUnits: 12,
    };
  }

  test("a Hosts dashboard comes out of the upgrade as the template makes it now, and nothing else is touched", async () => {
    const hosts: JSONObject = hostsDashboardMadeBefore();
    const own: JSONObject = ownDashboard();
    const kubernetes: JSONObject = JSON.parse(
      JSON.stringify(getTemplateConfig(DashboardTemplateType.Kubernetes)!),
    );

    await insertDashboard({ id: id(101), name: "Hosts", config: hosts });
    await insertDashboard({ id: id(102), name: "Queues", config: own });
    await insertDashboard({
      id: id(103),
      name: "Kubernetes",
      config: kubernetes,
    });

    const before: Map<string, StoredDashboard> = await readDashboards();

    // As the upgrade runs them, in their order.
    await new ScopeTemplateDashboardVariablesToTheirResources().migrate();
    await new GroupHostsDashboardChartsByHost().migrate();

    const after: Map<string, StoredDashboard> = await readDashboards();

    expect(after.get(id(101))!.dashboardViewConfig).toEqual(
      asTheTemplateMakesItNow(hosts),
    );
    expect(after.get(id(102))).toEqual(before.get(id(102)));
    expect(after.get(id(103))).toEqual(before.get(id(103)));
  });

  test("a second run changes nothing, and two runs at once come to the same as one", async () => {
    const hosts: JSONObject = hostsDashboardMadeBefore();

    await insertDashboard({ id: id(201), name: "Hosts", config: hosts });
    await insertDashboard({
      id: id(202),
      name: "Queues",
      config: ownDashboard(),
    });

    await Promise.all([
      new GroupHostsDashboardChartsByHost().migrate(),
      new GroupHostsDashboardChartsByHost().migrate(),
    ]);

    const once: Map<string, StoredDashboard> = await readDashboards();
    const charts: Array<JSONObject> = once.get(id(201))!.dashboardViewConfig[
      "components"
    ] as Array<JSONObject>;

    expect(
      charts
        .map(groupingOf)
        .filter((grouping: JSONObject | undefined) => {
          return Boolean(grouping?.["groupByAttributeKeys"]);
        })
        .map((grouping: JSONObject | undefined) => {
          return grouping!["groupByAttributeKeys"];
        }),
    ).toEqual(new Array(6).fill([HOST_GROUP_BY_KEY]));

    await new GroupHostsDashboardChartsByHost().migrate();

    expect(await readDashboards()).toEqual(once);
  });
});
