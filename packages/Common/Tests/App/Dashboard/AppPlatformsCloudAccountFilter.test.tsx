import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { Location, MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID } from "./SideMenuHarness";

/*
 * APP PLATFORMS' LISTS, BY CLOUD ACCOUNT (#5702's follow-up).
 *
 * All Environments and All Apps have a Cloud Account chip: an environment
 * is in the account its telemetry names (cloud.account.id), an app in its
 * environment's. Cloud's Overview counts the environments and apps in the
 * accounts Cloud reads and links to each list with the chip set to those
 * accounts, so the list holds exactly what was counted - visibly, and the
 * chip can be cleared.
 *
 * The lists' table is captured, so the query each list asks with is read
 * exactly; the chips above it are drawn as the page hands them over.
 */

const modelTableMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      modelTableMock(props);
      return <div data-testid="model-table" />;
    },
  };
});

import AppPlatformEnvironments from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Environments";
import AppPlatformsApps from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Apps";
import CloudAppsTable from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppsTable";
import {
  APP_PLATFORMS_APPS_TABLE_ID,
  APP_PLATFORMS_ENVIRONMENTS_TABLE_ID,
  CLOUD_ACCOUNT_FACET_KEY,
  CLOUD_ACCOUNT_FACET_LABEL,
  CLOUD_ACCOUNT_FACET_OPERATORS,
  CloudAccountEnvironment,
  NO_ENVIRONMENT_ID,
  getAppsCloudAccountFacet,
  getAppsCloudAccountQueryValue,
  getCloudAccountFacetOptions,
  getEnvironmentIdsForAccounts,
  getEnvironmentsCloudAccountFacet,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppPlatformsAccountFacet";
import {
  getAppPlatformsAppsRoute,
  getAppPlatformsEnvironmentsRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppPlatformsListRoutes";
import { FilterChipDropdownOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";

type Props = Record<string, any>;

const AWS_ACCOUNT: string = "123456789012";
const OTHER_AWS_ACCOUNT: string = "999999999999";
const GCP_PROJECT: string = "shop-prod";

const ECS_PROD: string = "71000000-0000-4000-8000-000000000001";
const ECS_STAGING: string = "71000000-0000-4000-8000-000000000002";
const CLOUD_RUN: string = "71000000-0000-4000-8000-000000000003";
const NO_ACCOUNT: string = "71000000-0000-4000-8000-000000000004";

function environmentRow(
  id: string,
  provider: string,
  accountId: string | undefined,
  name: string,
): CloudResource {
  const row: CloudResource = new CloudResource();
  Object.assign(row, {
    _id: id,
    name,
    cloudProvider: provider,
    cloudAccountId: accountId,
    cloudRegion: "us-east-1",
    cloudPlatform: provider === "gcp" ? "gcp_cloud_run" : "aws_ecs",
    cloudResourceKind: CloudResourceKind.Environment,
  });
  return row;
}

const ROWS: Array<CloudResource> = [
  environmentRow(ECS_PROD, "aws", AWS_ACCOUNT, "AWS ECS · us-east-1 · prod"),
  environmentRow(
    ECS_STAGING,
    "aws",
    OTHER_AWS_ACCOUNT,
    "AWS ECS · us-east-1 · staging",
  ),
  environmentRow(CLOUD_RUN, "gcp", GCP_PROJECT, "GCP Cloud Run · shop"),
  environmentRow(NO_ACCOUNT, "aws", undefined, "AWS ECS · us-east-1"),
];

function environmentsById(): Map<string, CloudResource> {
  return new Map<string, CloudResource>(
    ROWS.map((row: CloudResource): [string, CloudResource] => {
      return [row._id!.toString(), row];
    }),
  );
}

// Opens a URL - its query string included - as the browser would.
function goToUrl(url: string): void {
  window.history.pushState({}, "", url);
  const parsed: URL = new URL(url, "https://x.test");
  Navigation.setLocation({
    pathname: parsed.pathname,
    search: parsed.search,
    hash: "",
    state: null,
    key: "test",
  } as Location);
}

async function renderPage(
  Page: React.FunctionComponent<PageComponentProps>,
  url: string,
): Promise<void> {
  goToUrl(url);
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[url]}>
        <Page
          pageRoute={new Route(url)}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

function lastTableProps(): Props {
  expect(modelTableMock).toHaveBeenCalled();
  return modelTableMock.mock.calls[
    modelTableMock.mock.calls.length - 1
  ]![0] as Props;
}

// What an Includes holds, as strings.
function valuesOf(value: unknown): Array<string> {
  expect(value).toBeInstanceOf(Includes);
  return ((value as Includes).values as Array<unknown>).map(
    (item: unknown): string => {
      return String(item);
    },
  );
}

beforeEach(() => {
  modelTableMock.mockReset();
  TableFilterUrlState.resetClaimedKeys();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(ModelAPI, "count").mockResolvedValue(ROWS.length as never);
  getJestSpyOn(ModelAPI, "getList").mockResolvedValue({
    data: ROWS,
    count: ROWS.length,
    skip: 0,
    limit: 100,
  } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  goToUrl("/");
});

describe("the accounts the chip offers", () => {
  test("each account once, as its telemetry names it, under its cloud; an environment naming none offers none", () => {
    const options: Array<FilterChipDropdownOption> =
      getCloudAccountFacetOptions([
        ...ROWS,
        // The same account again, and one spelled with spaces around it.
        environmentRow(
          "71000000-0000-4000-8000-000000000005",
          "aws",
          ` ${AWS_ACCOUNT} `,
          "x",
        ),
      ]);

    expect(
      options.map((option: FilterChipDropdownOption) => {
        return [option.value, option.label, option.group];
      }),
    ).toEqual([
      [AWS_ACCOUNT, AWS_ACCOUNT, "AWS"],
      [OTHER_AWS_ACCOUNT, OTHER_AWS_ACCOUNT, "AWS"],
      [GCP_PROJECT, GCP_PROJECT, "Google Cloud"],
    ]);
  });

  test("an account of a cloud OneUptime has no name for is listed under no heading", () => {
    expect(
      getCloudAccountFacetOptions([
        { cloudProvider: "", cloudAccountId: "acct-1" },
      ]),
    ).toEqual([{ value: "acct-1", label: "acct-1", icon: expect.anything() }]);
  });
});

describe("the environments and apps the chip keeps to", () => {
  const environments: Map<string, CloudAccountEnvironment> = environmentsById();

  test("'is' keeps the environments of the accounts picked", () => {
    expect(
      getEnvironmentIdsForAccounts({
        environments,
        accountIds: [AWS_ACCOUNT, GCP_PROJECT],
        operator: "is",
      }),
    ).toEqual([ECS_PROD, CLOUD_RUN]);
  });

  /*
   * As All Environments' own chip is answered: the server's NOT IN leaves
   * out an environment whose account column holds nothing, so All Apps
   * leaves its apps out too - the same chip keeps the same environments
   * on both lists (the UI review of #6149).
   */
  test("'is not' keeps every other account's environments; one that names no account is in neither", () => {
    expect(
      getEnvironmentIdsForAccounts({
        environments,
        accountIds: [AWS_ACCOUNT],
        operator: "is_not",
      }),
    ).toEqual([ECS_STAGING, CLOUD_RUN]);
    expect(
      getEnvironmentIdsForAccounts({
        environments,
        accountIds: [AWS_ACCOUNT, OTHER_AWS_ACCOUNT, GCP_PROJECT],
        operator: "is_not",
      }),
    ).toEqual([]);
    // A blank pick (a hand-edited address) matches no environment either way.
    for (const operator of ["is", "is_not"] as const) {
      expect(
        getEnvironmentIdsForAccounts({
          environments,
          accountIds: ["", " "],
          operator,
        }),
      ).toEqual(operator === "is" ? [] : [ECS_PROD, ECS_STAGING, CLOUD_RUN]);
    }
  });

  test("All Apps asks for those environments' apps, and for none when no environment is left", () => {
    expect(
      valuesOf(
        getAppsCloudAccountQueryValue({
          environments,
          accountIds: [OTHER_AWS_ACCOUNT],
          operator: "is",
        }),
      ),
    ).toEqual([ECS_STAGING]);
    expect(
      valuesOf(
        getAppsCloudAccountQueryValue({
          environments,
          accountIds: ["000000000000"],
          operator: "is",
        }),
      ),
    ).toEqual([NO_ENVIRONMENT_ID]);
  });
});

describe("the chip on each list", () => {
  test("All Environments filters its own column, one of the accounts or none of them", () => {
    const facet: ResourceFacet = getEnvironmentsCloudAccountFacet(
      async (): Promise<Array<FilterChipDropdownOption>> => {
        return [];
      },
    );

    expect(facet.key).toBe(CLOUD_ACCOUNT_FACET_KEY);
    expect(facet.key).toBe("cloudAccountId");
    expect(facet.label).toBe(CLOUD_ACCOUNT_FACET_LABEL);
    expect(facet.isMultiSelect).toBe(true);
    expect(facet.supportedOperators).toEqual(CLOUD_ACCOUNT_FACET_OPERATORS);
    expect(facet.queryField).toBeUndefined();

    /*
     * Each id as written, and in upper case where that differs: an id
     * written either way is one account (#6149's follow-up).
     */
    const is: unknown = facet.toQueryValue!([AWS_ACCOUNT, GCP_PROJECT], "is");
    expect(valuesOf(is)).toEqual([AWS_ACCOUNT, GCP_PROJECT, "SHOP-PROD"]);
    expect(facet.toQueryValue!([AWS_ACCOUNT], "is_not")).toBeInstanceOf(
      IncludesNone,
    );
  });

  test("All Apps filters an app by its environment, offering the accounts it has read", async () => {
    const facet: ResourceFacet = getAppsCloudAccountFacet(environmentsById());

    expect(facet.key).toBe(CLOUD_ACCOUNT_FACET_KEY);
    expect(facet.queryField).toBe("cloudResourceId");
    expect(facet.supportedOperators).toEqual(["is", "is_not"]);
    // Read once, with the accounts' names (none here): the ids it has read.
    expect(facet.options).toBeUndefined();
    expect(
      (await facet.fetchOptions!(new ObjectID(PROJECT_ID))).map(
        (option: FilterChipDropdownOption) => {
          return option.value;
        },
      ),
    ).toEqual([AWS_ACCOUNT, OTHER_AWS_ACCOUNT, GCP_PROJECT]);
    expect(valuesOf(facet.toQueryValue!([GCP_PROJECT], "is"))).toEqual([
      CLOUD_RUN,
    ]);
  });
});

describe("links into the lists", () => {
  test("carry the chip in each list's own URL namespace, read back as the list reads it", () => {
    const environments: Route = getAppPlatformsEnvironmentsRoute([
      AWS_ACCOUNT,
      GCP_PROJECT,
    ]);
    const apps: Route = getAppPlatformsAppsRoute([AWS_ACCOUNT]);

    goToUrl(environments.toString());
    expect(new URL(environments.toString(), "https://x.test").pathname).toBe(
      `/dashboard/${PROJECT_ID}/app-platforms/environments`,
    );
    expect(
      TableFilterUrlState.read(APP_PLATFORMS_ENVIRONMENTS_TABLE_ID, "facets"),
    ).toEqual({
      facetSelections: { cloudAccountId: [AWS_ACCOUNT, GCP_PROJECT] },
      facetOperators: { cloudAccountId: "is" },
    });

    goToUrl(apps.toString());
    expect(new URL(apps.toString(), "https://x.test").pathname).toBe(
      `/dashboard/${PROJECT_ID}/app-platforms/apps`,
    );
    expect(
      TableFilterUrlState.read(APP_PLATFORMS_APPS_TABLE_ID, "facets"),
    ).toEqual({
      facetSelections: { cloudAccountId: [AWS_ACCOUNT] },
      facetOperators: { cloudAccountId: "is" },
    });
  });

  test("no account, no chip: the whole list; an account named twice or blank is said once", () => {
    expect(getAppPlatformsEnvironmentsRoute([]).toString()).toBe(
      `/dashboard/${PROJECT_ID}/app-platforms/environments`,
    );
    expect(getAppPlatformsAppsRoute(["", "  "]).toString()).toBe(
      `/dashboard/${PROJECT_ID}/app-platforms/apps`,
    );

    goToUrl(
      getAppPlatformsAppsRoute([AWS_ACCOUNT, ` ${AWS_ACCOUNT}`]).toString(),
    );
    expect(
      (
        TableFilterUrlState.read(APP_PLATFORMS_APPS_TABLE_ID, "facets") as {
          facetSelections: JSONObject;
        }
      ).facetSelections,
    ).toEqual({ cloudAccountId: [AWS_ACCOUNT] });
  });
});

describe("All Environments", () => {
  test("opened from Cloud's Overview: the first read is already of those accounts' environments", async () => {
    await renderPage(
      AppPlatformEnvironments,
      getAppPlatformsEnvironmentsRoute([AWS_ACCOUNT, GCP_PROJECT]).toString(),
    );

    await waitFor(() => {
      expect(modelTableMock).toHaveBeenCalled();
    });

    // Every query the table was handed, from its first: none without the chip.
    for (const call of modelTableMock.mock.calls) {
      const query: JSONObject = (call[0] as Props)["query"];

      expect(valuesOf(query[CLOUD_ACCOUNT_FACET_KEY])).toEqual([
        AWS_ACCOUNT,
        GCP_PROJECT,
        "SHOP-PROD",
      ]);
      expect(query["cloudResourceKind"]).toBe("environment");
      expect(query["isArchived"]).toBe(false);
    }
  });

  test("the chip is drawn set, above the rows, and the text filter it replaces is gone", async () => {
    await renderPage(
      AppPlatformEnvironments,
      getAppPlatformsEnvironmentsRoute([AWS_ACCOUNT]).toString(),
    );

    await waitFor(() => {
      expect(modelTableMock).toHaveBeenCalled();
    });

    const props: Props = lastTableProps();

    render(<MemoryRouter>{props["topContent"]}</MemoryRouter>);

    expect(
      await screen.findByText((_content: string, element: Element | null) => {
        return (
          element?.tagName === "SPAN" &&
          (element.textContent || "").replace(/\s+/g, " ").trim() ===
            `Cloud Account · ${AWS_ACCOUNT}`
        );
      }),
    ).toBeInTheDocument();

    const filtered: Array<string> = (props["filters"] as Array<Props>).map(
      (filter: Props): string => {
        return Object.keys(filter["field"])[0]!;
      },
    );
    expect(filtered).not.toContain("cloudAccountId");
    expect(filtered).toEqual(
      expect.arrayContaining(["cloudPlatform", "cloudProvider", "cloudRegion"]),
    );
  });

  test("opened without one: the whole list, the chip offering the accounts its environments are in", async () => {
    await renderPage(
      AppPlatformEnvironments,
      `/dashboard/${PROJECT_ID}/app-platforms/environments`,
    );

    await waitFor(() => {
      expect(modelTableMock).toHaveBeenCalled();
    });

    expect(lastTableProps()["query"][CLOUD_ACCOUNT_FACET_KEY]).toBeUndefined();

    // The accounts are read once, of the environments the list holds.
    const reads: Array<Props> = (
      ModelAPI.getList as unknown as MockFunction
    ).mock.calls.map((call: Array<unknown>): Props => {
      return call[0] as Props;
    });
    const accountRead: Props | undefined = reads.find((read: Props) => {
      return Boolean(read["select"]?.["cloudAccountId"]);
    });

    expect(accountRead?.["query"]).toEqual({
      isArchived: false,
      cloudResourceKind: CloudResourceKind.Environment,
    });
  });
});

describe("All Apps", () => {
  test("opened from Cloud's Overview: the apps of those accounts' environments, archived ones still left out", async () => {
    await renderPage(
      AppPlatformsApps,
      getAppPlatformsAppsRoute([AWS_ACCOUNT, GCP_PROJECT]).toString(),
    );

    await waitFor(() => {
      expect(modelTableMock).toHaveBeenCalled();
    });

    for (const call of modelTableMock.mock.calls) {
      expect(valuesOf((call[0] as Props)["query"]["cloudResourceId"])).toEqual([
        ECS_PROD,
        CLOUD_RUN,
      ]);
    }

    expect(lastTableProps()["topContent"]).toBeTruthy();
  });

  test("opened without one: every environment's apps, the chip offered above them", async () => {
    await renderPage(
      AppPlatformsApps,
      `/dashboard/${PROJECT_ID}/app-platforms/apps`,
    );

    await waitFor(() => {
      expect(modelTableMock).toHaveBeenCalled();
    });

    const props: Props = lastTableProps();

    expect(valuesOf(props["query"]["cloudResourceId"])).toEqual([
      ECS_PROD,
      ECS_STAGING,
      CLOUD_RUN,
      NO_ACCOUNT,
    ]);

    render(<MemoryRouter>{props["topContent"]}</MemoryRouter>);
    expect(await screen.findByText("Cloud Account")).toBeInTheDocument();
  });

  test("an environment's own Apps tab has one environment and no chip, whatever the address says", () => {
    goToUrl(getAppPlatformsAppsRoute([OTHER_AWS_ACCOUNT]).toString());

    render(
      <MemoryRouter>
        <CloudAppsTable
          id="app-platforms-environment-apps-table"
          environment={ROWS[0]!}
        />
      </MemoryRouter>,
    );

    const props: Props = lastTableProps();

    expect(String(props["query"]["cloudResourceId"])).toBe(ECS_PROD);
    expect(props["topContent"]).toBeUndefined();
  });
});
