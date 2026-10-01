import { describe, expect, jest, test } from "@jest/globals";

/*
 * The metrics chip builder's module reaches the entity-name resolver, which
 * imports ModelAPI; nothing here resolves a name, so a stub keeps the suite
 * in plain Node.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import type { LockedFilterScopeMatch } from "Common/Types/Telemetry/LockedFilterDetail";
import type { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import {
  DATABASE_ENDPOINT_MATCH_DESCRIPTION,
  DATABASE_ENDPOINT_MATCH_LABEL,
  DATABASE_ID_MATCH_DESCRIPTION,
  DATABASE_ID_MATCH_LABEL,
  DATABASE_MEMBER_MATCH_DESCRIPTION,
  DATABASE_MEMBER_MATCH_LABEL,
  DATABASE_SCOPE_GROUP_ID_PREFIX,
  DATABASE_SCOPE_SUMMARY,
  DATABASE_SERVER_CHIP_KEY,
  DatabaseServerScopeSource,
  buildDatabaseServerEntityKeyDisplays,
  getDatabaseServerFormattedEndpoints,
  getDatabaseServerScopeKeys,
} from "../../FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseTelemetryScope";
import {
  ENTITY_KEY_GROUP_NO_SYNTAX_REASON,
  LockedEntityKeyDisplayMap,
  buildLockedEntityKeyChips,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import { ENTITY_KEYS_FACET_KEY } from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";
import { buildTracesLockedEntityKeyChips } from "../../FeatureSet/Dashboard/src/Components/Traces/TracesEntityDisplay";
import { buildMetricsActiveFilterChips } from "../../FeatureSet/Dashboard/src/Utils/MetricsEntityChipDisplay";
import { buildExceptionLockedEntityKeyChips } from "../../FeatureSet/Dashboard/src/Utils/ExceptionsEntityChipDisplay";
import { keyForKubernetesPod } from "Common/Utils/Telemetry/EntityKey";

/*
 * THE REGRESSION: a CloudNativePG database's Logs, Traces and Metrics tabs
 * each showed 26 locked chips — "Database: …", then 24 "Database Endpoint:
 * …" pills (four Services times three ports, each with and without the
 * cluster suffix) and a "Database Instance: …" — so the chip bar read as 26
 * separate filters when the page applies ONE: this database. The tabs now
 * show a single "Database: <name>" chip whose tooltip lists the id, the 24
 * endpoints and the instance it matches.
 *
 * Built from the real database helpers and every viewer's real chip
 * builder, with the shape of the cluster that surfaced the bug.
 */

const PROJECT_ID: string = "689f90f9-8e97-494a-8d16-23519981d04d";
const DATABASE_ID: string = "aaed6619-f358-4d43-bfe3-3d2d314f5748";
const DATABASE_NAME: string = "PostgreSQL default/oneuptime-postgresql-cnpg";
const CLUSTER: string = "oneuptime-test";

const SERVICES: Array<string> = [
  "oneuptime-postgresql-cnpg",
  "oneuptime-postgresql-cnpg-r",
  "oneuptime-postgresql-cnpg-ro",
  "oneuptime-postgresql-cnpg-rw",
];
const PORTS: Array<number> = [5432, 8000, 9187];

function cnpgEndpoints(): Array<string> {
  const endpoints: Array<string> = [];
  for (const service of SERVICES) {
    for (const port of PORTS) {
      const address: string = `${service}.default.svc.cluster.local:${port}`;
      endpoints.push(address, `${address}@${CLUSTER}`);
    }
  }
  return endpoints;
}

const POD_KEY: string = keyForKubernetesPod(PROJECT_ID, {
  clusterName: CLUSTER,
  namespace: "default",
  podName: "oneuptime-postgresql-cnpg-1",
});

