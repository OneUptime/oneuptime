import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";

/*
 * An App Platforms app's Overview tab, below its numbers (#5511's UI
 * review), rendered for real with the charts stood in for and no project
 * to read numbers for:
 *
 *   - Running now names each revision's state with the Revisions tab's
 *     pills - Current, then Running - so the bars' colours say what they
 *     mean, and says what two revisions at once mean only when there are
 *     two (its description said it on every app);
 *   - Details is drawn as every resource Overview's is: each attribute
 *     named as the app's telemetry chips name it, its key beside it ("App
 *     (aws.ecs.task.family)", "Cluster (aws.ecs.cluster.arn)") where it read
 *     a raw key on one row and "Revision Attribute" on the next; the
 *     revision the app runs under the attribute it is read from; the image
 *     whole.
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

// No project: the span reads answer at once, with nothing.
jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const harness: { StandInLineChart: unknown } = jest.requireActual(
    "./TimeRangeZoomPageHarness",
  ) as { StandInLineChart: unknown };
  return { __esModule: true, default: harness.StandInLineChart };
});

import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudAppRevision from "../../../Models/DatabaseModels/CloudAppRevision";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "../../../Models/DatabaseModels/CloudResourceInstance";
import CloudAppOverviewTab, {
  RUNNING_NOW_EMPTY,
  RUNNING_NOW_SPLIT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/CloudAppOverviewTab";
import { CLOUD_APP_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/CloudMetricDescriptions";

const MINUTE_MS: number = 60 * 1000;
// The Details row of when the app was first seen, whatever the date.
const FIRST_SEEN_ROW: RegExp = /^First Seen: /;
const APP_ID: string = "75000000-0000-4000-8000-000000000001";
const CLUSTER_ARN: string =
  "arn:aws:ecs:us-east-1:123456789012:cluster/production";
const IMAGE: string =
  "123456789012.dkr.ecr.us-east-1.amazonaws.com/checkout-api:2.4.1";

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE_MS);
}

const ECS_ENVIRONMENT: CloudResource = Object.assign(new CloudResource(), {
  _id: "71000000-0000-4000-8000-000000000001",
  name: "checkout · us-east-1 · 123456789012",
  cloudPlatform: "aws_ecs",
  cloudProvider: "aws",
  cloudRegion: "us-east-1",
  cloudAccountId: "123456789012",
});

// An app's fields as a test writes them: one it leaves unset reads undefined.
type CloudAppFields = { [K in keyof CloudApp]?: CloudApp[K] | undefined };

function ecsApp(fields: CloudAppFields = {}): CloudApp {
  return Object.assign(new CloudApp(), {
    _id: APP_ID,
    name: "checkout-api",
    cloudPlatform: "aws_ecs",
    groupName: "production",
    telemetryAttributes: {
      "aws.ecs.cluster.arn": CLUSTER_ARN,
      "aws.ecs.task.family": "checkout-api",
    },
    revisionAttribute: "aws.ecs.task.revision",
    currentRevision: "43",
    currentRevisionSince: minutesAgo(25),
    previousRevision: "42",
    image: IMAGE,
    lastSeenAt: minutesAgo(1),
    createdAt: minutesAgo(10 * 24 * 60),
    ...fields,
  });
}

function instance(revision: string, seenMinutesAgo: number = 1): CloudResourceInstance {
  return Object.assign(new CloudResourceInstance(), {
    cloudAppId: APP_ID,
    revision,
    lastSeenAt: minutesAgo(seenMinutesAgo),
  });
}

async function renderTab(data: {
  app: CloudApp;
  environment?: CloudResource;
  instances: Array<CloudResourceInstance>;
}): Promise<void> {
  await act(async () => {
    render(
      <CloudAppOverviewTab
        app={data.app}
        environment={data.environment || ECS_ENVIRONMENT}
        instances={data.instances}
        revisions={[] as Array<CloudAppRevision>}
        start={minutesAgo(60)}
        end={new Date()}
        refreshToken={0}
      />,
    );
  });
}

function detailRows(): Array<{ key: string; label: string; value: string }> {
  return screen
    .getAllByTestId("cloud-app-detail-row")
    .map((row: HTMLElement): { key: string; label: string; value: string } => {
      return {
        key: row.getAttribute("data-detail") || "",
        label: (row.querySelector("dt")?.textContent || "").trim(),
        value: (row.querySelector("dd")?.textContent || "").trim(),
      };
    });
}

afterEach(() => {
  cleanup();
});

describe("Running now", () => {
  test("names each revision's state as the Revisions tab does, and explains two revisions at once", async () => {
    await renderTab({
      app: ecsApp(),
      instances: [instance("43"), instance("42"), instance("43")],
    });

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "cloud-app-running-revision",
    );

    // The current revision first, then the busiest.
    expect(
      rows.map((row: HTMLElement): string | null => {
        return row.getAttribute("data-current");
      }),
    ).toEqual(["true", "false"]);
    expect(within(rows[0]!).getByText("43")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Current")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("2 instances")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("42")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Running")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("1 instance")).toBeInTheDocument();

    expect(screen.getByTestId("cloud-app-running-now-split")).toHaveTextContent(
      RUNNING_NOW_SPLIT,
    );
  });

  test("one revision running says nothing about deploys in progress", async () => {
    await renderTab({
      app: ecsApp(),
      instances: [instance("43"), instance("43")],
    });

    expect(screen.getAllByTestId("cloud-app-running-revision")).toHaveLength(1);
    expect(screen.queryByTestId("cloud-app-running-now-split")).toBeNull();
    // Its description is short, and no longer explains the two-revision case.
    expect(CLOUD_APP_METRIC_DESCRIPTIONS.rollout).not.toContain(
      "Two revisions",
    );
    expect(CLOUD_APP_METRIC_DESCRIPTIONS.rollout.length).toBeLessThan(100);
  });

  test("an app with no live instance says so, and only the live ones count", async () => {
    await renderTab({
      app: ecsApp({ lastSeenAt: minutesAgo(120) }),
      // Seen two hours ago: stale, not running anything now.
      instances: [instance("43", 120)],
    });

    expect(screen.getByTestId("cloud-app-running-now-empty")).toHaveTextContent(
      RUNNING_NOW_EMPTY,
    );
    expect(screen.queryByTestId("cloud-app-running-revision")).toBeNull();
    expect(screen.queryByTestId("cloud-app-running-now-split")).toBeNull();
  });
});

describe("Details", () => {
  test("names each attribute as the app's chips do, its key beside it, then the revision, the image and when it was first seen", async () => {
    await renderTab({ app: ecsApp(), instances: [instance("43")] });

    expect(detailRows()).toEqual([
      {
        key: "aws.ecs.task.family",
        label: "App (aws.ecs.task.family)",
        value: "checkout-api",
      },
      {
        key: "aws.ecs.cluster.arn",
        label: "Cluster (aws.ecs.cluster.arn)",
        value: CLUSTER_ARN,
      },
      {
        key: "revision",
        label: "Task definition revision (aws.ecs.task.revision)",
        value: "43",
      },
      { key: "image", label: "Image", value: IMAGE },
      expect.objectContaining({ key: "first-seen", label: "First Seen" }),
    ]);

    // Identifiers in the Details font, the date in the page's.
    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "cloud-app-detail-row",
    );
    expect(rows[0]!.querySelector("dd")).toHaveClass("font-mono");
    expect(rows[rows.length - 1]!.querySelector("dd")).not.toHaveClass(
      "font-mono",
    );
    // A long ARN breaks after its own colons and slashes first.
    expect(rows[1]!.querySelector("dd wbr")).not.toBeNull();
    /*
     * An attribute's key breaks after its dots, never mid-word: at a
     * tablet's width the label read "aws.ecs.task.fam" over "ily".
     */
    expect(rows[0]!.querySelectorAll("dt wbr")).toHaveLength(3);
    expect(rows[2]!.querySelectorAll("dt wbr")).toHaveLength(3);
    // Never the old "Revision Attribute" row.
    expect(screen.queryByText("Revision Attribute")).toBeNull();
  });

  test("a Cloud Run app reads its revision under faas.version, and leaves out what it does not report", async () => {
    await renderTab({
      app: ecsApp({
        name: "api",
        cloudPlatform: "gcp_cloud_run",
        groupName: undefined,
        telemetryAttributes: { "faas.name": "api" },
        revisionAttribute: "faas.version",
        currentRevision: "api-00042-xyz",
        image: undefined,
      }),
      environment: Object.assign(new CloudResource(), {
        cloudPlatform: "gcp_cloud_run",
        cloudProvider: "gcp",
        cloudRegion: "europe-west1",
        cloudAccountId: "acme-prod",
      }),
      instances: [],
    });

    expect(
      detailRows().map((row: { label: string; value: string }): string => {
        return `${row.label}: ${row.value}`;
      }),
    ).toEqual([
      "App (faas.name): api",
      // The whole revision here; rows elsewhere leave the service's name off.
      "Revision (faas.version): api-00042-xyz",
      expect.stringMatching(FIRST_SEEN_ROW),
    ]);
  });

  test("an app with no revision reported leaves the revision row out", async () => {
    await renderTab({
      app: ecsApp({ currentRevision: undefined, image: undefined }),
      instances: [],
    });

    expect(
      detailRows().map((row: { key: string }): string => {
        return row.key;
      }),
    ).toEqual(["aws.ecs.task.family", "aws.ecs.cluster.arn", "first-seen"]);
  });
});
