import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { Location, MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID } from "./SideMenuHarness";

/*
 * CLOUD'S ALL RESOURCES, BY CLOUD ACCOUNT (#6149's follow-up).
 *
 * The list filtered its account by typed text (an "Account" text filter
 * matched only an id typed exactly as stored). It has the Cloud Account
 * chip App Platforms' lists have now: each account its resources are in,
 * named as Cloud > Accounts names it, "is" or "is not", asked for in every
 * case an account's id is written in. A connection's resource count on
 * Cloud > Connect opens it with the chip set (getCloudResourcesRoute).
 *
 * The list's table is captured, so the query it asks with is read exactly;
 * the chips above it are drawn as the page hands them over.
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

import CloudMonitoredResources from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/MonitoredResources";
import {
  CLOUD_ACCOUNT_FACET_KEY,
  CLOUD_RESOURCES_TABLE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppPlatformsAccountFacet";
import { getCloudResourcesRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourcesListRoute";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
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
const AZURE_SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const GCP_PROJECT: string = "acme-prod";

// What the project holds: resources of three accounts, two of them named in Cloud > Accounts.
const RESOURCES: Array<{ cloudProvider: string; cloudAccountId: string }> = [
  { cloudProvider: "aws", cloudAccountId: AWS_ACCOUNT },
  { cloudProvider: "aws", cloudAccountId: AWS_ACCOUNT },
  { cloudProvider: "azure", cloudAccountId: AZURE_SUBSCRIPTION },
  { cloudProvider: "gcp", cloudAccountId: GCP_PROJECT },
];

const ACCOUNTS: Array<{ provider: string; accountId: string; name: string }> = [
  { provider: "aws", accountId: AWS_ACCOUNT, name: "Production" },
  {
    provider: "azure",
    accountId: AZURE_SUBSCRIPTION,
    name: "Contoso production",
  },
];

let refusesAccounts: boolean = false;

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

async function renderPage(url: string): Promise<void> {
  goToUrl(url);
  const Page: React.FunctionComponent<PageComponentProps> =
    CloudMonitoredResources;
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
  await waitFor(() => {
    expect(modelTableMock).toHaveBeenCalled();
  });
}

function tableCalls(): Array<Props> {
  return modelTableMock.mock.calls.map((call: Array<unknown>): Props => {
    return call[0] as Props;
  });
}

function lastTableProps(): Props {
  const calls: Array<Props> = tableCalls();
  return calls[calls.length - 1]!;
}

// What an Includes or IncludesNone holds, as strings.
function valuesOf(value: unknown): Array<string> {
  return ((value as Includes).values as Array<unknown>).map(
    (item: unknown): string => {
      return String(item);
    },
  );
}

// The chips above the table, drawn as the page hands them over.
async function drawChips(): Promise<HTMLElement> {
  const props: Props = lastTableProps();
  await act(async () => {
    render(
      <MemoryRouter>
        <div data-testid="chips">{props["topContent"]}</div>
      </MemoryRouter>,
    );
  });
  return screen.getByTestId("chips");
}

beforeEach(() => {
  modelTableMock.mockReset();
  refusesAccounts = false;
  TableFilterUrlState.resetClaimedKeys();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  // The project has resources: the list, not its first-run guide.
  getJestSpyOn(ModelAPI, "count").mockResolvedValue(RESOURCES.length as never);
  getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (args: Props): Promise<unknown> => {
      if (args["modelType"] === CloudAccount) {
        if (refusesAccounts) {
          throw new Error("You do not have permissions to read Cloud Account.");
        }

        const rows: Array<CloudAccount> = ACCOUNTS.map(
          (account: {
            provider: string;
            accountId: string;
            name: string;
          }): CloudAccount => {
            const row: CloudAccount = new CloudAccount();
            Object.assign(row, account);
            return row;
          },
        );
        return { data: rows, count: rows.length, skip: 0, limit: 100 };
      }

      if (args["modelType"] === CloudResource) {
        const excluded: Array<string> =
          args["query"]?.["cloudAccountId"] instanceof IncludesNone
            ? valuesOf(args["query"]["cloudAccountId"])
            : [];
        const rows: Array<CloudResource> = RESOURCES.filter(
          (resource: { cloudAccountId: string }): boolean => {
            return !excluded.includes(resource.cloudAccountId);
          },
        ).map((resource: JSONObject): CloudResource => {
          const row: CloudResource = new CloudResource();
          Object.assign(row, resource);
          return row;
        });
        return { data: rows, count: rows.length, skip: 0, limit: 100 };
      }

      return { data: [], count: 0, skip: 0, limit: 100 };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  goToUrl("/");
});

describe("the link that sets the chip", () => {
  test("carries it in the list's own URL namespace; no account, no chip", () => {
    const route: Route = getCloudResourcesRoute([
      AWS_ACCOUNT,
      ` ${AWS_ACCOUNT} `,
      GCP_PROJECT,
    ]);

    goToUrl(route.toString());
    expect(new URL(route.toString(), "https://x.test").pathname).toBe(
      `/dashboard/${PROJECT_ID}/cloud/resources`,
    );
    expect(
      TableFilterUrlState.read(CLOUD_RESOURCES_TABLE_ID, "facets"),
    ).toEqual({
      facetSelections: { cloudAccountId: [AWS_ACCOUNT, GCP_PROJECT] },
      facetOperators: { cloudAccountId: "is" },
    });
    expect(getCloudResourcesRoute([]).toString()).toBe(
      `/dashboard/${PROJECT_ID}/cloud/resources`,
    );
    expect(getCloudResourcesRoute(["", " "]).toString()).toBe(
      `/dashboard/${PROJECT_ID}/cloud/resources`,
    );
  });
});

describe("Cloud's All Resources", () => {
  test("opened from a connection's count: every read is of those accounts' resources, each id asked for whichever way it is written", async () => {
    await renderPage(
      getCloudResourcesRoute([AZURE_SUBSCRIPTION.toUpperCase()]).toString(),
    );

    for (const props of tableCalls()) {
      const query: JSONObject = props["query"];

      expect(query[CLOUD_ACCOUNT_FACET_KEY]).toBeInstanceOf(Includes);
      expect(valuesOf(query[CLOUD_ACCOUNT_FACET_KEY])).toEqual([
        AZURE_SUBSCRIPTION.toUpperCase(),
        AZURE_SUBSCRIPTION,
      ]);
      expect(query["cloudResourceKind"]).toBe(CloudResourceKind.Resource);
      expect(query["isArchived"]).toBe(false);
    }

    // Set by a chip: an empty page is the filters' to explain, with the way back.
    expect(lastTableProps()["emptyState"]["isFiltered"]).toBe(true);
    expect(typeof lastTableProps()["emptyState"]["onClearFilters"]).toBe(
      "function",
    );
  });

  test("'is not' from the address keeps every other account's resources", async () => {
    await renderPage(
      `${getCloudResourcesRoute([AWS_ACCOUNT]).toString().split("?")[0]}?${CLOUD_RESOURCES_TABLE_ID}-facets=${encodeURIComponent(
        JSON.stringify({
          facetSelections: { cloudAccountId: [AWS_ACCOUNT] },
          facetOperators: { cloudAccountId: "is_not" },
        }),
      )}`,
    );

    const query: JSONObject = lastTableProps()["query"];

    expect(query[CLOUD_ACCOUNT_FACET_KEY]).toBeInstanceOf(IncludesNone);
    expect(valuesOf(query[CLOUD_ACCOUNT_FACET_KEY])).toEqual([AWS_ACCOUNT]);
  });

  test("the chip is drawn set above the rows, by the account's name; the typed Account filter it replaces is gone", async () => {
    await renderPage(getCloudResourcesRoute([AWS_ACCOUNT]).toString());

    const chips: HTMLElement = await drawChips();

    expect(
      await within(chips).findByText(
        (_content: string, element: Element | null): boolean => {
          return (
            element?.tagName === "SPAN" &&
            (element.textContent || "").replace(/\s+/g, " ").trim() ===
              "Cloud Account · Production"
          );
        },
      ),
    ).toBeInTheDocument();

    const filtered: Array<string> = (
      lastTableProps()["filters"] as Array<Props>
    ).map((filter: Props): string => {
      return Object.keys(filter["field"])[0]!;
    });

    expect(filtered).not.toContain("cloudAccountId");
    expect(
      (lastTableProps()["filters"] as Array<Props>).map(
        (filter: Props): string => {
          return filter["title"] as string;
        },
      ),
    ).not.toContain("Account");
    // The other filters stay as they were.
    expect(filtered).toEqual([
      "name",
      "cloudProvider",
      "healthSeverity",
      "cloudResourceType",
      "cloudRegion",
      "cloudResourceGroup",
      "lastSeenAt",
    ]);
  });

  test("opened without one: the whole list, the chip offering each account its resources are in - named, its id under it - under its cloud", async () => {
    await renderPage(`/dashboard/${PROJECT_ID}/cloud/resources`);

    expect(lastTableProps()["query"][CLOUD_ACCOUNT_FACET_KEY]).toBeUndefined();
    expect(lastTableProps()["emptyState"]["isFiltered"]).toBe(false);

    const chips: HTMLElement = await drawChips();
    const chip: HTMLElement = await within(chips).findByRole("button", {
      name: "Cloud Account",
    });

    await act(async () => {
      fireEvent.click(chip);
    });

    const listbox: HTMLElement = await screen.findByRole("listbox");
    await waitFor(() => {
      expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    });
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return (option.textContent || "").trim();
        }),
    ).toEqual([
      `Production${AWS_ACCOUNT}`,
      `Contoso production${AZURE_SUBSCRIPTION}`,
      GCP_PROJECT,
    ]);
    expect(
      within(listbox)
        .getAllByTestId("filter-chip-group-heading")
        .map((heading: HTMLElement): string => {
          return heading.textContent || "";
        }),
    ).toEqual(["AWS", "Azure", "Google Cloud"]);

    // The accounts were found from the list's own resources, archived ones left out.
    const resourceReads: Array<Props> = (
      ModelAPI.getList as unknown as MockFunction
    ).mock.calls
      .map((call: Array<unknown>): Props => {
        return call[0] as Props;
      })
      .filter((read: Props): boolean => {
        return read["modelType"] === CloudResource;
      });
    expect(resourceReads.length).toBeGreaterThan(0);
    expect(resourceReads[0]!["query"]["isArchived"]).toBe(false);
    expect(resourceReads[0]!["query"]["cloudResourceKind"]).toBe(
      CloudResourceKind.Resource,
    );
    expect(resourceReads[0]!["select"]).toEqual({
      cloudProvider: true,
      cloudAccountId: true,
    });
  });

  test("a reader who may not read Cloud Accounts: the chip offers ids, as before", async () => {
    refusesAccounts = true;
    await renderPage(`/dashboard/${PROJECT_ID}/cloud/resources`);

    const chips: HTMLElement = await drawChips();

    await act(async () => {
      fireEvent.click(
        await within(chips).findByRole("button", { name: "Cloud Account" }),
      );
    });

    const listbox: HTMLElement = await screen.findByRole("listbox");
    await waitFor(() => {
      expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    });
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return (option.textContent || "").trim();
        }),
    ).toEqual([AWS_ACCOUNT, AZURE_SUBSCRIPTION, GCP_PROJECT]);
  });
});