function cnpgSource(): DatabaseServerScopeSource & { name: string } {
  return {
    projectId: PROJECT_ID,
    id: DATABASE_ID,
    endpoints: cnpgEndpoints(),
    dbSystem: "postgresql",
    memberEntityKeys: { [POD_KEY]: "2026-09-30T14:50:00.000Z" },
    name: DATABASE_NAME,
  };
}

function scope(): {
  keys: Array<string>;
  displays: LockedEntityKeyDisplayMap;
} {
  const source: DatabaseServerScopeSource & { name: string } = cnpgSource();
  return {
    keys: getDatabaseServerScopeKeys(source),
    displays: buildDatabaseServerEntityKeyDisplays(source),
  };
}

function expectOneDatabaseChip(chips: Array<ActiveFilter>): ActiveFilter {
  const entityKeyChips: Array<ActiveFilter> = chips.filter(
    (chip: ActiveFilter): boolean => {
      return chip.facetKey === ENTITY_KEYS_FACET_KEY;
    },
  );

  expect(entityKeyChips).toHaveLength(1);
  expect(entityKeyChips[0]).toMatchObject({
    facetKey: ENTITY_KEYS_FACET_KEY,
    value: `${DATABASE_SCOPE_GROUP_ID_PREFIX}${DATABASE_ID}`,
    displayKey: DATABASE_SERVER_CHIP_KEY,
    displayValue: DATABASE_NAME,
    readOnly: true,
  });

  return entityKeyChips[0]!;
}

