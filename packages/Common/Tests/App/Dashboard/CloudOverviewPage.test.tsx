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
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Route from "../../../Types/API/Route";
import {
  CloudCostState,
  CloudSavingKind,
} from "../../../Types/Cloud/CloudCost";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import { COST_STATE_LABELS } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostWords";
import {
  ALL_ACCOUNTS_READING,
  COSTS_NOT_READ_YET,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudOverviewTiles";
import CloudOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

/*
 * CLOUD'S OVERVIEW, the page Cloud opens on, with the network stubbed:
 *
 *   - the strip: the accounts and whether they are read, the resources,
 *     what needs attention now (from the attention card's own read) and
 *     the month's spend against last month's by now;
 *   - Needs attention over every account, the account named under each;
 *   - Spend and Ways to spend less side by side, then the accounts the
 *     most costly first, then the App Platforms environments and apps that
 *     run in them;
 *   - before any cost is read, what each cloud needs for it to be - only
 *     the clouds the project has accounts in;
 *   - no account yet: what Cloud gives and the way to connect one, held to
 *     the right to connect;
 *   - a read that fails says so, with Refresh.
 */

const WEB_ROW: string = "10000000-0000-4000-8000-0000000000b1";
const DATA_ROW: string = "10000000-0000-4000-8000-0000000000b2";
const INSTANCE_ROW: string = "10000000-0000-4000-8000-0000000000c1";
const ENVIRONMENT_ROW: string = "10000000-0000-4000-8000-0000000000e1";
const OTHER_ENVIRONMENT_ROW: string = "10000000-0000-4000-8000-0000000000e2";

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function costSummary(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    state: CloudCostState.Reading,
    currency: "USD",
    monthToDate: 3000,
    lastMonth: 5000,
    lastMonthToDate: 2500,
    projectedMonth: 4800,
    last30Days: 4700,
    topServices: [
      { service: "Amazon EC2", amount: 1800 },
      { service: "Amazon RDS", amount: 700 },
    ],
    readAt: minutesAgo(60).toISOString(),
    ...overrides,
  };
}

function account(data: Partial<CloudAccount> & { _id: string }): CloudAccount {
  const model: CloudAccount = new CloudAccount();
  Object.assign(model, data);
  return model;
}

function webAccount(overrides: Partial<CloudAccount> = {}): CloudAccount {
  return account({
    _id: WEB_ROW,
    name: "web-prod",
    provider: "aws",
    accountId: "123456789012",
    lastSeenAt: minutesAgo(3),
    cloudConnectionId: new ObjectID(DATA_ROW),
    resourceCount: 240,
    costSummary: costSummary(),
    savingsSummary: {
      state: CloudCostState.Reading,
      count: 2,
      monthlySavings: 180,
      byKind: {
        [CloudSavingKind.Rightsize]: { count: 1, monthlySavings: 150 },
        [CloudSavingKind.Idle]: { count: 1, monthlySavings: 30 },
      },
      currency: "USD",
      readAt: minutesAgo(60).toISOString(),
    },
    ...overrides,
  });
}

function dataAccount(overrides: Partial<CloudAccount> = {}): CloudAccount {
  return account({
    _id: DATA_ROW,
    name: "data-lake",
    provider: "aws",
    accountId: "210987654321",
    lastSeenAt: minutesAgo(3),
    cloudConnectionId: new ObjectID(DATA_ROW),
    resourceCount: 8,
    costSummary: costSummary({
      monthToDate: 9000,
      lastMonthToDate: 9000,
      topServices: [{ service: "Amazon S3", amount: 9000 }],
    }),
    ...overrides,
  });
}

function failingInstance(): CloudResource {
  const resource: CloudResource = new CloudResource();
  Object.assign(resource, {
    _id: INSTANCE_ROW,
    name: "web-1",
    cloudProvider: "aws",
    cloudResourceType: "AWS::EC2::Instance",
    cloudRegion: "us-east-1",
    cloudAccountId: "123456789012",
    otelCollectorStatus: "connected",
    cloudReadings: {
      "aws/ec2/statuscheckfailed": {
        value: 1,
        time: minutesAgo(5).toISOString(),
      },
    },
    cloudReadingsAt: minutesAgo(2),
    healthSeverity: "critical",
  });
  return resource;
}

