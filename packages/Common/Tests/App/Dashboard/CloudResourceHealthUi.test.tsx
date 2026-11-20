import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import Route from "../../../Types/API/Route";
import {
  CloudResourceReadings,
  assessCloudResourceHealth,
} from "../../../Types/Cloud/CloudResourceHealth";
import IconProp from "../../../Types/Icon/IconProp";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  CLOUD_HEADLINE_TILES_MAX,
  CloudHeadlineTile,
  NOT_REPORTED,
  NOT_REPORTED_DESCRIPTION,
  PER_MINUTE,
  PER_SECOND,
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
        return [tile.title, tile.value, tile.percent, tile.valueNote];
      }),
    ).toEqual([
      ["CPU", "37%", 37.4, undefined],
      ["Free storage", "12\u00A0GiB", undefined, undefined],
      ["Connections", "42", undefined, undefined],
      // Every RDS instance reports these: a read without them says so.
      ["Free memory", "", undefined, NOT_REPORTED],
      ["Read latency", "", undefined, NOT_REPORTED],
      ["Write latency", "", undefined, NOT_REPORTED],
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
    expect(lambda[1]!.value).toBe("230\u00A0ms");

    expect(
      getCloudHeadlineTiles({
        provider: "aws",
        type: "AWS::SQS::Queue",
        readings: { "aws/sqs/approximateageofoldestmessage": reading(5400) },
        hasFreshReadings: true,
        translator: ENGLISH,
      }).find((tile: CloudHeadlineTile): boolean => {
        return tile.key === "aws/sqs/approximateageofoldestmessage";
      })!.value,
    ).toBe("90\u00A0min");
  });

  test("a virtual machine leads with its CPU, memory, network, disks and availability", () => {
    const tiles: Array<CloudHeadlineTile> = getCloudHeadlineTiles({
      provider: "azure",
      type: "Microsoft.Compute/virtualMachines",
      readings: {
        percentage_cpu: reading(23.6),
        available_memory_bytes: reading(3.2 * GIB),
        // Bytes in the minute: drawn per minute.
        network_in_total: reading(12 * 1024 * 1024),
        network_out_total: reading(512 * 1024),
        disk_read_bytes: reading(0),
        disk_write_bytes: reading(64 * 1024 * 1024),
        vmavailabilitymetric: reading(1),
      },
      hasFreshReadings: true,
      translator: ENGLISH,
    });

    expect(
      tiles.map((tile: CloudHeadlineTile) => {
        return [tile.title, tile.value, tile.sublabel];
      }),
    ).toEqual([
      ["CPU", "24%", undefined],
      ["Free memory", "3.2\u00A0GiB", undefined],
      ["Network in", "12\u00A0MiB", PER_MINUTE],
      ["Network out", "512\u00A0KiB", PER_MINUTE],
      ["Disk read", "0\u00A0B", PER_MINUTE],
      ["Disk write", "64\u00A0MiB", PER_MINUTE],
      ["Availability", "100%", undefined],
    ]);
    expect(
      tiles.map((tile: CloudHeadlineTile) => {
        return tile.icon;
      }),
    ).toEqual([
      IconProp.CPUChip,
      IconProp.Server,
      IconProp.ArrowDown,
      IconProp.ArrowUp,
      IconProp.Disc,
      IconProp.Disc,
      IconProp.Heart,
    ]);
  });

  test("a level the last read did not bring is said plainly; a sum it did not bring is left out", () => {
    const tiles: Array<CloudHeadlineTile> = getCloudHeadlineTiles({
      provider: "azure",
      type: "Microsoft.Compute/virtualMachines",
      readings: { percentage_cpu: reading(40) },
      hasFreshReadings: true,
      translator: ENGLISH,
    });
    const missing: CloudHeadlineTile = tiles.find(
      (tile: CloudHeadlineTile): boolean => {
        return tile.key === "available_memory_bytes";
      },
    )!;

    expect(
      tiles.map((tile: CloudHeadlineTile) => {
        return tile.key;
      }),
    ).toEqual([
      "percentage_cpu",
      "available_memory_bytes",
      "vmavailabilitymetric",
    ]);
    expect(missing.value).toBe("");
    expect(missing.valueNote).toBe(NOT_REPORTED);
    expect(missing.description).toBe(NOT_REPORTED_DESCRIPTION);
    expect(missing.iconColor).toBe("slate");
    // Never a bar for a number that is not there.
    expect(missing.percent).toBeUndefined();
  });

  test("a reading only some resources of the type report is never said to be missing", () => {
    // An Application Load Balancer: a Network Load Balancer's flows are not its.
    const alb: Array<CloudHeadlineTile> = getCloudHeadlineTiles({
      provider: "aws",
      type: "AWS::ElasticLoadBalancingV2::LoadBalancer",
      readings: {
        "aws/applicationelb/requestcount": reading(1500),
        "aws/applicationelb/targetresponsetime": reading(0.12),
      },
      hasFreshReadings: true,
      translator: ENGLISH,
    });

    expect(
      alb.map((tile: CloudHeadlineTile) => {
        return tile.title;
      }),
    ).toEqual(["Requests", "Response time"]);

    // An Aurora instance keeps its data in its cluster's volume.
    expect(
      getCloudHeadlineTiles({
        provider: "aws",
        type: "AWS::RDS::DBInstance",
        readings: {
          "aws/rds/cpuutilization": reading(12),
          "aws/rds/databaseconnections": reading(3),
          "aws/rds/freeablememory": reading(2 * GIB),
          "aws/rds/readlatency": reading(0.002),
          "aws/rds/writelatency": reading(0.004),
        },
        hasFreshReadings: true,
        translator: ENGLISH,
      }).some((tile: CloudHeadlineTile): boolean => {
        return tile.key === "aws/rds/freestoragespace";
      }),
    ).toBe(false);
  });

  test("a load balancer's backends, a gateway's throughput and a firewall's, as sizes per second", () => {
    const balancer: Array<CloudHeadlineTile> = getCloudHeadlineTiles({
      provider: "azure",
      type: "Microsoft.Network/loadBalancers",
      readings: {
        vipavailability: reading(100),
        dipavailability: reading(50),
        bytecount: reading(3 * 1024 * 1024),
      },
      hasFreshReadings: true,
      translator: ENGLISH,
    });

    expect(
      balancer.map((tile: CloudHeadlineTile) => {
        return [tile.title, tile.value, tile.percent];
      }),
    ).toEqual([
      ["Availability", "100%", 100],
      ["Healthy backends", "50%", 50],
      ["Traffic", "3\u00A0MiB", undefined],
    ]);

    const gateway: CloudHeadlineTile = getCloudHeadlineTiles({
      provider: "azure",
      type: "Microsoft.Network/applicationGateways",
      readings: { throughput: reading(2 * 1024 * 1024) },
      hasFreshReadings: true,
      translator: ENGLISH,
    }).find((tile: CloudHeadlineTile): boolean => {
      return tile.key === "throughput";
    })!;

    expect([gateway.value, gateway.sublabel]).toEqual([
      "2\u00A0MiB",
      PER_SECOND,
    ]);

    // A firewall's throughput is in bits: drawn in bytes.
    const firewall: CloudHeadlineTile = getCloudHeadlineTiles({
      provider: "azure",
      type: "Microsoft.Network/azureFirewalls",
      readings: { throughput: reading(8 * 1024 * 1024) },
      hasFreshReadings: true,
      translator: ENGLISH,
    }).find((tile: CloudHeadlineTile): boolean => {
      return tile.key === "throughput";
    })!;

    expect([firewall.value, firewall.sublabel]).toEqual([
      "1\u00A0MiB",
      PER_SECOND,
    ]);
  });

  test("the types the issue asked about lead with what a person reads first about each", () => {
    expect(
      getCloudHeadlineKeys("azure", "Microsoft.Sql/servers/databases"),
    ).toEqual(["cpu_percent", "storage_percent", "sessions_percent"]);
    expect(getCloudHeadlineKeys("azure", "Microsoft.Web/sites")).toEqual([
      "requests",
      "httpresponsetime",
      "http5xx",
      // Its Health check, where one is set (#9740).
      "healthcheckstatus",
      "memoryworkingset",
      "functionexecutioncount",
      // What its files take of its plan's storage, every six hours (#10026).
      "filesystemusage",
    ]);
    // What it stores leads a Cosmos DB account's page (#9740).
    expect(
      getCloudHeadlineKeys("azure", "Microsoft.DocumentDB/databaseAccounts"),
    ).toEqual([
      "datausagev2",
      "indexusagev2",
      "documentcountv2",
      "totalrequests",
      "normalizedruconsumption",
      "serversidelatencydirect",
    ]);
    expect(
      getCloudHeadlineKeys("azure", "Microsoft.Storage/storageAccounts"),
    ).toEqual([
      "availability",
      "transactions",
      "successe2elatency",
      "usedcapacity",
    ]);
    expect(getCloudHeadlineKeys("aws", "AWS::EC2::Instance")).toEqual([
      "aws/ec2/cpuutilization",
      "aws/ec2/networkin",
      "aws/ec2/networkout",
    ]);
    // Its memory and fullest disk, from the Ops Agent on it (#9568).
    expect(getCloudHeadlineKeys("gcp", "gce_instance")).toEqual([
      "compute.googleapis.com/instance/cpu/utilization",
      "agent.googleapis.com/memory/percent_used",
      "agent.googleapis.com/disk/percent_used",
      "compute.googleapis.com/instance/network/received_bytes_count",
      "compute.googleapis.com/instance/network/sent_bytes_count",
    ]);
  });

  test("a share that is better full - availability, healthy backends - draws its bar that way, as its rules judge it", () => {
    const vm: Array<CloudHeadlineTile> = getCloudHeadlineTiles({
      provider: "azure",
      type: "Microsoft.Compute/virtualMachines",
      readings: {
        percentage_cpu: reading(96),
        vmavailabilitymetric: reading(1),
      },
      hasFreshReadings: true,
      translator: ENGLISH,
    });
    const tileOf: (
      tiles: Array<CloudHeadlineTile>,
      key: string,
    ) => CloudHeadlineTile = (
      tiles: Array<CloudHeadlineTile>,
      key: string,
    ): CloudHeadlineTile => {
      return tiles.find((tile: CloudHeadlineTile): boolean => {
        return tile.key === key;
      })!;
    };

    // CPU: worse the fuller, the default bar.
    expect(tileOf(vm, "percentage_cpu").higherIsBetter).toBeUndefined();
    expect(tileOf(vm, "percentage_cpu").thresholds).toBeUndefined();
    // Availability: best full, amber under 99.9% and red under 90%.
    expect(tileOf(vm, "vmavailabilitymetric").higherIsBetter).toBe(true);
    expect(tileOf(vm, "vmavailabilitymetric").thresholds).toEqual({
      warn: 99.9,
      danger: 90,
    });

    const balancer: Array<CloudHeadlineTile> = getCloudHeadlineTiles({
      provider: "azure",
      type: "Microsoft.Network/loadBalancers",
      readings: { vipavailability: reading(100), dipavailability: reading(50) },
      hasFreshReadings: true,
      translator: ENGLISH,
    });

    expect(tileOf(balancer, "dipavailability").higherIsBetter).toBe(true);
    expect(tileOf(balancer, "dipavailability").thresholds).toEqual({
      warn: 100,
      danger: 50,
    });

    // A share of requests that failed: amber from 5%, red from half.
    const cdn: CloudHeadlineTile = tileOf(
      getCloudHeadlineTiles({
        provider: "azure",
        type: "Microsoft.Cdn/profiles",
        readings: { percentage5xx: reading(7) },
        hasFreshReadings: true,
        translator: ENGLISH,
      }),
      "percentage5xx",
    );

    expect(cdn.higherIsBetter).toBeUndefined();
    expect(cdn.thresholds).toEqual({ warn: 5, danger: 50 });

    // A count of errors draws no bar at all.
    expect(
      tileOf(
        getCloudHeadlineTiles({
          provider: "azure",
          type: "Microsoft.Web/sites",
          readings: { http5xx: reading(3) },
          hasFreshReadings: true,
          translator: ENGLISH,
        }),
        "http5xx",
      ).thresholds,
    ).toBeUndefined();
  });

  test("two rows of tiles at most", () => {
    for (const [provider, type] of [
      ["azure", "Microsoft.Compute/virtualMachines"],
      ["aws", "AWS::RDS::DBInstance"],
      ["azure", "Microsoft.Network/applicationGateways"],
    ]) {
      expect(
        getCloudHeadlineTiles({
          provider: provider!,
          type: type!,
          readings: {},
          hasFreshReadings: true,
          translator: ENGLISH,
        }).length,
      ).toBeLessThanOrEqual(CLOUD_HEADLINE_TILES_MAX);
    }
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
    expect(formatCloudBytes(0, ENGLISH)).toBe("0\u00A0B");
    expect(formatCloudBytes(1536, ENGLISH)).toBe("1.5\u00A0KiB");
    expect(formatCloudBytes(300 * GIB, ENGLISH)).toBe("300\u00A0GiB");
    expect(formatCloudBytes(-5, ENGLISH)).toBe("0\u00A0B");
    expect(formatCloudBytes(9.6 * GIB, ENGLISH)).toBe("9.6\u00A0GiB");
    expect(formatCloudBytes(9.6 * GIB, GERMAN)).toBe("9,6\u00A0GiB");

    expect(formatCloudAmount(1240.4, ENGLISH)).toBe("1,240");
    expect(formatCloudAmount(37.54, ENGLISH)).toBe("37.5");
    expect(formatCloudAmount(0.421, ENGLISH)).toBe("0.42");

    expect(formatCloudSeconds(0.23, ENGLISH)).toBe("230\u00A0ms");
    expect(formatCloudSeconds(1.84, ENGLISH)).toBe("1.8\u00A0s");
    expect(formatCloudSeconds(600, ENGLISH)).toBe("10\u00A0min");
    expect(formatCloudSeconds(9000, ENGLISH)).toBe("2.5\u00A0h");
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
