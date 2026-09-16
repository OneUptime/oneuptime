/*
 * SLOs became an affected resource of the incidents and alerts their burn
 * rate rules raise (Incident.serviceLevelObjectives /
 * Alert.serviceLevelObjectives), and the Affected Resources filter chip
 * gained an SLO type so "every incident this SLO declared" is one chip away
 * from the global incident list.
 *
 * Two things matter and both are pinned here:
 *
 *   - The mapping. An SLO selection must filter the parent on its
 *     `serviceLevelObjectives` relation and nothing else; the wrong relation
 *     silently shows the wrong rows while the chip claims to apply.
 *
 *   - The opt-in. Scheduled Maintenance has no SLO relation, so the type is
 *     offered only when a table asks for it. Offered by default, the
 *     maintenance list would build a filter on a column that does not exist
 *     there - and a stale `serviceLevelObjective:<id>` chip value (from a
 *     shared URL, say) must not reach a query either.
 */
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(),
    },
  };
});

import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import buildAffectedResourcesFacet from "../../FeatureSet/Dashboard/src/Components/AffectedResources/buildAffectedResourcesFacet";
import { ResourceFacet } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SLO_ID: string = "33333333-3333-4333-8333-333333333333";
const SERVICE_ID: string = "44444444-4444-4444-8444-444444444444";
const IS_OPERATOR: FilterOperator = "is";

interface GetListCall {
  modelType: { new (): unknown };
  query: JSONObject;
  select: JSONObject;
}

function getListCalls(): Array<GetListCall> {
  return getListMock.mock.calls.map((call: Array<unknown>): GetListCall => {
    return call[0] as GetListCall;
  });
}

function sloLookups(): Array<GetListCall> {
  return getListCalls().filter((call: GetListCall): boolean => {
    return call.modelType === ServiceLevelObjective;
  });
}

function includedIds(value: unknown): Array<string> {
  const includes: Includes = value as Includes;
  const values: Array<string | ObjectID | number> = (includes.values ||
    []) as Array<string | ObjectID | number>;

  return values.map((v: string | ObjectID | number): string => {
    return v.toString();
  });
}

// The Incidents table's facet, exactly as IncidentsTable builds it.
function incidentFacet(): ResourceFacet {
  return buildAffectedResourcesFacet<Incident>({
    parentModelType: Incident,
    includeServiceLevelObjective: true,
  });
}

// The Alerts table's facet, exactly as AlertsTable builds it.
function alertFacet(): ResourceFacet {
  return buildAffectedResourcesFacet<Alert>({
    parentModelType: Alert,
    monitorQueryField: "monitorId",
    excludeMonitor: true,
    includeServiceLevelObjective: true,
  });
}

// The Scheduled Maintenance table's facet, which must never offer SLOs.
function maintenanceFacet(): ResourceFacet {
  return buildAffectedResourcesFacet<ScheduledMaintenance>({
    parentModelType: ScheduledMaintenance,
    includeNetworkSite: true,
  });
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
});

describe("an SLO selection filters on the serviceLevelObjectives relation", () => {
  test.each([
    ["incidents", incidentFacet],
    ["alerts", alertFacet],
  ])(
    "filtering %s by an SLO issues one query over serviceLevelObjectives",
    async (_label: string, facet: () => ResourceFacet) => {
      await facet().computeMatchingResourceIds!(
        PROJECT_ID,
        [`serviceLevelObjective:${SLO_ID}`],
        IS_OPERATOR,
      );

      const calls: Array<GetListCall> = getListCalls();

      expect(calls).toHaveLength(1);

      const query: JSONObject = calls[0]!.query;

      expect(Object.keys(query).sort()).toEqual(
        ["projectId", "serviceLevelObjectives"].sort(),
      );
      expect(includedIds(query["serviceLevelObjectives"])).toEqual([SLO_ID]);
      expect(query["projectId"]).toBe(PROJECT_ID);
      // Only the parent ids are needed to narrow the table.
      expect(calls[0]!.select).toEqual({ _id: true });
    },
  );

  test("the query targets the parent model the table lists", async () => {
    await alertFacet().computeMatchingResourceIds!(
      PROJECT_ID,
      [`serviceLevelObjective:${SLO_ID}`],
      IS_OPERATOR,
    );

    expect(getListCalls()[0]!.modelType).toBe(Alert);
  });

  test("an SLO and a service selected together are unioned", async () => {
    getListMock.mockReset();
    getListMock.mockImplementation((args: unknown): Promise<unknown> => {
      const query: JSONObject = (args as GetListCall).query;

      if (query["serviceLevelObjectives"]) {
        return Promise.resolve({
          data: [
            { id: new ObjectID("incident-burn-1") },
            { id: new ObjectID("incident-shared") },
          ],
          count: 2,
          skip: 0,
          limit: 0,
        });
      }

      return Promise.resolve({
        data: [{ id: new ObjectID("incident-shared") }],
        count: 1,
        skip: 0,
        limit: 0,
      });
    });

    const matched: Array<string> = await incidentFacet()
      .computeMatchingResourceIds!(
      PROJECT_ID,
      [`serviceLevelObjective:${SLO_ID}`, `service:${SERVICE_ID}`],
      IS_OPERATOR,
    );

    expect(matched.sort()).toEqual(["incident-burn-1", "incident-shared"]);
  });
});

