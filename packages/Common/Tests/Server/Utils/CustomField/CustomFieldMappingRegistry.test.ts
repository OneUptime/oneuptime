import { describe, expect, test } from "@jest/globals";
import CustomFieldMappingSourceResource from "../../../../Types/CustomField/CustomFieldMappingSourceResource";
import { CustomFieldMappingSourceInfo } from "../../../../Types/CustomField/CustomFieldMappingCatalog";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertCustomField from "../../../../Models/DatabaseModels/AlertCustomField";
import IncidentCustomField from "../../../../Models/DatabaseModels/IncidentCustomField";
import ScheduledMaintenanceCustomField from "../../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import {
  CustomFieldMappingSourceEntry,
  CustomFieldMappingTargetEntry,
  getCustomFieldMappingTarget,
  getCustomFieldMappingTargets,
  getCustomFieldMappingTargetsForSource,
} from "../../../../Server/Utils/CustomField/CustomFieldMappingRegistry";

/*
 * The registry is the server half of the custom-field mapping catalog, and
 * three separate behaviours in it are load bearing in ways nothing else
 * checks:
 *
 *   - it is MEMOISED, and CustomFieldMappingService.propagateFromSourceRecord
 *     matches source entries by REFERENCE across two accessor calls. Handing
 *     out fresh objects would leave that filter matching nothing, and field
 *     propagation would stop working with no error anywhere.
 *
 *   - readSourceIdsFromPayload distinguishes null ("the payload says nothing
 *     about the relation") from [] ("the relation was cleared"). Collapsing
 *     the two would make every unrelated update look like a detach.
 *
 *   - readHydratedSourcesFromPayload must refuse an id STUB. A monitor read
 *     without its customFields column is not a monitor whose bag is empty;
 *     treating it as empty skips the lookup and silently inherits nothing.
 */

const ALERT_TABLE: string = new AlertCustomField().tableName!;
const INCIDENT_TABLE: string = new IncidentCustomField().tableName!;
const SCHEDULED_MAINTENANCE_TABLE: string =
  new ScheduledMaintenanceCustomField().tableName!;

const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

type GetSourceFunction = (
  definitionTableName: string,
) => CustomFieldMappingSourceEntry;

const getSource: GetSourceFunction = (
  definitionTableName: string,
): CustomFieldMappingSourceEntry => {
  const target: CustomFieldMappingTargetEntry | undefined =
    getCustomFieldMappingTarget(definitionTableName);

  if (!target || !target.sources[0]) {
    throw new Error(`No mapping source registered for ${definitionTableName}`);
  }

  return target.sources[0];
};

type BuildMonitorFunction = (data: {
  id: ObjectID;
  customFields?: JSONObject | null | undefined;
  hydrated?: boolean;
}) => Monitor;

const buildMonitor: BuildMonitorFunction = (data: {
  id: ObjectID;
  customFields?: JSONObject | null | undefined;
  hydrated?: boolean;
}): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.id = data.id;

  if (data.hydrated !== false) {
    monitor.customFields = (data.customFields ?? null) as JSONObject;
  }

  return monitor;
};

describe("the registry mirrors the catalog, and only the catalog", () => {
  test("registers exactly the three targets the catalog lists", () => {
    const names: Array<string> = getCustomFieldMappingTargets().map(
      (target: CustomFieldMappingTargetEntry) => {
        return target.targetName;
      },
    );

    expect(names).toEqual(["Alert", "Incident", "Scheduled Maintenance"]);
  });

  test("keys every target by its definition table name", () => {
    expect(getCustomFieldMappingTarget(ALERT_TABLE)?.targetName).toBe("Alert");
    expect(getCustomFieldMappingTarget(INCIDENT_TABLE)?.targetName).toBe(
      "Incident",
    );
    expect(
      getCustomFieldMappingTarget(SCHEDULED_MAINTENANCE_TABLE)?.targetName,
    ).toBe("Scheduled Maintenance");
  });

  test("returns undefined for a definition table with no mapping", () => {
    expect(getCustomFieldMappingTarget("TeamCustomField")).toBeUndefined();
  });

  test("returns undefined rather than throwing when handed no table name", () => {
    expect(getCustomFieldMappingTarget(undefined)).toBeUndefined();
    expect(getCustomFieldMappingTarget("")).toBeUndefined();
  });

  test("every registered source is a Monitor source today", () => {
    for (const target of getCustomFieldMappingTargets()) {
      expect(target.sources.length).toBe(1);
      expect(target.sources[0]!.info.resource).toBe(
        CustomFieldMappingSourceResource.Monitor,
      );
    }
  });

  test("Alert takes one monitor; Incident and Scheduled Maintenance take many", () => {
    expect(getSource(ALERT_TABLE).info.isManySources).toBe(false);
    expect(getSource(INCIDENT_TABLE).info.isManySources).toBe(true);
    expect(getSource(SCHEDULED_MAINTENANCE_TABLE).info.isManySources).toBe(
      true,
    );
  });
});