function environment(id: string, accountId: string): CloudResource {
  const resource: CloudResource = new CloudResource();
  Object.assign(resource, {
    _id: id,
    cloudProvider: "aws",
    cloudAccountId: accountId,
  });
  return resource;
}

function recommendation(): CloudCostRecommendation {
  const model: CloudCostRecommendation = new CloudCostRecommendation();
  Object.assign(model, {
    _id: "10000000-0000-4000-8000-0000000000f1",
    kind: CloudSavingKind.Rightsize,
    action: "Rightsize",
    resourceName: "i-0web",
    monthlySavings: 150,
    currency: "USD",
    cloudResourceId: new ObjectID(INSTANCE_ROW),
    cloudResource: { name: "web-1" },
    cloudAccount: { name: "web-prod" },
  });
  return model;
}

let accountsForTest: Array<CloudAccount> | Error = [];
let attentionForTest: Array<CloudResource> | Error = [];
let createGate: PermissionGateResult = { isAllowed: true };
let listSpy: jest.SpyInstance<any, any>;
let countSpy: jest.SpyInstance<any, any>;
let navigateSpy: jest.SpyInstance<any, any>;

const pageProps: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/cloud`),
  currentProject: null,
  hasPaymentMethod: true,
};

function list<T>(data: Array<T>): {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data, count: data.length, skip: 0, limit: 100 };
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud`);

  accountsForTest = [webAccount(), dataAccount()];
  attentionForTest = [failingInstance()];
  createGate = { isAllowed: true };

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return createGate;
    },
  );
  navigateSpy = getJestSpyOn(Navigation, "navigate").mockImplementation(
    () => {},
  );

  listSpy = getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (request: {
      modelType: unknown;
      query: Record<string, unknown>;
    }): Promise<unknown> => {
      if (request.modelType === CloudAccount) {
        if (accountsForTest instanceof Error) {
          throw accountsForTest;
        }
        return list(accountsForTest);
      }

      if (request.modelType === CloudCostRecommendation) {
        return list([recommendation()]);
      }

      if (
        request.modelType === CloudResource &&
        request.query["cloudResourceKind"] === CloudResourceKind.Environment
      ) {
        // One environment in a connected account, one in another account.
        return list([
          environment(ENVIRONMENT_ROW, "123456789012"),
          environment(OTHER_ENVIRONMENT_ROW, "999999999999"),
        ]);
      }

      if (request.modelType === CloudResource) {
        if (attentionForTest instanceof Error) {
          throw attentionForTest;
        }
        return list(attentionForTest);
      }

      throw new Error("Not stubbed");
    },
  );

  countSpy = getJestSpyOn(ModelAPI, "count").mockResolvedValue(3);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <CloudOverview {...pageProps} />
      </MemoryRouter>,
    );
  });
}

function tile(key: string): HTMLElement {
  return screen
    .getAllByTestId("cloud-stat-tile")
    .find((element: HTMLElement): boolean => {
      return element.getAttribute("data-key") === key;
    })!;
}