describe("a CloudNativePG database's scope chip", () => {
  test("the fixture is the 26-key scope that produced 26 chips", () => {
    const { keys } = scope();

    // Row key + 24 endpoints + one pod.
    expect(getDatabaseServerFormattedEndpoints(cnpgSource())).toHaveLength(24);
    expect(keys).toHaveLength(26);
  });

  test("the Logs tab shows one chip", () => {
    const { keys, displays } = scope();

    expectOneDatabaseChip(
      buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: keys,
        displays: displays,
      }),
    );
  });

  test("the Traces tab shows one chip", () => {
    const { keys, displays } = scope();

    expectOneDatabaseChip(
      buildTracesLockedEntityKeyChips({
        entityKeysFilter: keys,
        displays: displays,
        lockedChips: [],
      }),
    );
  });

  test("the Metrics tab shows one chip", () => {
    const { keys, displays } = scope();

    const chips: Array<ActiveFilter> = buildMetricsActiveFilterChips({
      scopeIds: undefined,
      scopeEntityType: undefined,
      attributeFilters: undefined,
      entityKeysFilter: keys,
      entityKeyDisplays: displays,
      activeFilters: [],
      facetConfigs: [],
      nameMap: undefined,
    });

    expect(chips).toHaveLength(1);
    expectOneDatabaseChip(chips);
  });

  test("an exceptions list scoped the same way shows one chip", () => {
    const { keys, displays } = scope();

    expectOneDatabaseChip(
      buildExceptionLockedEntityKeyChips({
        entityKeysFilter: keys,
        entityKeyDisplays: displays,
      }),
    );
  });

  test("its tooltip says exactly what it filters on", () => {
    const { keys, displays } = scope();

    const chip: ActiveFilter = expectOneDatabaseChip(
      buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: keys,
        displays: displays,
      }),
    );

    expect(chip.lockedDetail!.scopeSummary).toBe(DATABASE_SCOPE_SUMMARY);

    const matches: Array<LockedFilterScopeMatch> =
      chip.lockedDetail!.scopeMatches!;

    expect(
      matches.map((match: LockedFilterScopeMatch): string => {
        return `${match.label} (${match.values.length})`;
      }),
    ).toEqual([
      `${DATABASE_ID_MATCH_LABEL} (1)`,
      `${DATABASE_ENDPOINT_MATCH_LABEL} (24)`,
      `${DATABASE_MEMBER_MATCH_LABEL} (1)`,
    ]);

    expect(matches[0]!).toEqual({
      label: DATABASE_ID_MATCH_LABEL,
      description: DATABASE_ID_MATCH_DESCRIPTION,
      values: [DATABASE_ID],
    });
    expect(matches[1]!.description).toBe(DATABASE_ENDPOINT_MATCH_DESCRIPTION);
    expect(matches[1]!.values).toEqual(
      getDatabaseServerFormattedEndpoints(cnpgSource()),
    );
    expect(matches[1]!.values).toContain(
      "oneuptime-postgresql-cnpg-rw.default.svc.cluster.local:5432@oneuptime-test",
    );
    expect(matches[2]!).toEqual({
      label: DATABASE_MEMBER_MATCH_LABEL,
      description: DATABASE_MEMBER_MATCH_DESCRIPTION,
      values: [`${DATABASE_NAME} (${POD_KEY.substring(0, 8)})`],
    });
  });

  test("it offers no search syntax, and says why", () => {
    const { keys, displays } = scope();

    const chip: ActiveFilter = expectOneDatabaseChip(
      buildLockedEntityKeyChips({
        rows: "logs",
        entityKeys: keys,
        displays: displays,
      }),
    );

    expect(chip.lockedDetail!.searchToken).toBeUndefined();
    expect(chip.lockedDetail!.searchTokenUnavailableReason).toBe(
      ENTITY_KEY_GROUP_NO_SYNTAX_REASON,
    );
  });

  test("the chip is display only: every key still reaches the query", () => {
    const { keys, displays } = scope();

    buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: keys,
      displays: displays,
    });

    // The viewers query by these keys; grouping must not have touched them.
    expect(keys).toHaveLength(26);
    expect(Object.keys(displays).sort()).toEqual([...keys].sort());
  });

  test("a database scoped by its id alone still shows one named chip", () => {
    const source: DatabaseServerScopeSource & { name: string } = {
      ...cnpgSource(),
      endpoints: [],
      memberEntityKeys: {},
    };

    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: getDatabaseServerScopeKeys(source),
      displays: buildDatabaseServerEntityKeyDisplays(source),
    });

    const chip: ActiveFilter = expectOneDatabaseChip(chips);
    expect(chip.lockedDetail!.scopeMatches).toEqual([
      {
        label: DATABASE_ID_MATCH_LABEL,
        description: DATABASE_ID_MATCH_DESCRIPTION,
        values: [DATABASE_ID],
      },
    ]);
  });

  test("an unnamed database's chip is named after its engine", () => {
    const source: DatabaseServerScopeSource & { name: string } = {
      ...cnpgSource(),
      name: "   ",
    };

    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: getDatabaseServerScopeKeys(source),
      displays: buildDatabaseServerEntityKeyDisplays(source),
    });

    expect(chips).toHaveLength(1);
    expect(chips[0]!.displayValue).toBe("PostgreSQL");
  });

  test("two databases on one page keep their own chips", () => {
    const orders: DatabaseServerScopeSource & { name: string } = {
      projectId: PROJECT_ID,
      id: "11111111-1111-4111-8111-111111111111",
      endpoints: ["orders.prod:5432"],
      dbSystem: "postgresql",
      name: "orders",
    };
    const cache: DatabaseServerScopeSource & { name: string } = {
      projectId: PROJECT_ID,
      id: "22222222-2222-4222-8222-222222222222",
      endpoints: ["cache.prod:6379"],
      dbSystem: "redis",
      name: "cache",
    };

    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [
        ...getDatabaseServerScopeKeys(orders),
        ...getDatabaseServerScopeKeys(cache),
      ],
      displays: {
        ...buildDatabaseServerEntityKeyDisplays(orders),
        ...buildDatabaseServerEntityKeyDisplays(cache),
      },
    });

    expect(
      chips.map((chip: ActiveFilter): string => {
        return `${chip.displayKey}: ${chip.displayValue}`;
      }),
    ).toEqual(["Database: orders", "Database: cache"]);
  });
});
