import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import Route from "../../../Types/API/Route";
import { CloudResourceReadings } from "../../../Types/Cloud/CloudResourceHealth";
import IconProp from "../../../Types/Icon/IconProp";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  CloudHeadlineTile,
  PER_MINUTE,
  formatCloudAmount,
  formatCloudBytes,
  formatCloudSeconds,
  getCloudHeadlineKeys,
  getCloudHeadlineTiles,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudHeadlineTiles";
import {
  CLOUD_RESOURCE_ATTENTION_CURRENT,
  CloudAttentionRow,
  getCloudHealthReasonLine,
  getCloudResourceAttentionItems,
  getCloudResourceOwnAttentionItems,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceAttention";
import CloudResourceStatusCell from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceStatusCell";
import CloudStatStrip from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudStatStrip";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { assessCloudResourceHealth } from "../../../Types/Cloud/CloudResourceHealth";

/*
 * Each cloud resource's health as the Dashboard draws it, from the readings
 * the last read kept: the few numbers its page leads with, in the reader's
 * numerals; Needs attention's rows - the unhealthy first, then those with
 * the most to look at, then by name as people read numbers in names, each
 * one step from its page; the Status cell of the lists - its one word and
 * its most telling reason; and the stat strip the Overview and Costs draw
 * their numbers in.
 */

const NOW: Date = new Date("2026-11-03T10:00:00.000Z");
const ENGLISH: Translator = createTranslator(undefined, "en");
const GERMAN: Translator = createTranslator(undefined, "de");
const GIB: number = 1024 * 1024 * 1024;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function reading(value: number): { value: number; time: string } {
  return { value, time: minutesAgo(5).toISOString() };
}

function resource(
  data: Partial<CloudAttentionRow> & { readings: CloudResourceReadings },
): CloudAttentionRow {
  const { readings, ...rest } = data;
  return {
    cloudProvider: "aws",
    cloudResourceType: "AWS::EC2::Instance",
    otelCollectorStatus: "connected",
    cloudReadings: readings,
    cloudReadingsAt: minutesAgo(2),
    ...rest,
  };
}

afterEach(() => {
  cleanup();
});

describe("what a resource's page leads with", () => {
  test("a database: its CPU with a bar, its free storage as a size, its connections", () => {
    const tiles: Array<CloudHeadlineTile> = getCloudHeadlineTiles({
      provider: "aws",
      type: "AWS::RDS::DBInstance",
      readings: {
        "aws/rds/cpuutilization": reading(37.4),
        "aws/rds/freestoragespace": reading(12.4 * GIB),
        "aws/rds/databaseconnections": reading(42.4),
      },
      hasFreshReadings: true,
      translator: ENGLISH,
    });

    expect(
      tiles.map((tile: CloudHeadlineTile) => {
        return [tile.title, tile.value, tile.percent];
      }),
    ).toEqual([
      ["CPU", "37%", 37.4],
      ["Free storage", "12 GiB", undefined],
      ["Connections", "42", undefined],
    ]);
    expect(tiles[0]!.icon).toBe(IconProp.CPUChip);
  });

  test("a count per period is said per minute; a time in its unit; a reading not kept has no tile", () => {
    const lambda: Array<CloudHeadlineTile> = getCloudHeadlineTiles({
      provider: "aws",
      type: "AWS::Lambda::Function",
      readings: {
        "aws/lambda/invocations": reading(600),
        "aws/lambda/duration": reading(230),
      },
      hasFreshReadings: true,
      translator: ENGLISH,
    });

    expect(
      lambda.map((tile: CloudHeadlineTile) => {
        return tile.key;
      }),
    ).toEqual(["aws/lambda/invocations", "aws/lambda/duration"]);
    expect(lambda[0]!.sublabel).toBe(PER_MINUTE);
    expect(Number(lambda[0]!.value.replace(/,/g, ""))).toBeGreaterThan(0);
    expect(lambda[1]!.value).toBe("230 ms");

    expect(
      getCloudHeadlineTiles({
        provider: "aws",
        type: "AWS::SQS::Queue",
        readings: { "aws/sqs/approximateageofoldestmessage": reading(5400) },
        hasFreshReadings: true,
        translator: ENGLISH,
      })[0]!.value,
    ).toBe("90 min");
  });

  test("readings that are stale, or a type with no headline, give no tiles", () => {
    expect(
      getCloudHeadlineTiles({
        provider: "aws",
        type: "AWS::RDS::DBInstance",
        readings: { "aws/rds/cpuutilization": reading(37) },
        hasFreshReadings: false,
        translator: ENGLISH,
      }),
    ).toEqual([]);
    expect(getCloudHeadlineKeys("aws", "AWS::S3::Bucket")).toEqual([]);
  });

  test("sizes, amounts and times in the reader's numerals", () => {
    expect(formatCloudBytes(0, ENGLISH)).toBe("0 B");
    expect(formatCloudBytes(1536, ENGLISH)).toBe("1.5 KiB");
    expect(formatCloudBytes(300 * GIB, ENGLISH)).toBe("300 GiB");
    expect(formatCloudBytes(-5, ENGLISH)).toBe("0 B");
    expect(formatCloudBytes(9.6 * GIB, ENGLISH)).toBe("9.6 GiB");
    expect(formatCloudBytes(9.6 * GIB, GERMAN)).toBe("9,6 GiB");

    expect(formatCloudAmount(1240.4, ENGLISH)).toBe("1,240");
    expect(formatCloudAmount(37.54, ENGLISH)).toBe("37.5");
    expect(formatCloudAmount(0.421, ENGLISH)).toBe("0.42");

    expect(formatCloudSeconds(0.23, ENGLISH)).toBe("230 ms");
    expect(formatCloudSeconds(1.84, ENGLISH)).toBe("1.8 s");
    expect(formatCloudSeconds(600, ENGLISH)).toBe("10 min");
    expect(formatCloudSeconds(9000, ENGLISH)).toBe("2.5 h");
  });
});

describe("Needs attention's rows", () => {
  const route: (id: string) => Route = (id: string): Route => {
    return new Route(`/dashboard/p/cloud/${id}`);
  };

  test("the unhealthy first, then the most to look at, then by name as numbers read; the healthy left out", () => {
    const items: Array<ResourceAttentionItem> = getCloudResourceAttentionItems({
      resources: [
        resource({
          _id: "db-1",
          name: "orders-db",
          cloudResourceType: "AWS::RDS::DBInstance",
          cloudRegion: "eu-west-1",
          cloudAccountId: "123456789012",
          cloudProperties: { AllocatedStorage: 100 },
          readings: {
            // 92% full and CPU at 97%: two reasons, both warnings.
            "aws/rds/freestoragespace": reading(8 * GIB),
            "aws/rds/cpuutilization": reading(97),
          },
        }),
        resource({
          _id: "web-10",
          name: "web-10",
          readings: { "aws/ec2/statuscheckfailed": reading(1) },
        }),
        resource({
          _id: "web-2",
          name: "web-2",
          readings: { "aws/ec2/statuscheckfailed": reading(1) },
        }),
        resource({
          _id: "cache-1",
          name: "cache-1",
          cloudResourceType: "AWS::ElastiCache::CacheCluster",
          readings: { "aws/elasticache/cpuutilization": reading(99) },
        }),
        resource({
          _id: "fine",
          name: "fine",
          readings: { "aws/ec2/statuscheckfailed": reading(0) },
        }),
      ],
      now: NOW,
      showAccount: true,
      getResourceRoute: route,
    });

    expect(
      items.map((item: ResourceAttentionItem) => {
        return [item.name, item.severity, item.reasons.length];
      }),
    ).toEqual([
      ["web-2", ResourceAttentionSeverity.Critical, 1],
      ["web-10", ResourceAttentionSeverity.Critical, 1],
      ["orders-db", ResourceAttentionSeverity.Warning, 2],
      ["cache-1", ResourceAttentionSeverity.Warning, 1],
    ]);

    const database: ResourceAttentionItem = items[2]!;
    // Where it is, with its account on a list of every account's.
    expect(database.detail).toBe("eu-west-1 · 123456789012");
    expect(database.kindAsWritten).toBe(true);
    expect(database.kind).toBeTruthy();
    expect(database.route?.toString()).toBe("/dashboard/p/cloud/db-1");
  });

  test("on an account's own list, the account is not repeated", () => {
    const items: Array<ResourceAttentionItem> = getCloudResourceAttentionItems({
      resources: [
        resource({
          _id: "web-1",
          name: "web-1",
          cloudRegion: "us-east-1",
          cloudAccountId: "123456789012",
          readings: { "aws/ec2/statuscheckfailed": reading(1) },
        }),
      ],
      now: NOW,
      getResourceRoute: route,
    });

    expect(items[0]!.detail).toBe("us-east-1");
  });

  test("a resource's own page: one row, This resource, or none when it is well", () => {
    expect(
      getCloudResourceOwnAttentionItems({
        resource: resource({
          name: "web-1",
          readings: { "aws/ec2/statuscheckfailed": reading(1) },
        }),
        now: NOW,
      }),
    ).toMatchObject([
      {
        key: CLOUD_RESOURCE_ATTENTION_CURRENT.key,
        name: "web-1",
        severity: ResourceAttentionSeverity.Critical,
      },
    ]);
    expect(
      getCloudResourceOwnAttentionItems({
        resource: resource({
          readings: { "aws/ec2/statuscheckfailed": reading(0) },
        }),
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("a list's line: the first reason and how many more", () => {
    expect(
      getCloudHealthReasonLine(
        assessCloudResourceHealth(
          resource({
            cloudResourceType: "AWS::RDS::DBInstance",
            cloudProperties: { AllocatedStorage: 100 },
            readings: {
              "aws/rds/freestoragespace": reading(8 * GIB),
              "aws/rds/cpuutilization": reading(97),
            },
          }),
          { now: NOW },
        ),
      ).more,
    ).toBe(1);
  });
});

describe("the Status cell", () => {
  test("unhealthy, with why", () => {
    render(
      <CloudResourceStatusCell
        resource={resource({
          readings: { "aws/ec2/statuscheckfailed": reading(1) },
        })}
        now={NOW}
      />,
    );

    const status: HTMLElement = screen.getByTestId("cloud-resource-status");
    expect(status).toHaveAttribute("data-state", "unhealthy");
    expect(status).toHaveAttribute("data-tone", "danger");
    expect(status).toHaveTextContent("Unhealthy");
    expect(
      screen.getByTestId("cloud-resource-status-reason"),
    ).toHaveTextContent("Failing its status checks");
  });

  test("degraded for two reasons: the first, and +1 more", () => {
    render(
      <CloudResourceStatusCell
        resource={resource({
          cloudResourceType: "AWS::RDS::DBInstance",
          cloudProperties: { AllocatedStorage: 100 },
          readings: {
            "aws/rds/freestoragespace": reading(8 * GIB),
            "aws/rds/cpuutilization": reading(97),
          },
        })}
        now={NOW}
      />,
    );

    expect(screen.getByTestId("cloud-resource-status")).toHaveAttribute(
      "data-state",
      "degraded",
    );
    expect(
      screen.getByTestId("cloud-resource-status-reason"),
    ).toHaveTextContent(/\+1 more/);
  });

  test("healthy, with no reason; not reporting once the resource stops", () => {
    render(
      <CloudResourceStatusCell
        resource={resource({
          readings: { "aws/ec2/statuscheckfailed": reading(0) },
        })}
        now={NOW}
        footer={<span data-testid="footer">Seen 2 minutes ago</span>}
      />,
    );

    expect(screen.getByTestId("cloud-resource-status")).toHaveAttribute(
      "data-state",
      "healthy",
    );
    expect(screen.queryByTestId("cloud-resource-status-reason")).toBeNull();
    expect(screen.getByTestId("footer")).toBeInTheDocument();

    cleanup();

    render(
      <CloudResourceStatusCell
        resource={resource({
          otelCollectorStatus: "disconnected",
          readings: { "aws/ec2/statuscheckfailed": reading(1) },
        })}
        now={NOW}
      />,
    );

    expect(screen.getByTestId("cloud-resource-status")).toHaveAttribute(
      "data-state",
      "not-reporting",
    );
  });
});

describe("the stat strip", () => {
  test("each tile its number, the line under it, its tone, and the way to its list", () => {
    render(
      <MemoryRouter>
        <CloudStatStrip
          testId="strip"
          tiles={[
            {
              key: "accounts",
              title: "Accounts",
              value: "2",
              sublabel: "All reading",
              icon: IconProp.Cloud,
              color: "indigo",
              to: new Route("/dashboard/p/cloud/accounts"),
            },
            {
              key: "attention",
              title: "Needs attention",
              value: "",
              icon: IconProp.Alert,
              color: "rose",
              loading: true,
            },
            {
              key: "spend",
              title: "Spend this month",
              value: "$4,120",
              sublabel: "12% more than last month by now",
              sublabelIsTranslated: true,
              tone: "warning",
              icon: IconProp.Billing,
              color: "emerald",
            },
          ]}
        />
      </MemoryRouter>,
    );

    const tiles: Array<HTMLElement> = within(
      screen.getByTestId("strip"),
    ).getAllByTestId("cloud-stat-tile");

    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toHaveTextContent("Accounts");
    expect(tiles[0]).toHaveTextContent("All reading");
    expect(screen.getByRole("link", { name: /Accounts/ })).toHaveAttribute(
      "href",
      "/dashboard/p/cloud/accounts",
    );

    expect(
      within(tiles[1]!).getByTestId("cloud-stat-tile-loading"),
    ).toBeInTheDocument();
    expect(within(tiles[1]!).queryByTestId("cloud-stat-tile-value")).toBeNull();

    expect(tiles[2]).toHaveAttribute("data-tone", "warning");
    expect(within(tiles[2]!).getByTestId("cloud-stat-tile-value")).toHaveClass(
      "text-amber-700",
    );
  });
});
