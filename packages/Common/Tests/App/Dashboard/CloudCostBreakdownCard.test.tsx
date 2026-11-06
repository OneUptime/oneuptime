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
import { MemoryRouter } from "react-router-dom";
import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import {
  CloudAccountCostSummary,
  CloudCostState,
  CloudCostTagKey,
  readCloudAccountCostSummary,
} from "../../../Types/Cloud/CloudCost";
import { ManagedCloudPlatform } from "../../../Types/Cloud/CloudPlatform";
import { ELASTIC_BEANSTALK_ENVIRONMENT_TAG } from "../../../Types/Cloud/CloudPlatformCosts";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import CloudCostBreakdownCard, {
  APPS_NOTE,
  BREAKDOWN_RESOURCES_NOT_READ_TITLE,
  BREAKDOWN_RESOURCES_NOTE,
  ENVIRONMENTS_EMPTY,
  ENVIRONMENTS_NONE_COST,
  APPS_NONE_COST,
  BREAKDOWN_EMPTY,
  TAGS_EMPTY,
  TAGS_NOTE,
  TAG_VALUE_NONE_COST,
  getCloudCostBreakdownEmptyText,
  scopeCloudCostPlatformLists,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostBreakdownCard";
import { BREAKDOWN_REST_LABELS } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostBreakdown";
import {
  CloudCostDimension,
  CloudCostPlatformLists,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostReads";
import { CloudAccountRow } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/UseCloudAccounts";

/*
 * WHERE THE MONEY GOES, BY APP PLATFORMS ENVIRONMENT, APP AND TAG - with
 * the network stubbed: each environment and app named and linked to its
 * page, what the list leaves out said under it with what it came to, the
 * tags the accounts' costs carry offered the costliest first, and the AWS
 * accounts whose costs per resource could not be read listed with why.
 */

const PROJECT: ObjectID = new ObjectID(PROJECT_ID);
const WEB_ROW: string = "10000000-0000-4000-8000-0000000000b1";
const DATA_ROW: string = "10000000-0000-4000-8000-0000000000b2";
const ECS_ENV: string = "20000000-0000-4000-8000-0000000000e1";
const RUN_ENV: string = "20000000-0000-4000-8000-0000000000e3";
const OTHER_ENV: string = "20000000-0000-4000-8000-0000000000e9";
const CHECKOUT_APP: string = "30000000-0000-4000-8000-0000000000a1";
const NOW: Date = new Date("2026-11-20T15:00:00.000Z");

function summary(
  overrides: Record<string, unknown> = {},
): CloudAccountCostSummary {
  return readCloudAccountCostSummary({
    state: CloudCostState.Reading,
    currency: "USD",
    monthToDate: 2000,
    lastMonth: 4000,
    monthFullDays: 2000,
    lastMonthToDate: 1600,
    projectedMonth: 3900,
    last30Days: 3800,
    topServices: [],
    readAt: NOW.toISOString(),
    ...overrides,
  })!;
}

function row(
  overrides: Omit<Partial<CloudAccountRow>, "id"> & { id: string },
): CloudAccountRow {
  return {
    name: "",
    provider: "aws",
    accountId: "",
    lastSeenAt: new Date(),
    hasConnection: true,
    resourceCount: 10,
    costSummary: summary(),
    savingsSummary: null,
    ...overrides,
    id: new ObjectID(overrides.id),
  };
}

const WEB: CloudAccountRow = row({
  id: WEB_ROW,
  name: "web-prod",
  accountId: "123456789012",
  costSummary: summary({
    tagKeys: [
      { key: "team", amount: 900 },
      { key: "env", amount: 400 },
    ],
  }),
});
const DATA: CloudAccountRow = row({
  id: DATA_ROW,
  name: "data-lake",
  provider: "gcp",
  accountId: "acme-prod",
  costSummary: summary({
    tagKeys: [{ key: "env", amount: 700 }],
  }),
});

function environment(data: {
  id: string;
  name: string;
  platform: string;
  accountId: string;
  region: string;
}): CloudResource {
  const resource: CloudResource = new CloudResource();
  resource._id = data.id;
  resource.name = data.name;
  resource.cloudPlatform = data.platform;
  resource.cloudProvider = (
    data.platform.startsWith("gcp") ? "gcp" : "aws"
  ) as never;
  resource.cloudAccountId = data.accountId;
  resource.cloudRegion = data.region;
  return resource;
}

function app(data: {
  id: string;
  name: string;
  environmentId: string;
}): CloudApp {
  const created: CloudApp = new CloudApp();
  created._id = data.id;
  created.name = data.name;
  created.cloudResourceId = new ObjectID(data.environmentId);
  return created;
}

let environmentsForTest: Array<CloudResource> = [];
let appsForTest: Array<CloudApp> = [];
let aggregateSpy: jest.SpyInstance<any, any>;
let getListSpy: jest.SpyInstance<any, any>;

// Each read's answer, by what it groups by (see aggregateKey).
let answers: Record<string, Array<Record<string, unknown>>> = {};

function aggregateKey(aggregateBy: AggregateBy<CloudCost>): string {
  const columns: Array<string> = Object.keys(aggregateBy.groupBy || {});

  return aggregateBy.groupByAttributeKeys
    ? [`tag:${aggregateBy.groupByAttributeKeys.join(",")}`, ...columns].join(
        ",",
      )
    : columns.join(",");
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/costs`);
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  environmentsForTest = [
    environment({
      id: ECS_ENV,
      name: "shop-ecs",
      platform: ManagedCloudPlatform.AwsEcs,
      accountId: "123456789012",
      region: "us-east-1",
    }),
    environment({
      id: RUN_ENV,
      name: "run-eu",
      platform: ManagedCloudPlatform.GcpCloudRun,
      accountId: "acme-prod",
      region: "europe-west1",
    }),
    // Another account's, not on this page.
    environment({
      id: OTHER_ENV,
      name: "elsewhere",
      platform: ManagedCloudPlatform.AwsAppRunner,
      accountId: "999999999999",
      region: "us-east-1",
    }),
  ];
  appsForTest = [
    app({ id: CHECKOUT_APP, name: "checkout", environmentId: RUN_ENV }),
  ];
  answers = {
    service: [{ service: "Amazon EC2", value: 100 }],
    "accountId,region,service": [
      {
        accountId: "123456789012",
        region: "us-east-1",
        service: "Amazon Elastic Container Service",
        value: 200,
      },
      {
        accountId: "acme-prod",
        region: "europe-west1",
        service: "Cloud Run",
        value: 90,
      },
      {
        accountId: "123456789012",
        region: "us-east-1",
        service: "Amazon EC2",
        value: 110,
      },
    ],
    "accountId,region,service,resourceId": [
      {
        accountId: "123456789012",
        region: "us-east-1",
        service: "Amazon Elastic Container Service",
        resourceId: "",
        value: 200,
      },
      {
        accountId: "acme-prod",
        region: "europe-west1",
        service: "Cloud Run",
        resourceId:
          "//run.googleapis.com/projects/acme-prod/locations/europe-west1/services/checkout",
        value: 75,
      },
      {
        accountId: "acme-prod",
        region: "europe-west1",
        service: "Cloud Run",
        resourceId: "",
        value: 15,
      },
    ],
    "tag:team": [
      { attributes: { team: "web" }, value: 600 },
      { attributes: { team: "payments" }, value: 300 },
      { attributes: { team: "" }, value: 100 },
    ],
    "tag:env": [
      { attributes: { env: "prod" }, value: 800 },
      { attributes: { env: "staging" }, value: 300 },
    ],
  };

  aggregateSpy = getJestSpyOn(
    AnalyticsModelAPI,
    "aggregate",
  ).mockImplementation(
    async (request: {
      aggregateBy: AggregateBy<CloudCost>;
    }): Promise<unknown> => {
      const answer: Array<Record<string, unknown>> | undefined =
        answers[aggregateKey(request.aggregateBy)];

      if (!answer) {
        throw new Error(`No answer for ${aggregateKey(request.aggregateBy)}`);
      }

      return { data: answer };
    },
  );
  getListSpy = getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (request: { modelType: unknown }): Promise<unknown> => {
      return request.modelType === CloudResource
        ? { data: environmentsForTest, count: environmentsForTest.length }
        : { data: appsForTest, count: appsForTest.length };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openCard(
  props: Partial<React.ComponentProps<typeof CloudCostBreakdownCard>> = {},
): Promise<HTMLElement> {
  await act(async () => {
    render(
      <MemoryRouter>
        <CloudCostBreakdownCard
          scope={{ projectId: PROJECT, currency: "USD" }}
          accounts={[WEB, DATA]}
          isOneAccount={false}
          {...props}
        />
      </MemoryRouter>,
    );
  });

  return screen.getByTestId("cloud-cost-breakdown");
}

async function breakDownBy(value: string): Promise<void> {
  await act(async () => {
    fireEvent.click(
      screen.getByTestId(`cloud-cost-breakdown-dimension-${value}`),
    );
  });
}

function restLines(breakdown: HTMLElement): Array<[string, string]> {
  return within(breakdown)
    .queryAllByTestId("cloud-cost-breakdown-rest-line")
    .map((line: HTMLElement): [string, string] => {
      return [line.getAttribute("data-kind") || "", line.textContent || ""];
    });
}

function tagRequests(): Array<AggregateBy<CloudCost>> {
  return aggregateSpy.mock.calls
    .map((call: Array<any>): AggregateBy<CloudCost> => {
      return call[0].aggregateBy;
    })
    .filter((aggregateBy: AggregateBy<CloudCost>): boolean => {
      return Boolean(aggregateBy.groupByAttributeKeys);
    });
}

describe("the choices", () => {
  test("by service, Region, account, resource, environment, app or tag; an account's own page has no Accounts", async () => {
    await openCard();

    for (const value of [
      "service",
      "region",
      "cloudAccountId",
      "resourceId",
      "environment",
      "app",
      "tag",
    ]) {
      expect(
        screen.getByTestId(`cloud-cost-breakdown-dimension-${value}`),
      ).toBeInTheDocument();
    }

    cleanup();
    await openCard({ accounts: [WEB], isOneAccount: true });

    expect(
      screen.queryByTestId("cloud-cost-breakdown-dimension-cloudAccountId"),
    ).toBeNull();
    expect(
      screen.getByTestId("cloud-cost-breakdown-dimension-environment"),
    ).toBeInTheDocument();
  });

  test("environments and apps are read only when asked for", async () => {
    await openCard();

    await waitFor(() => {
      expect(screen.getByTestId("cloud-cost-breakdown-total")).toBeTruthy();
    });
    expect(getListSpy).not.toHaveBeenCalled();
  });
});

describe("by App Platforms environment", () => {
  test("each environment of these accounts named, its platform beside it, linked to its page; what is in none under the list", async () => {
    const breakdown: HTMLElement = await openCard();

    await breakDownBy("environment");

    await waitFor(() => {
      expect(breakdown).toHaveTextContent("shop-ecs");
    });

    expect(breakdown).toHaveAttribute("data-dimension", "environment");
    expect(breakdown).toHaveTextContent("run-eu");
    // Another account's environment is not this page's.
    expect(breakdown).not.toHaveTextContent("elsewhere");
    expect(
      within(breakdown).getByRole("link", { name: /shop-ecs/ }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/app-platforms/${ECS_ENV}`),
    );
    expect(
      within(breakdown).getByTestId("cloud-cost-breakdown-total"),
    ).toHaveTextContent("$400.00 in all");
    expect(restLines(breakdown)).toEqual([
      ["not-in-environment", "$110.00 is not in an App Platforms environment."],
    ]);
    expect(BREAKDOWN_REST_LABELS["not-in-environment"]).toBe(
      "{{amount}} is not in an App Platforms environment.",
    );
  });

  test("read once: switching back to it reads the costs, not the environments, again", async () => {
    await openCard();

    await breakDownBy("environment");
    await waitFor(() => {
      expect(screen.getByTestId("cloud-cost-breakdown")).toHaveTextContent(
        "shop-ecs",
      );
    });
    await breakDownBy("service");
    await breakDownBy("app");
    await waitFor(() => {
      expect(screen.getByTestId("cloud-cost-breakdown")).toHaveTextContent(
        "checkout",
      );
    });

    // One list of environments and one of apps, for both.
    expect(getListSpy).toHaveBeenCalledTimes(2);
  });

  test("none in these accounts: says so, and the whole spend is the rest", async () => {
    environmentsForTest = [];
    appsForTest = [];

    const breakdown: HTMLElement = await openCard();

    await breakDownBy("environment");

    await waitFor(() => {
      expect(
        within(breakdown).getByTestId("ranked-bars-empty"),
      ).toHaveTextContent(ENVIRONMENTS_EMPTY);
    });
    expect(restLines(breakdown)).toEqual([
      ["not-in-environment", "$400.00 is not in an App Platforms environment."],
    ]);
  });
});

