/*
 * The facet queries the parent model once per selected resource type, and
 * the type -> relation mapping is the whole contract: query the wrong
 * relation and the list silently shows the wrong rows, with the chip still
 * lit and claiming to apply.
 *
 * The mapping used to be an if/else chain ending in a bare `else` that
 * returned "podmanHosts". Every type added after Podman — Proxmox, Ceph,
 * Docker Swarm, IoT — would have fallen into it and filtered alerts by
 * Podman hosts. These tests pin one assertion per type.
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
import { FilterOperator } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import Alert from "Common/Models/DatabaseModels/Alert";
import Includes from "Common/Types/BaseDatabase/Includes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_ID: string = "22222222-2222-4222-8222-222222222222";
const IS_OPERATOR: FilterOperator = "is";

function alertFacet(): ResourceFacet {
  return buildAffectedResourcesFacet<Alert>({
    parentModelType: Alert,
    monitorQueryField: "monitorId",
    excludeMonitor: true,
  });
}

/*
 * The single query the facet issued, so a test can read the relation it
 * filtered on.
 */
function issuedQuery(): JSONObject {
  expect(getListMock.mock.calls).toHaveLength(1);
  return (getListMock.mock.calls[0]![0] as { query: JSONObject }).query;
}

function includedIds(value: unknown): Array<string> {
  const includes: Includes = value as Includes;
  const values: Array<string | ObjectID | number> = (includes.values ||
    []) as Array<string | ObjectID | number>;

  return values.map((v: string | ObjectID | number): string => {
    return v.toString();
  });
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
});

describe("buildAffectedResourcesFacet maps each resource type to its relation", () => {
  test.each([
    ["service", "services"],
    ["host", "hosts"],
    ["kubernetesCluster", "kubernetesClusters"],
    ["dockerHost", "dockerHosts"],
    ["podmanHost", "podmanHosts"],
    ["proxmoxCluster", "proxmoxClusters"],
    ["cephCluster", "cephClusters"],
    ["dockerSwarmCluster", "dockerSwarmClusters"],
    ["iotFleet", "iotFleets"],
  ])(
    "a %s selection queries the %s relation",
    async (type: string, relation: string) => {
      await alertFacet().computeMatchingResourceIds!(
        PROJECT_ID,
        [`${type}:${RESOURCE_ID}`],
        IS_OPERATOR,
      );

      const query: JSONObject = issuedQuery();

      expect(Object.keys(query).sort()).toEqual([relation, "projectId"].sort());
      expect(includedIds(query[relation])).toEqual([RESOURCE_ID]);
      expect(query["projectId"]).toBe(PROJECT_ID);
    },
  );

  test("the monitor type uses the field the caller named", async () => {
    /*
     * Alert.monitor is the one ManyToOne — it filters on the FK column,
     * not on a join table, so the caller passes the field name.
     */
    const facet: ResourceFacet = buildAffectedResourcesFacet<Alert>({
      parentModelType: Alert,
      monitorQueryField: "monitorId",
    });

    await facet.computeMatchingResourceIds!(
      PROJECT_ID,
      [`monitor:${RESOURCE_ID}`],
      IS_OPERATOR,
    );

    expect(issuedQuery()["monitorId"]).toBeDefined();
  });

  test("ignores a selection whose type is not a known resource", async () => {
    await alertFacet().computeMatchingResourceIds!(
      PROJECT_ID,
      [`somethingElse:${RESOURCE_ID}`],
      IS_OPERATOR,
    );

    expect(getListMock).not.toHaveBeenCalled();
  });

  test("ignores a selection with no type prefix", async () => {
    await alertFacet().computeMatchingResourceIds!(
      PROJECT_ID,
      [RESOURCE_ID],
      IS_OPERATOR,
    );

    expect(getListMock).not.toHaveBeenCalled();
  });

  test("unions the parent ids matched across resource types", async () => {
    getListMock.mockReset();
    getListMock
      .mockResolvedValueOnce({
        data: [{ id: new ObjectID("alert-1") }],
        count: 1,
        skip: 0,
        limit: 0,
      })
      .mockResolvedValueOnce({
        data: [
          { id: new ObjectID("alert-1") },
          { id: new ObjectID("alert-2") },
        ],
        count: 2,
        skip: 0,
        limit: 0,
      });

    const matched: Array<string> = await alertFacet()
      .computeMatchingResourceIds!(
      PROJECT_ID,
      [`host:${RESOURCE_ID}`, `cephCluster:${RESOURCE_ID}`],
      IS_OPERATOR,
    );

    expect(matched.sort()).toEqual(["alert-1", "alert-2"]);
  });

  test("offers every resource type in the dropdown when monitors are excluded", async () => {
    await alertFacet().loadOptions!(PROJECT_ID, "");

    /*
     * One lookup per offered type. Monitors are excluded here because the
     * alerts table carries a dedicated Monitor chip.
     */
    expect(getListMock.mock.calls).toHaveLength(9);
  });
});
