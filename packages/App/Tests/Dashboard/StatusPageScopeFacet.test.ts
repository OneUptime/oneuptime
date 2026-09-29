/*
 * The incidents table's "Status Page" chip (buildStatusPageScopeFacet):
 * incidents limited to the picked status pages. It writes the id list onto
 * Incident.statusPages, which the server turns into a join-table filter, so
 * the shape of the value is the whole contract.
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
import buildStatusPageScopeFacet from "../../FeatureSet/Dashboard/src/Components/Incident/buildStatusPageScopeFacet";
import IncidentStatusPageScopeCopy from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import { ResourceFacet } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import { FilterChipDropdownOption } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, test } from "@jest/globals";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SITE_03: string = "b0000000-0000-4000-8000-000000000003";
const SITE_07: string = "b0000000-0000-4000-8000-000000000007";

function page(id: string, name: string): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = id;
  statusPage.name = name;
  return statusPage;
}

function lastRequest(): {
  query: JSONObject;
  limit: number;
  select: JSONObject;
  sort: JSONObject;
} {
  return getListMock.mock.calls[getListMock.mock.calls.length - 1]![0] as {
    query: JSONObject;
    limit: number;
    select: JSONObject;
    sort: JSONObject;
  };
}

function ids(value: unknown): Array<string> {
  return (((value as Includes).values || []) as Array<string | ObjectID>).map(
    (id: string | ObjectID): string => {
      return id.toString();
    },
  );
}

let facet: ResourceFacet;

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockResolvedValue({
    data: [page(SITE_03, "Site 03"), page(SITE_07, "Site 07")],
    count: 2,
    skip: 0,
    limit: 50,
  });
  facet = buildStatusPageScopeFacet();
});

describe("buildStatusPageScopeFacet", () => {
  test("filters on the scope column, many values at once", () => {
    expect(facet.key).toBe("statusPages");
    expect(facet.queryField).toBeUndefined();
    expect(facet.isMultiSelect).toBe(true);
    expect(facet.label).toBe(IncidentStatusPageScopeCopy.tableFilterLabel);
    expect(facet.searchPlaceholder).toBe(
      IncidentStatusPageScopeCopy.tableFilterSearchPlaceholder,
    );
  });

  test("'is' is incidents limited to any of the pages", () => {
    const value: unknown = facet.toQueryValue!([SITE_03, SITE_07], "is");

    expect(value).toBeInstanceOf(Includes);
    expect(ids(value)).toEqual([SITE_03, SITE_07]);
  });

  test("'is not' is incidents limited to none of them", () => {
    const value: unknown = facet.toQueryValue!([SITE_03], "is_not");

    expect(value).toBeInstanceOf(IncludesNone);
    expect(ids(value)).toEqual([SITE_03]);
  });

  test("'is empty' is incidents limited to no page; 'is not empty' the rest", () => {
    expect(facet.toQueryValue!([], "is_empty")).toBeInstanceOf(IsNull);
    expect(facet.toQueryValue!([], "is_not_empty")).toBeInstanceOf(NotNull);
  });

  test("nothing picked filters nothing", () => {
    expect(facet.toQueryValue!([], "is")).toBeUndefined();
  });

  test("options are the project's status pages, by name", async () => {
    const options: Array<FilterChipDropdownOption> = await facet.loadOptions!(
      PROJECT_ID,
      "",
    );

    expect(options).toEqual([
      { value: SITE_03, label: "Site 03" },
      { value: SITE_07, label: "Site 07" },
    ]);

    const request: {
      query: JSONObject;
      select: JSONObject;
      sort: JSONObject;
    } = lastRequest();

    expect(request.query["projectId"]).toBe(PROJECT_ID);
    expect(request.query["name"]).toBeUndefined();
    expect(request.select).toEqual({ _id: true, name: true });
    expect(request.sort).toEqual({ name: SortOrder.Ascending });
  });

  test("typing searches page names", async () => {
    await facet.loadOptions!(PROJECT_ID, "  site  ");

    const search: Search<string> = lastRequest().query[
      "name"
    ] as unknown as Search<string>;

    expect(search).toBeInstanceOf(Search);
    expect(search.toString()).toBe("site");
  });

  test("saved selections resolve to names, in the project", async () => {
    const options: Array<FilterChipDropdownOption> =
      await facet.resolveOptions!(PROJECT_ID, [SITE_03, SITE_07]);

    expect(options.length).toBe(2);

    const request: { query: JSONObject; limit: number } = lastRequest();

    expect(request.query["projectId"]).toBe(PROJECT_ID);
    expect(ids(request.query["_id"])).toEqual([SITE_03, SITE_07]);
    expect(request.limit).toBe(2);
  });

  test("resolving nothing asks for nothing", async () => {
    expect(await facet.resolveOptions!(PROJECT_ID, [])).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });
});