describe("the dropdown offers SLOs when the table opts in", () => {
  test("SLO options are grouped as SLOs, carry the gauge icon and encode their type", async () => {
    getListMock.mockImplementation((args: unknown): Promise<unknown> => {
      if ((args as GetListCall).modelType === ServiceLevelObjective) {
        return Promise.resolve({
          data: [
            {
              id: new ObjectID(SLO_ID),
              name: "Checkout availability",
            },
          ],
          count: 1,
          skip: 0,
          limit: 0,
        });
      }

      return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
    });

    const options: Array<FilterChipDropdownOption> = await incidentFacet()
      .loadOptions!(PROJECT_ID, "checkout");

    expect(options).toEqual([
      {
        value: `serviceLevelObjective:${SLO_ID}`,
        label: "Checkout availability",
        icon: IconProp.Gauge,
        group: "SLOs",
      },
    ]);
  });

  test("the search term reaches the SLO lookup, which reads only id and name", async () => {
    await alertFacet().loadOptions!(PROJECT_ID, "  checkout ");

    const lookups: Array<GetListCall> = sloLookups();

    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.query["projectId"]).toBe(PROJECT_ID);
    expect(lookups[0]!.query["name"]).toBeInstanceOf(Search);
    expect((lookups[0]!.query["name"] as Search<string>).toString()).toBe(
      "checkout",
    );
    expect(lookups[0]!.select).toEqual({ _id: true, name: true });
  });

  test("opting in adds exactly one lookup to the incident dropdown", async () => {
    await buildAffectedResourcesFacet<Incident>({
      parentModelType: Incident,
    }).loadOptions!(PROJECT_ID, "");
    const withoutSlo: number = getListMock.mock.calls.length;

    getListMock.mockClear();

    await incidentFacet().loadOptions!(PROJECT_ID, "");

    expect(getListMock.mock.calls.length).toBe(withoutSlo + 1);
    expect(sloLookups()).toHaveLength(1);
  });

  test("a user who cannot read SLOs still gets every other type's options", async () => {
    getListMock.mockImplementation((args: unknown): Promise<unknown> => {
      if ((args as GetListCall).modelType === ServiceLevelObjective) {
        return Promise.reject(new Error("403: no ReadServiceLevelObjective"));
      }

      return Promise.resolve({
        data: [{ id: new ObjectID(SERVICE_ID), name: "checkout-api" }],
        count: 1,
        skip: 0,
        limit: 0,
      });
    });

    const options: Array<FilterChipDropdownOption> = await alertFacet()
      .loadOptions!(PROJECT_ID, "");

    expect(
      options.some((option: FilterChipDropdownOption): boolean => {
        return option.group === "SLOs";
      }),
    ).toBe(false);
    expect(
      options.some((option: FilterChipDropdownOption): boolean => {
        return option.value === `service:${SERVICE_ID}`;
      }),
    ).toBe(true);
  });

  test("a saved SLO chip resolves back to the SLO's name", async () => {
    getListMock.mockResolvedValue({
      data: [{ id: new ObjectID(SLO_ID), name: "Checkout availability" }],
      count: 1,
      skip: 0,
      limit: 0,
    });

    const resolved: Array<FilterChipDropdownOption> = await incidentFacet()
      .resolveOptions!(PROJECT_ID, [`serviceLevelObjective:${SLO_ID}`]);

    expect(resolved).toEqual([
      {
        value: `serviceLevelObjective:${SLO_ID}`,
        label: "Checkout availability",
        icon: IconProp.Gauge,
        group: "SLOs",
      },
    ]);

    const lookups: Array<GetListCall> = sloLookups();

    expect(lookups).toHaveLength(1);
    expect(includedIds(lookups[0]!.query["_id"])).toEqual([SLO_ID]);
  });
});

describe("without the opt-in the SLO type does not exist", () => {
  test("the scheduled maintenance dropdown never looks SLOs up", async () => {
    await maintenanceFacet().loadOptions!(PROJECT_ID, "");

    expect(getListMock).toHaveBeenCalled();
    expect(sloLookups()).toHaveLength(0);
  });

  test("a stale SLO chip on scheduled maintenance builds no query", async () => {
    const matched: Array<string> = await maintenanceFacet()
      .computeMatchingResourceIds!(
      PROJECT_ID,
      [`serviceLevelObjective:${SLO_ID}`],
      IS_OPERATOR,
    );

    expect(matched).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a stale SLO chip on scheduled maintenance resolves to nothing", async () => {
    const resolved: Array<FilterChipDropdownOption> = await maintenanceFacet()
      .resolveOptions!(PROJECT_ID, [`serviceLevelObjective:${SLO_ID}`]);

    expect(resolved).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("an incident facet built without the flag ignores SLO selections too", async () => {
    await buildAffectedResourcesFacet<Incident>({
      parentModelType: Incident,
    }).computeMatchingResourceIds!(
      PROJECT_ID,
      [`serviceLevelObjective:${SLO_ID}`],
      IS_OPERATOR,
    );

    expect(getListMock).not.toHaveBeenCalled();
  });
});
