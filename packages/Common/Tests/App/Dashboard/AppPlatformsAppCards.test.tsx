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
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The App Platforms cards that list apps and deploys, rendered for real with
 * the network stood in for: the environment Overview's Apps card (the apps
 * that need a look first, each linking to its page), the product Overview's
 * Recent deploys (the newest deploys of the unarchived environments' apps,
 * each opening its app's Revisions), an app page's header, and the feed's
 * kinds for a deploy and a rollback.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudAppRevision from "../../../Models/DatabaseModels/CloudAppRevision";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "../../../Models/DatabaseModels/CloudResourceInstance";
import { CloudResourceFeedEventType } from "../../../Models/DatabaseModels/CloudResourceFeed";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { FeedTone } from "../../../UI/Components/Feed/FeedEntryKind";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import EnvironmentAppsCard, {
  ENVIRONMENT_APPS_SHOWN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/EnvironmentAppsCard";
import RecentDeploysCard from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/RecentDeploysCard";
import CloudAppHeader, {
  CLOUD_APP_HEADER_TEXT_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppHeader";
import { CloudAppRevisionMarkerSource } from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudApps";
import { getEnvironmentFeedKind } from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/View/Feed";

const MINUTE_MS: number = 60 * 1000;
// An app's fields as a test writes them: one it leaves unset reads undefined.
type CloudAppFields = { [K in keyof CloudApp]?: CloudApp[K] | undefined };
// A fact of a line of facts (CloudAppFacts), not the dot before it.
const FACT_TEST_ID: RegExp = /^cloud-app-fact-(?!separator)/;
const ENVIRONMENT_ID: string = "74000000-0000-4000-8000-000000000001";
const ARCHIVED_ENVIRONMENT_ID: string = "74000000-0000-4000-8000-000000000002";
const APP_PLATFORMS: string = `/dashboard/${PROJECT_ID}/app-platforms`;
const CLUSTER_ARN: string =
  "arn:aws:ecs:us-east-1:123456789012:cluster/production";

function appId(index: number): string {
  return `75000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE_MS);
}

const ENVIRONMENT: CloudResource = Object.assign(new CloudResource(), {
  _id: ENVIRONMENT_ID,
  name: "AWS ECS · us-east-1",
  cloudPlatform: "aws_ecs",
  cloudProvider: "aws",
  cloudRegion: "us-east-1",
  cloudAccountId: "123456789012",
});

interface AppFixture {
  index: number;
  name: string;
  lastSeenMinutesAgo: number;
  revision?: string;
  // Requests and errors over the last hour; none when it sent nothing.
  requests?: number;
  errors?: number;
  liveInstances?: number;
}

/*
 * Seven apps of one environment: one gone quiet, one at 5% errors, one at
 * 2%, three healthy and one with no requests.
 */
const APPS: Array<AppFixture> = [
  { index: 1, name: "zeta", lastSeenMinutesAgo: 1, requests: 100, errors: 0 },
  { index: 2, name: "reports", lastSeenMinutesAgo: 2 },
  {
    index: 3,
    name: "checkout-api",
    lastSeenMinutesAgo: 1,
    revision: "43",
    requests: 200,
    errors: 10,
    liveInstances: 3,
  },
  { index: 4, name: "worker", lastSeenMinutesAgo: 1, requests: 50, errors: 0 },
  {
    index: 5,
    name: "billing-api",
    lastSeenMinutesAgo: 180,
    revision: "7",
    requests: 0,
  },
  {
    index: 6,
    name: "cron",
    lastSeenMinutesAgo: 3,
    requests: 400,
    errors: 2,
  },
  {
    index: 7,
    name: "api",
    lastSeenMinutesAgo: 1,
    requests: 100,
    errors: 2,
    liveInstances: 1,
  },
];

let listCalls: Array<{
  modelType: string;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
}>;
let posts: Array<JSONObject>;
let apps: Array<AppFixture>;
let failApps: boolean;
let revisions: Array<CloudAppRevision>;

function toApp(fixture: AppFixture): CloudApp {
  return Object.assign(new CloudApp(), {
    _id: appId(fixture.index),
    name: fixture.name,
    cloudResourceId: ENVIRONMENT_ID,
    cloudPlatform: "aws_ecs",
    groupName: "production",
    telemetryAttributes: {
      "aws.ecs.task.family": fixture.name,
      "aws.ecs.cluster.arn": CLUSTER_ARN,
    },
    currentRevision: fixture.revision,
    lastSeenAt: minutesAgo(fixture.lastSeenMinutesAgo),
  });
}

function instancesOf(fixture: AppFixture): Array<CloudResourceInstance> {
  return Array.from({ length: fixture.liveInstances || 0 }, () => {
    return Object.assign(new CloudResourceInstance(), {
      cloudAppId: appId(fixture.index),
      revision: fixture.revision,
      lastSeenAt: minutesAgo(1),
    });
  });
}

function listOf<T extends BaseModel>(data: Array<T>): ListResult<BaseModel> {
  return {
    data: data,
    count: data.length,
    skip: 0,
    limit: 100,
  } as unknown as ListResult<BaseModel>;
}

beforeEach(() => {
  listCalls = [];
  posts = [];
  apps = [...APPS];
  failApps = false;
  revisions = [];
  goTo(APP_PLATFORMS);

  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

  jest.spyOn(ModelAPI, "getList").mockImplementation(((options: {
    modelType: { new (): BaseModel };
    query?: Record<string, unknown>;
    select?: Record<string, unknown>;
  }): Promise<ListResult<BaseModel>> => {
    const modelType: string = new options.modelType().tableName || "";
    listCalls.push({
      modelType,
      query: options.query || {},
      select: options.select || {},
    });

    if (modelType === "CloudApp") {
      return failApps
        ? Promise.reject(new Error("The apps could not be read."))
        : Promise.resolve(listOf(apps.map(toApp)));
    }

    if (modelType === "CloudResourceInstance") {
      return Promise.resolve(listOf(apps.flatMap(instancesOf)));
    }

    if (modelType === "CloudResource") {
      // The unarchived environments, by id: the archived one is left out.
      return Promise.resolve(
        listOf([Object.assign(new CloudResource(), { _id: ENVIRONMENT_ID })]),
      );
    }

    if (modelType === "CloudAppRevision") {
      return Promise.resolve(listOf(revisions));
    }

    return Promise.resolve(listOf([]));
  }) as never);

  // One grouped read of the environment's apps' requests.
  jest.spyOn(API, "post").mockImplementation((async (options: {
    data: JSONObject;
  }) => {
    posts.push(options.data);
    return new HTTPResponse(
      200,
      {
        data: apps
          .filter((fixture: AppFixture): boolean => {
            return Boolean(fixture.requests);
          })
          .map((fixture: AppFixture): JSONObject => {
            return {
              groupValues: {
                "resource.aws.ecs.task.family": fixture.name,
                "resource.aws.ecs.cluster.arn": CLUSTER_ARN,
              },
              count: fixture.requests as number,
              errorCount: fixture.errors || 0,
              p95DurationMs: 120,
            };
          }),
      } as JSONObject,
      {},
    );
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderAppsCard(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`${APP_PLATFORMS}/${ENVIRONMENT_ID}`]}>
        <EnvironmentAppsCard
          environmentId={new ObjectID(ENVIRONMENT_ID)}
          environment={ENVIRONMENT}
        />
      </MemoryRouter>,
    );
  });
}

function appRows(): Array<HTMLElement> {
  return screen.getAllByTestId("environment-app");
}

describe("an environment's Apps card", () => {
  test("lists the apps that need a look first: not reporting, then by error rate, then by name", async () => {
    await renderAppsCard();

    await waitFor(() => {
      expect(appRows()).toHaveLength(ENVIRONMENT_APPS_SHOWN);
    });

    expect(
      appRows().map((row: HTMLElement): string => {
        return within(row).getByRole("link").textContent || "";
      }),
    ).toEqual(["billing-api", "checkout-api", "api", "cron", "worker", "zeta"]);
    expect(appRows()[0]).toHaveAttribute("data-state", "not-reporting");
    expect(appRows()[1]).toHaveAttribute("data-state", "running");

    // Each app opens its own page, under its environment.
    expect(within(appRows()[1]!).getByRole("link")).toHaveAttribute(
      "href",
      `${APP_PLATFORMS}/${ENVIRONMENT_ID}/apps/${appId(3)}`,
    );
  });

  test("says what each app runs: its revision and live instances, or when a quiet one was last heard from", async () => {
    await renderAppsCard();

    await waitFor(() => {
      expect(appRows()[1]).toHaveTextContent("3 instances");
    });

    expect(appRows()[1]).toHaveTextContent("Revision 43");
    expect(appRows()[1]).toHaveTextContent("5.0% errors");
    expect(appRows()[1]).toHaveTextContent("200 requests · p95 120 ms");
    expect(appRows()[0]).toHaveTextContent("Revision 7");
    expect(appRows()[0]).toHaveTextContent(/Last seen .*3 hours ago/);
    expect(appRows()[0]).not.toHaveTextContent("instance");
  });

  test("reads every app's requests in one grouped read of the environment's entry spans", async () => {
    await renderAppsCard();

    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });

    expect(posts[0]).toEqual(
      expect.objectContaining({
        chartType: "table",
        entryOnly: true,
        groupBy: [
          "resource.aws.ecs.cluster.arn",
          "resource.aws.ecs.task.family",
        ],
        attributes: {
          "resource.cloud.platform": "aws_ecs",
          "resource.cloud.account.id": "123456789012",
          "resource.cloud.region": "us-east-1",
        },
      }),
    );
    // The apps are the environment's own.
    const appRead: { query: Record<string, unknown> } = listCalls.find(
      (call: { modelType: string }): boolean => {
        return call.modelType === "CloudApp";
      },
    )!;
    expect(String(appRead.query["cloudResourceId"])).toBe(ENVIRONMENT_ID);
  });

  test("links to all of them when there are more than it lists", async () => {
    await renderAppsCard();

    const link: HTMLElement = await screen.findByRole("link", {
      name: "View all 7 apps",
    });

    expect(link).toHaveAttribute(
      "href",
      `${APP_PLATFORMS}/${ENVIRONMENT_ID}/apps`,
    );
  });

  test("an environment with no app yet says how one appears", async () => {
    apps = [];

    await renderAppsCard();

    expect(
      await screen.findByTestId("environment-apps-empty"),
    ).toHaveTextContent("An app appears when its telemetry names it");
    expect(posts).toHaveLength(0);
  });

  test("a failed read says so, and Refresh reads again", async () => {
    failApps = true;

    await renderAppsCard();

    const refresh: HTMLElement = await screen.findByTestId("refresh-button");

    failApps = false;
    await act(async () => {
      fireEvent.click(refresh);
    });

    await waitFor(() => {
      expect(appRows().length).toBeGreaterThan(0);
    });
  });
});

describe("Recent deploys", () => {
  async function renderRecent(): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={[APP_PLATFORMS]}>
          <RecentDeploysCard />
        </MemoryRouter>,
      );
    });
  }

  test("lists the newest deploys of the unarchived environments' apps, each opening the app's Revisions", async () => {
    revisions = [
      Object.assign(new CloudAppRevision(), {
        _id: "76000000-0000-4000-8000-000000000001",
        revision: "api-00042-xyz",
        previousRevision: "api-00041-abc",
        firstSeenAt: minutesAgo(25),
        cloudResourceId: ENVIRONMENT_ID,
        cloudAppId: appId(7),
        cloudApp: { name: "api", cloudPlatform: "gcp_cloud_run" },
      }),
      Object.assign(new CloudAppRevision(), {
        _id: "76000000-0000-4000-8000-000000000002",
        revision: "43",
        previousRevision: "42",
        firstSeenAt: minutesAgo(90),
        cloudResourceId: ENVIRONMENT_ID,
        cloudAppId: appId(3),
        cloudApp: {
          name: "checkout-api",
          groupName: "production",
          cloudPlatform: "aws_ecs",
        },
      }),
    ];

    await renderRecent();

    const rows: Array<HTMLElement> =
      await screen.findAllByTestId("recent-deploy");

    expect(rows).toHaveLength(2);
    // A Cloud Run revision is shown without its service's name.
    expect(rows[0]).toHaveTextContent("00041-abc → 00042-xyz");
    expect(rows[1]).toHaveTextContent("42 → 43");
    // Where it runs as All Apps says it: the cluster named a cluster.
    expect(rows[1]).toHaveTextContent("AWS ECS · cluster production");
    expect(rows[0]).toHaveTextContent("GCP Cloud Run");
    expect(rows[0]).not.toHaveTextContent("·");
    expect(within(rows[1]!).getByRole("link")).toHaveAttribute(
      "href",
      `${APP_PLATFORMS}/${ENVIRONMENT_ID}/apps/${appId(3)}?tab=Revisions`,
    );

    // The deploys of the unarchived environments only, newest first.
    const environmentRead: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = listCalls.find((call: { modelType: string }): boolean => {
      return call.modelType === "CloudResource";
    })!;
    expect(environmentRead.query).toEqual({
      isArchived: false,
      cloudResourceKind: "environment",
    });
    expect(environmentRead.select).toEqual({ _id: true });

    const deployRead: { query: Record<string, unknown> } = listCalls.find(
      (call: { modelType: string }): boolean => {
        return call.modelType === "CloudAppRevision";
      },
    )!;
    expect(deployRead.query["previousRevision"]).toBeInstanceOf(NotNull);
    const scope: Includes = deployRead.query["cloudResourceId"] as Includes;
    expect(scope).toBeInstanceOf(Includes);
    expect(scope.values.map(String)).toEqual([ENVIRONMENT_ID]);
    expect(scope.values.map(String)).not.toContain(ARCHIVED_ENVIRONMENT_ID);
  });

  test("no deploy yet says how one appears", async () => {
    await renderRecent();

    expect(await screen.findByTestId("recent-deploys-empty")).toHaveTextContent(
      "A deploy shows here when an app starts running a revision it has not run before.",
    );
  });
});

describe("an app's header", () => {
  function renderHeader(data: {
    app: CloudAppFields;
    liveInstances?: number;
    withService?: boolean;
    revisions?: Array<CloudAppRevisionMarkerSource>;
  }): void {
    const app: CloudApp = Object.assign(new CloudApp(), {
      _id: appId(3),
      name: "checkout-api",
      cloudPlatform: "aws_ecs",
      groupName: "production",
      ...data.app,
    });

    render(
      <MemoryRouter>
        <CloudAppHeader
          app={app}
          environment={ENVIRONMENT}
          liveInstances={data.liveInstances}
          revisions={data.revisions}
          environmentRoute={new Route(`${APP_PLATFORMS}/${ENVIRONMENT_ID}`)}
          serviceRoute={
            data.withService
              ? new Route(`/dashboard/${PROJECT_ID}/service/svc-1`)
              : undefined
          }
          alertsRoute={
            data.withService
              ? new Route(
                  `/dashboard/${PROJECT_ID}/service/svc-1/recommendations`,
                )
              : undefined
          }
        />
      </MemoryRouter>,
    );
  }

  test("a running app: its state and instances, where it runs, the revision and what it replaced, and its alerts", () => {
    renderHeader({
      app: {
        lastSeenAt: minutesAgo(1),
        currentRevision: "43",
        currentRevisionSince: minutesAgo(25),
        previousRevision: "42",
        serviceName: "checkout",
        image: "registry/checkout:1.4.2",
      },
      liveInstances: 3,
      withService: true,
    });

    expect(screen.getByTestId("cloud-app-name")).toHaveTextContent(
      "checkout-api",
    );
    expect(screen.getByTestId("cloud-app-header-state")).toHaveTextContent(
      "Running",
    );
    expect(screen.getByTestId("cloud-app-header")).toHaveTextContent(
      "3 instances",
    );
    expect(
      screen.getByRole("link", {
        name: "AWS ECS / Fargate · us-east-1 · cluster production",
      }),
    ).toHaveAttribute("href", `${APP_PLATFORMS}/${ENVIRONMENT_ID}`);

    const revision: HTMLElement = screen.getByTestId(
      "cloud-app-header-revision",
    );
    expect(revision).toHaveTextContent("Revision 43");
    expect(revision).toHaveTextContent("Deployed 25 minutes ago");
    expect(revision).toHaveTextContent("Replaced 42");

    // Alerts that work out of the box: the service's recommended monitors.
    expect(screen.getByRole("link", { name: "Set up alerts" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/service/svc-1/recommendations`,
    );
    expect(screen.getByRole("link", { name: "checkout" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/service/svc-1`,
    );
    expect(screen.getByTestId("cloud-app-header")).toHaveTextContent(
      "registry/checkout:1.4.2",
    );
  });

  /*
   * The facts under the name are kept whole between their dots, and no dot
   * hangs at a line's end: beside the side menu at 1024, and in German at
   * 1280, the header read "Revision 43 ·" over "Deployed 25 minutes ago ·"
   * and broke us-east-1 at its hyphen (#5511's UI review).
   */
  test("its facts are kept whole, a dot of text between two, and its words ask for room beside the controls", () => {
    renderHeader({
      app: {
        lastSeenAt: minutesAgo(1),
        currentRevision: "43",
        currentRevisionSince: minutesAgo(25),
        previousRevision: "42",
      },
      liveInstances: 3,
    });

    const where: HTMLElement = screen.getByTestId("cloud-app-header-where");
    const whereFacts: Array<HTMLElement> =
      within(where).getAllByTestId(FACT_TEST_ID);
    expect(
      whereFacts.map((fact: HTMLElement): string | null => {
        return fact.getAttribute("data-testid");
      }),
    ).toEqual([
      "cloud-app-fact-platform",
      "cloud-app-fact-region",
      "cloud-app-fact-group",
    ]);
    // One dot between two facts, none before the first.
    expect(
      within(where).getAllByTestId("cloud-app-fact-separator"),
    ).toHaveLength(2);
    expect(
      within(whereFacts[0]!).queryByTestId("cloud-app-fact-separator"),
    ).toBeNull();
    // The dots are text: copied or read aloud, the line is whole.
    expect(where.textContent).toBe(
      "AWS ECS / Fargate · us-east-1 · cluster production",
    );

    const revision: HTMLElement = screen.getByTestId(
      "cloud-app-header-revision",
    );
    expect(revision.textContent).toBe(
      "Revision 43 · Deployed 25 minutes ago · Replaced 42",
    );
    expect(revision).toHaveAttribute("data-change", "deployed");
    // What it replaced is quieter, but readable: never gray-400 on white.
    expect(within(revision).getByTestId("cloud-app-fact-replaced")).toHaveClass(
      "text-gray-500",
    );

    // The words beside the logo ask for 20rem, so the controls give way.
    expect(CLOUD_APP_HEADER_TEXT_CLASS_NAME).toContain("md:min-w-[20rem]");
    expect(
      screen.getByTestId("cloud-app-name").parentElement!.parentElement,
    ).toHaveClass("md:min-w-[20rem]");
  });

  /*
   * A revision the app went back to was not deployed then: the header said
   * "Deployed 10 minutes ago" for a rollback.
   */
  test("a rolled-back app says when it rolled back, in amber, not when it was deployed", () => {
    renderHeader({
      app: {
        lastSeenAt: minutesAgo(1),
        currentRevision: "42",
        currentRevisionSince: minutesAgo(10),
        previousRevision: "43",
      },
      liveInstances: 2,
      revisions: [
        { revision: "43", previousRevision: "42", firstSeenAt: minutesAgo(40) },
        {
          revision: "42",
          previousRevision: "41",
          firstSeenAt: minutesAgo(3 * 24 * 60),
        },
      ],
    });

    const revision: HTMLElement = screen.getByTestId(
      "cloud-app-header-revision",
    );
    expect(revision.textContent).toBe(
      "Revision 42 · Rolled back 10 minutes ago · Replaced 43",
    );
    expect(revision).toHaveAttribute("data-change", "rolled-back");
    expect(
      within(revision).getByTestId("cloud-app-fact-rolled-back"),
    ).toHaveClass("text-amber-700");
    expect(revision).not.toHaveTextContent("Deployed");
  });

  test("without its revisions read, a newer revision is said deployed", () => {
    renderHeader({
      app: {
        lastSeenAt: minutesAgo(1),
        currentRevision: "42",
        currentRevisionSince: minutesAgo(10),
        previousRevision: "43",
      },
    });

    expect(screen.getByTestId("cloud-app-header-revision")).toHaveAttribute(
      "data-change",
      "deployed",
    );
  });

  test("a quiet app says when it was last heard from, and an app with no service offers no alerts", () => {
    renderHeader({
      app: { lastSeenAt: minutesAgo(180), currentRevision: undefined },
      liveInstances: 0,
    });

    expect(screen.getByTestId("cloud-app-header-state")).toHaveTextContent(
      "Not reporting",
    );
    expect(screen.getByTestId("cloud-app-header")).toHaveTextContent(
      /Last seen .*3 hours ago/,
    );
    expect(screen.getByTestId("cloud-app-header")).not.toHaveTextContent(
      "0 instances",
    );
    expect(screen.getByTestId("cloud-app-header-revision")).toHaveTextContent(
      "No revision reported yet",
    );
    expect(screen.queryByRole("link", { name: "Set up alerts" })).toBeNull();
  });
});

describe("an environment's feed", () => {
  test("draws a deploy as a rocket and a rollback as a U-turn, and leaves the rest to the shared kinds", () => {
    expect(
      getEnvironmentFeedKind(CloudResourceFeedEventType.AppDeployed),
    ).toEqual({ icon: IconProp.RocketLaunch, tone: FeedTone.Record });
    expect(
      getEnvironmentFeedKind(CloudResourceFeedEventType.AppRolledBack),
    ).toEqual({ icon: IconProp.ArrowUturnLeft, tone: FeedTone.Record });
    expect(
      getEnvironmentFeedKind(CloudResourceFeedEventType.OwnerUserAdded),
    ).toBeUndefined();
  });
});