describe("memoisation - propagation matches source entries by reference", () => {
  test("hands back the identical target array on every call", () => {
    expect(getCustomFieldMappingTargets()).toBe(getCustomFieldMappingTargets());
  });

  test("hands back the identical source object on every call", () => {
    expect(getSource(ALERT_TABLE)).toBe(getSource(ALERT_TABLE));
  });

  test("the reverse lookup yields the same source object the forward lookup does", () => {
    const reverse: Array<{
      target: CustomFieldMappingTargetEntry;
      source: CustomFieldMappingSourceEntry;
    }> = getCustomFieldMappingTargetsForSource(
      CustomFieldMappingSourceResource.Monitor,
    );

    const alertPair: {
      target: CustomFieldMappingTargetEntry;
      source: CustomFieldMappingSourceEntry;
    } = reverse.find(
      (pair: {
        target: CustomFieldMappingTargetEntry;
        source: CustomFieldMappingSourceEntry;
      }) => {
        return pair.target.definitionTableName === ALERT_TABLE;
      },
    )!;

    expect(alertPair.source).toBe(getSource(ALERT_TABLE));
  });
});

describe("the reverse lookup used when a monitor's fields change", () => {
  test("finds all three targets for the Monitor resource", () => {
    const matches: Array<{
      target: CustomFieldMappingTargetEntry;
      source: CustomFieldMappingSourceEntry;
    }> = getCustomFieldMappingTargetsForSource(
      CustomFieldMappingSourceResource.Monitor,
    );

    expect(
      matches.map(
        (pair: {
          target: CustomFieldMappingTargetEntry;
          source: CustomFieldMappingSourceEntry;
        }) => {
          return pair.target.targetName;
        },
      ),
    ).toEqual(["Alert", "Incident", "Scheduled Maintenance"]);
  });

  test("finds nothing for a resource that maps to no target", () => {
    expect(
      getCustomFieldMappingTargetsForSource(
        "SomeResourceNobodyRegistered" as CustomFieldMappingSourceResource,
      ),
    ).toEqual([]);
  });
});

describe("the select clause pulled off a persisted target record", () => {
  test("a single source selects the FK column itself", () => {
    expect(getSource(ALERT_TABLE).targetRelationSelect).toEqual({
      monitorId: true,
    });
  });

  test("a many source selects only the ids of the relation array", () => {
    expect(getSource(INCIDENT_TABLE).targetRelationSelect).toEqual({
      monitors: { _id: true },
    });
  });
});

describe("reading source ids off a persisted target record", () => {
  test("reads the FK column of a single-source target", () => {
    expect(
      getSource(ALERT_TABLE)
        .readSourceIdsFromRecord({ monitorId: MONITOR_ID })
        .map((id: ObjectID) => {
          return id.toString();
        }),
    ).toEqual([MONITOR_ID.toString()]);
  });

  test("reads the relation-object spelling of a single-source target too", () => {
    expect(
      getSource(ALERT_TABLE)
        .readSourceIdsFromRecord({ monitor: { _id: MONITOR_ID.toString() } })
        .map((id: ObjectID) => {
          return id.toString();
        }),
    ).toEqual([MONITOR_ID.toString()]);
  });

  test("reads an empty list from a single-source target with no monitor", () => {
    expect(getSource(ALERT_TABLE).readSourceIdsFromRecord({})).toEqual([]);
    expect(
      getSource(ALERT_TABLE).readSourceIdsFromRecord({ monitorId: null }),
    ).toEqual([]);
  });

  test("reads every id off a many-source target", () => {
    const second: ObjectID = new ObjectID(
      "33333333-3333-4333-8333-333333333333",
    );

    expect(
      getSource(INCIDENT_TABLE)
        .readSourceIdsFromRecord({
          monitors: [
            buildMonitor({ id: MONITOR_ID }),
            buildMonitor({ id: second }),
          ],
        })
        .map((id: ObjectID) => {
          return id.toString();
        }),
    ).toEqual([MONITOR_ID.toString(), second.toString()]);
  });

  test("drops entries of a many-source relation that carry no id", () => {
    expect(
      getSource(INCIDENT_TABLE).readSourceIdsFromRecord({
        monitors: [new Monitor(), buildMonitor({ id: MONITOR_ID })],
      }).length,
    ).toBe(1);
  });

  test("reads an empty list from a many-source target with no relation at all", () => {
    expect(getSource(INCIDENT_TABLE).readSourceIdsFromRecord({})).toEqual([]);
  });
});