describe("by app", () => {
  test("each app its platform bills by name, linked to its page; what its environment is billed as a whole and what is in none under the list", async () => {
    const breakdown: HTMLElement = await openCard();

    await breakDownBy("app");

    await waitFor(() => {
      expect(breakdown).toHaveTextContent("checkout");
    });

    expect(
      within(breakdown).getByRole("link", { name: /checkout/ }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/app-platforms/${RUN_ENV}/apps/${CHECKOUT_APP}`),
    );
    // Its environment's name under it.
    expect(breakdown).toHaveTextContent("run-eu");
    expect(restLines(breakdown)).toEqual([
      [
        "not-one-app",
        "$215.00 is billed to an environment as a whole, not to one app.",
      ],
      ["not-in-environment", "$110.00 is not in an App Platforms environment."],
    ]);
    expect(breakdown).toHaveTextContent(APPS_NOTE);
  });
});

describe("by tag", () => {
  test("the tags the accounts' costs carry, the costliest first; the costliest read first, its costs without it under the list", async () => {
    const breakdown: HTMLElement = await openCard();

    await breakDownBy("tag");

    await waitFor(() => {
      expect(breakdown).toHaveTextContent("staging");
    });

    // env: 400 + 700 across the accounts, team: 900.
    expect(tagRequests().pop()!.groupByAttributeKeys).toEqual(["env"]);
    expect(breakdown).toHaveTextContent("prod");
    expect(breakdown).not.toHaveTextContent("payments");
    expect(
      within(breakdown).getByTestId("cloud-cost-breakdown-total"),
    ).toHaveTextContent("$1,100 in all");
    // Every cost carries env: nothing under the list.
    expect(restLines(breakdown)).toEqual([]);

    expect(
      within(breakdown).getByTestId("cloud-cost-breakdown-tag"),
    ).toBeInTheDocument();
    expect(breakdown).toHaveTextContent(TAGS_NOTE);
  });

  test("another tag picked: its values read and listed", async () => {
    const breakdown: HTMLElement = await openCard();

    await breakDownBy("tag");
    await waitFor(() => {
      expect(breakdown).toHaveTextContent("staging");
    });

    const picker: HTMLElement = within(
      within(breakdown).getByTestId("cloud-cost-breakdown-tag"),
    ).getByRole("combobox");

    await act(async () => {
      fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });
    });

    const options: Array<HTMLElement> = await screen.findAllByRole("option");
    expect(
      options.map((option: HTMLElement) => {
        return option.textContent?.trim();
      }),
    ).toEqual(["env", "team"]);

    await act(async () => {
      fireEvent.click(options[1]!);
    });

    await waitFor(() => {
      expect(breakdown).toHaveTextContent("payments");
    });
    expect(tagRequests().pop()!.groupByAttributeKeys).toEqual(["team"]);
    expect(restLines(breakdown)).toEqual([
      ["without-tag", "$100.00 does not carry this tag."],
    ]);
  });

  test("no cost carries a tag yet: says so, with no picker and nothing read", async () => {
    const plain: CloudAccountRow = row({
      id: WEB_ROW,
      name: "web-prod",
      accountId: "123456789012",
    });
    const breakdown: HTMLElement = await openCard({ accounts: [plain] });

    await breakDownBy("tag");

    await waitFor(() => {
      expect(
        within(breakdown).getByTestId("ranked-bars-empty"),
      ).toHaveTextContent(TAGS_EMPTY);
    });
    expect(
      within(breakdown).queryByTestId("cloud-cost-breakdown-tag"),
    ).toBeNull();
    expect(tagRequests()).toHaveLength(0);
  });
});

describe("by resource", () => {
  test("which clouds name a cost's resource; an AWS account whose costs per resource could not be read, with why", async () => {
    const refused: CloudAccountRow = row({
      id: WEB_ROW,
      name: "web-prod",
      accountId: "123456789012",
      costSummary: summary({
        resources: {
          state: CloudCostState.NotSetUp,
          message: "Resource-level data is not turned on for this account.",
        },
      }),
    });
    const read: CloudAccountRow = row({
      id: DATA_ROW,
      name: "shop",
      accountId: "210987654321",
      costSummary: summary({ resources: { state: CloudCostState.Reading } }),
    });
    answers["resourceId"] = [{ resourceId: "", value: 10 }];

    const breakdown: HTMLElement = await openCard({
      accounts: [refused, read],
    });

    await breakDownBy("resourceId");

    await waitFor(() => {
      expect(breakdown).toHaveTextContent(BREAKDOWN_RESOURCES_NOTE);
    });

    const notRead: HTMLElement = within(breakdown).getByTestId(
      "cloud-cost-breakdown-resources-not-read",
    );
    expect(notRead).toHaveTextContent(BREAKDOWN_RESOURCES_NOT_READ_TITLE);

    const accounts: Array<HTMLElement> = within(notRead).getAllByTestId(
      "cloud-cost-breakdown-resources-not-read-account",
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toHaveTextContent("web-prod");
    expect(accounts[0]).toHaveTextContent(
      "Resource-level data is not turned on for this account.",
    );
  });

  test("every account's read, or none asked for: no list", async () => {
    answers["resourceId"] = [];

    const breakdown: HTMLElement = await openCard();

    await breakDownBy("resourceId");

    await waitFor(() => {
      expect(breakdown).toHaveTextContent(BREAKDOWN_RESOURCES_NOTE);
    });
    expect(
      within(breakdown).queryByTestId(
        "cloud-cost-breakdown-resources-not-read",
      ),
    ).toBeNull();
  });
});

describe("the helpers", () => {
  test("an empty list says what it breaks down by", () => {
    const text: (
      dimension: CloudCostDimension,
      hasEnvironments: boolean,
      hasTagKeys: boolean,
    ) => string = (
      dimension: CloudCostDimension,
      hasEnvironments: boolean,
      hasTagKeys: boolean,
    ): string => {
      return getCloudCostBreakdownEmptyText({
        dimension,
        hasEnvironments,
        hasTagKeys,
      });
    };

    expect(text("service", false, false)).toBe(BREAKDOWN_EMPTY);
    expect(text("environment", false, false)).toBe(ENVIRONMENTS_EMPTY);
    expect(text("app", false, false)).toBe(ENVIRONMENTS_EMPTY);
    expect(text("environment", true, false)).toBe(ENVIRONMENTS_NONE_COST);
    expect(text("app", true, false)).toBe(APPS_NONE_COST);
    expect(text("tag", false, false)).toBe(TAGS_EMPTY);
    expect(text("tag", false, true)).toBe(TAG_VALUE_NONE_COST);
  });

  test("the environments of the page's accounts, by their ids in their clouds, whatever their case", () => {
    const lists: CloudCostPlatformLists = {
      environments: [
        {
          id: "a",
          name: "a",
          platform: ManagedCloudPlatform.AwsEcs,
          provider: "aws",
          accountId: "123456789012",
          region: "us-east-1",
        },
        {
          id: "b",
          name: "b",
          platform: ManagedCloudPlatform.AzureAppService,
          provider: "azure",
          accountId: "5F0C0000-0000-4000-8000-000000000001",
          region: "westeurope",
        },
        {
          id: "c",
          name: "c",
          platform: ManagedCloudPlatform.AwsEcs,
          provider: "aws",
          accountId: "999999999999",
          region: "us-east-1",
        },
      ],
      apps: [{ id: "x", environmentId: "c", name: "x" }],
    };

    const scoped: CloudCostPlatformLists = scopeCloudCostPlatformLists({
      lists,
      accounts: [
        WEB,
        row({
          id: DATA_ROW,
          provider: "azure",
          accountId: "5f0c0000-0000-4000-8000-000000000001",
        }),
      ],
    });

    expect(
      scoped.environments.map((entry: { id: string }) => {
        return entry.id;
      }),
    ).toEqual(["a", "b"]);
    // Apps are found by their environment: every one is kept.
    expect(scoped.apps).toEqual(lists.apps);
  });

  test("the Elastic Beanstalk tag is what AWS tags an environment's resources with", () => {
    expect(ELASTIC_BEANSTALK_ENVIRONMENT_TAG).toBe(
      "elasticbeanstalk:environment-name",
    );
    const keys: Array<CloudCostTagKey> = WEB.costSummary!.tagKeys || [];
    expect(keys[0]).toEqual({ key: "team", amount: 900 });
  });
});