describe("with accounts connected", () => {
  test("the strip: two accounts read, their resources, one unhealthy, the month so far", async () => {
    await openPage();

    await waitFor(() => {
      expect(
        within(tile("attention")).getByTestId("cloud-stat-tile-value"),
      ).toHaveTextContent("1");
    });

    expect(
      within(tile("accounts")).getByTestId("cloud-stat-tile-value"),
    ).toHaveTextContent("2");
    expect(
      within(tile("accounts")).getByTestId("cloud-stat-tile-sublabel"),
    ).toHaveTextContent(ALL_ACCOUNTS_READING);
    expect(
      within(tile("resources")).getByTestId("cloud-stat-tile-value"),
    ).toHaveTextContent("248");
    expect(tile("attention")).toHaveAttribute("data-tone", "danger");
    expect(
      within(tile("attention")).getByTestId("cloud-stat-tile-sublabel"),
    ).toHaveTextContent("1 unhealthy");
    // $12,000 against $11,500 by the same day of last month.
    expect(
      within(tile("spend")).getByTestId("cloud-stat-tile-value"),
    ).toHaveTextContent("$12,000");
    expect(
      within(tile("spend")).getByTestId("cloud-stat-tile-sublabel"),
    ).toHaveTextContent("4% more than last month by now");
  });

  test("Needs attention over every account, the resource's account named under it", async () => {
    await openPage();

    const card: HTMLElement = await screen.findByTestId(
      "cloud-overview-attention",
    );

    expect(
      within(card).getByTestId("cloud-overview-attention-name"),
    ).toHaveTextContent("web-1");
    expect(card).toHaveTextContent("us-east-1 · 123456789012");

    // Only resources whose last read found something, the most urgent first.
    const request: { query: Record<string, unknown> } = listSpy.mock.calls.find(
      (call: Array<any>): boolean => {
        return (
          call[0].modelType === CloudResource &&
          call[0].query["cloudResourceKind"] !== CloudResourceKind.Environment
        );
      },
    )![0];
    expect(request.query["isArchived"]).toBe(false);
    expect(request.query["healthSeverity"]).toBeDefined();
  });

  test("Spend: the month, its projection, last month, the services that cost the most", async () => {
    await openPage();

    const card: HTMLElement = screen.getByTestId("cloud-spend-card");

    expect(card).toHaveAttribute("data-state", "read");
    expect(screen.getByTestId("cloud-spend-month-to-date")).toHaveTextContent(
      "$12,000",
    );
    expect(screen.getByTestId("cloud-spend-projected")).toHaveTextContent(
      "$9,600",
    );
    expect(screen.getByTestId("cloud-spend-last-month")).toHaveTextContent(
      "$10,000",
    );

    const services: HTMLElement = screen.getByTestId("cloud-spend-services");
    const text: string = services.textContent || "";
    expect(text.indexOf("Amazon S3")).toBeLessThan(text.indexOf("Amazon EC2"));
    expect(text.indexOf("Amazon EC2")).toBeLessThan(text.indexOf("Amazon RDS"));
    expect(services).toHaveTextContent("$9,000");

    expect(screen.getByTestId("cloud-spend-card-link")).toHaveAttribute(
      "href",
      expect.stringContaining("/cloud/costs"),
    );
  });

  test("Ways to spend less: what could be saved a month, and the largest, each linked to its resource", async () => {
    await openPage();

    const card: HTMLElement = screen.getByTestId("cloud-savings-card");

    expect(card).toHaveAttribute("data-state", "found");
    expect(card).toHaveTextContent("Up to $180.00 a month");
    expect(card).toHaveTextContent("2 recommendations");

    const row: HTMLElement = await screen.findByTestId("cloud-savings-top-row");
    expect(row).toHaveTextContent("Rightsize");
    expect(row).toHaveTextContent("web-1 · web-prod");
    expect(row).toHaveTextContent("$150.00");
    expect(within(row).getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining(`/cloud/${INSTANCE_ROW}`),
    );

    // The largest few of the costs' currency.
    const request: {
      query: Record<string, unknown>;
      limit: number;
    } = listSpy.mock.calls.find((call: Array<any>): boolean => {
      return call[0].modelType === CloudCostRecommendation;
    })![0];
    expect(request.query["currency"]).toBe("USD");
    expect(request.limit).toBe(3);
  });

  test("Accounts: the most costly first, each linked to its Overview", async () => {
    await openPage();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "cloud-accounts-card-row",
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("data-lake");
    expect(rows[0]).toHaveTextContent("8 resources");
    expect(rows[1]).toHaveTextContent("web-prod");
    expect(rows[1]).toHaveTextContent("$3,000");
    expect(
      within(rows[1]!).getByRole("link", { name: "web-prod" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/cloud/accounts/${WEB_ROW}`),
    );
  });

  test("App Platforms: the environments in these accounts and their apps, linked there", async () => {
    await openPage();

    expect(
      await screen.findByTestId("cloud-app-platforms-environments"),
    ).toHaveTextContent("1 environment");
    expect(screen.getByTestId("cloud-app-platforms-apps")).toHaveTextContent(
      "3 apps",
    );
    expect(
      screen.getByTestId("cloud-app-platforms-environments"),
    ).toHaveAttribute("href", expect.stringContaining("/app-platforms"));

    const request: { modelType: unknown; query: Record<string, unknown> } =
      countSpy.mock.calls[0]![0];
    expect(request.modelType).toBe(CloudApp);
    expect(JSON.stringify(request.query["cloudResourceId"])).toContain(
      ENVIRONMENT_ROW,
    );
    expect(JSON.stringify(request.query["cloudResourceId"])).not.toContain(
      OTHER_ENVIRONMENT_ROW,
    );
  });

  test("no environment in these accounts: no App Platforms card", async () => {
    listSpy.mockImplementation(
      async (request: {
        modelType: unknown;
        query: Record<string, unknown>;
      }): Promise<unknown> => {
        if (request.modelType === CloudAccount) {
          return list([webAccount()]);
        }
        return list([]);
      },
    );

    await openPage();
    await screen.findByTestId("cloud-accounts-card");

    expect(screen.queryByTestId("cloud-app-platforms-card")).toBeNull();
    expect(countSpy).not.toHaveBeenCalled();
  });

  test("an attention read that fails: the tile says it is not known", async () => {
    attentionForTest = new Error("Request failed");

    await openPage();

    await waitFor(() => {
      expect(
        within(tile("attention")).getByTestId("cloud-stat-tile-value"),
      ).toHaveTextContent("—");
    });
    expect(
      screen.getByTestId("cloud-overview-attention-error"),
    ).toBeInTheDocument();
  });
});

describe("before any cost is read", () => {
  test("Spend and Ways to spend less say what each cloud the project uses needs", async () => {
    accountsForTest = [
      webAccount({
        costSummary: costSummary({
          state: CloudCostState.NotAllowed,
          message: "AccessDenied",
        }),
        savingsSummary: undefined,
      }),
    ];

    await openPage();

    const spend: HTMLElement = screen.getByTestId("cloud-spend-card");
    expect(spend).toHaveAttribute("data-state", "not-read");
    const steps: Array<HTMLElement> = within(spend).getAllByTestId(
      "cloud-cost-setup-step",
    );
    // Only AWS: the project has no Azure or Google Cloud account.
    expect(
      steps.map((step: HTMLElement) => {
        return step.getAttribute("data-provider");
      }),
    ).toEqual(["aws"]);
    expect(steps[0]).toHaveTextContent("Cost Explorer");
    expect(within(steps[0]!).getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/docs/telemetry/cloud-costs#amazon-web-services",
      ),
    );

    expect(screen.getByTestId("cloud-savings-card")).toHaveAttribute(
      "data-state",
      "not-read",
    );
    expect(
      within(tile("spend")).getByTestId("cloud-stat-tile-sublabel"),
    ).toHaveTextContent(COSTS_NOT_READ_YET);

    // The account's row says why its costs are not read.
    expect(screen.getByTestId("cloud-accounts-card-spend")).toHaveTextContent(
      COST_STATE_LABELS[CloudCostState.NotAllowed],
    );
  });
});

describe("no account yet", () => {
  test("what Cloud gives, and the way to connect one", async () => {
    accountsForTest = [];

    await openPage();

    expect(screen.getByTestId("resource-showcase")).toBeInTheDocument();
    expect(screen.queryByTestId("cloud-overview-strip")).toBeNull();

    fireEvent.click(screen.getByTestId("resource-showcase-add-button"));
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]![0])).toContain("/cloud/connect");
  });

  test("without the right to connect, the button is disabled", async () => {
    accountsForTest = [];
    createGate = {
      isAllowed: false,
      disabledReason: "You do not have permission to connect a cloud account.",
    };

    await openPage();

    expect(screen.getByTestId("resource-showcase-add-button")).toBeDisabled();
  });
});

describe("a read that fails", () => {
  test("says so, and Refresh reads the accounts again", async () => {
    accountsForTest = new Error("Could not reach the server");

    await openPage();

    expect(screen.getByText("Could not reach the server")).toBeInTheDocument();

    accountsForTest = [webAccount()];

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    expect(
      await screen.findByTestId("cloud-overview-strip"),
    ).toBeInTheDocument();
  });
});