describe("null means silence, [] means cleared", () => {
  test("a single-source payload that never names the relation reads null", () => {
    expect(
      getSource(ALERT_TABLE).readSourceIdsFromPayload({ title: "Unrelated" }),
    ).toBeNull();
  });

  test("a single-source payload that clears the relation reads an empty list", () => {
    expect(
      getSource(ALERT_TABLE).readSourceIdsFromPayload({ monitorId: null }),
    ).toEqual([]);
  });

  test("a single-source payload reads the FK spelling", () => {
    expect(
      getSource(ALERT_TABLE)
        .readSourceIdsFromPayload({ monitorId: MONITOR_ID })!
        .map((id: ObjectID) => {
          return id.toString();
        }),
    ).toEqual([MONITOR_ID.toString()]);
  });

  test("a single-source payload reads the dashboard's relation spelling", () => {
    expect(
      getSource(ALERT_TABLE)
        .readSourceIdsFromPayload({ monitor: { _id: MONITOR_ID.toString() } })!
        .map((id: ObjectID) => {
          return id.toString();
        }),
    ).toEqual([MONITOR_ID.toString()]);
  });

  test("a many-source payload that never names the relation reads null", () => {
    expect(
      getSource(INCIDENT_TABLE).readSourceIdsFromPayload({
        title: "Unrelated",
      }),
    ).toBeNull();
  });

  test("a many-source payload that empties the relation reads an empty list", () => {
    expect(
      getSource(INCIDENT_TABLE).readSourceIdsFromPayload({ monitors: [] }),
    ).toEqual([]);
  });

  test("a many-source payload reads every attached id", () => {
    expect(
      getSource(INCIDENT_TABLE)
        .readSourceIdsFromPayload({
          monitors: [buildMonitor({ id: MONITOR_ID })],
        })!
        .map((id: ObjectID) => {
          return id.toString();
        }),
    ).toEqual([MONITOR_ID.toString()]);
  });

  test("an absent payload reads null rather than throwing", () => {
    expect(getSource(ALERT_TABLE).readSourceIdsFromPayload(null)).toBeNull();
    expect(getSource(INCIDENT_TABLE).readSourceIdsFromPayload(null)).toBeNull();
  });
});

describe("a hydrated monitor is taken from the payload; a stub is not", () => {
  test("takes the bag off a single-source payload's relation object", () => {
    expect(
      getSource(ALERT_TABLE).readHydratedSourcesFromPayload({
        monitor: buildMonitor({
          id: MONITOR_ID,
          customFields: { severity: "High" },
        }),
      }),
    ).toEqual({ [MONITOR_ID.toString()]: { severity: "High" } });
  });

  test("treats a monitor read WITH a null customFields column as hydrated and empty", () => {
    expect(
      getSource(ALERT_TABLE).readHydratedSourcesFromPayload({
        monitor: buildMonitor({ id: MONITOR_ID, customFields: null }),
      }),
    ).toEqual({ [MONITOR_ID.toString()]: {} });
  });

  test("refuses an id stub whose customFields were never read", () => {
    expect(
      getSource(ALERT_TABLE).readHydratedSourcesFromPayload({
        monitor: buildMonitor({ id: MONITOR_ID, hydrated: false }),
      }),
    ).toEqual({});
  });

  test("takes nothing from the FK-only spelling - there is no bag to take", () => {
    expect(
      getSource(ALERT_TABLE).readHydratedSourcesFromPayload({
        monitorId: MONITOR_ID,
      }),
    ).toEqual({});
  });

  test("takes the bag off every hydrated monitor of a many-source payload", () => {
    const second: ObjectID = new ObjectID(
      "44444444-4444-4444-8444-444444444444",
    );

    expect(
      getSource(INCIDENT_TABLE).readHydratedSourcesFromPayload({
        monitors: [
          buildMonitor({ id: MONITOR_ID, customFields: { team: "Core" } }),
          buildMonitor({ id: second, customFields: { team: "Edge" } }),
        ],
      }),
    ).toEqual({
      [MONITOR_ID.toString()]: { team: "Core" },
      [second.toString()]: { team: "Edge" },
    });
  });

  test("skips the stubs of a many-source payload and keeps the rest", () => {
    const stubbed: ObjectID = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );

    expect(
      getSource(INCIDENT_TABLE).readHydratedSourcesFromPayload({
        monitors: [
          buildMonitor({ id: MONITOR_ID, customFields: { team: "Core" } }),
          buildMonitor({ id: stubbed, hydrated: false }),
        ],
      }),
    ).toEqual({ [MONITOR_ID.toString()]: { team: "Core" } });
  });

  test("takes nothing from an absent payload", () => {
    expect(getSource(ALERT_TABLE).readHydratedSourcesFromPayload(null)).toEqual(
      {},
    );
    expect(
      getSource(INCIDENT_TABLE).readHydratedSourcesFromPayload(null),
    ).toEqual({});
  });
});

describe("the reverse query that finds every target attached to a source", () => {
  test("a single source matches on the FK column directly", () => {
    expect(
      getSource(ALERT_TABLE).buildTargetQueryForSourceId(MONITOR_ID),
    ).toEqual({ monitorId: MONITOR_ID });
  });

  test("a many source matches through the relation array", () => {
    expect(
      getSource(INCIDENT_TABLE).buildTargetQueryForSourceId(MONITOR_ID),
    ).toEqual({ monitors: [MONITOR_ID] });
  });

  test("the query names the property the catalog says holds the relation", () => {
    for (const target of getCustomFieldMappingTargets()) {
      const source: CustomFieldMappingSourceEntry = target.sources[0]!;
      const info: CustomFieldMappingSourceInfo = source.info;

      expect(
        Object.keys(source.buildTargetQueryForSourceId(MONITOR_ID)),
      ).toEqual([info.targetRelationProperty]);
    }
  });
});
