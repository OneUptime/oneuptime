import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import OpenStackProbeMetrics from "Common/Server/Utils/OpenStack/OpenStackProbeMetrics";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "Common/Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { OPENSTACK_CLOUDKITTY_MOST_PAGES } from "Common/Types/OpenStack/OpenStackCloudKitty";
import { readOpenStackPriceList } from "Common/Types/OpenStack/OpenStackPriceList";
import { OpenStackCollectionReport } from "Common/Types/OpenStack/OpenStackProbeCollection";
import { getEmptyOpenStackUsageQuantities } from "Common/Types/OpenStack/OpenStackProjectUsage";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackCostSource,
  OpenStackProjectCost,
  getOpenStackProjectCost,
  readOpenStackRatedByPeriod,
} from "Common/Types/OpenStack/OpenStackSpendSnapshot";
import { judgeOpenStackApiAnswer } from "../../../Utils/OpenStack/Checks/OpenStackApiCheck";
import OpenStackCollector from "../../../Utils/OpenStack/OpenStackCollector";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
} from "../../../Utils/OpenStack/OpenStackHttp";
import {
  COLLECTED_AT_MS,
  CollectorHarness,
  ReportedDatapoint,
  collectionJob,
  createCollectorHarness,
  datapointsOf,
} from "./Helpers/CollectorHarness";
import {
  FIXTURES_ROOT,
  RECORDED_AUTH_URL,
  RECORDED_HOST,
} from "./Helpers/RecordedCloud";

/*
 * MOSTLY HAND-CHECKED AGAINST CLOUDKITTY'S API REFERENCE.
 *
 * Paging, regions and bad answers can't be had from one small cloud, so those answers are written to
 * what its docs say its v2 summary and v1 report answer. The collector and the scan are the real ones,
 * and the requests are counted exactly, because that doesn't depend on the machine. What a real
 * CloudKitty answered is replayed at the end of this file.
 */

const RATING_URL: string = `${RECORDED_HOST}/rating`;
const THIS_MONTH: string = "2026-11";
const LAST_MONTH: string = "2026-10";

interface Answer {
  status: number;
  body?: unknown;
  // What a real one said, as it said it.
  raw?: string;
}

function catalogEntry(type: string, url: string): JSONObject {
  return {
    id: type,
    name: type,
    type,
    endpoints: [
      {
        id: type,
        interface: "public",
        region: "RegionOne",
        region_id: "RegionOne",
        url,
      },
    ],
  };
}

const KEYSTONE: JSONObject = catalogEntry("identity", RECORDED_AUTH_URL);

function ratingInRegions(regions: Array<[string, string]>): JSONObject {
  return {
    id: "rating",
    name: "rating",
    type: "rating",
    endpoints: regions.map(([region, url]: [string, string], index: number) => {
      return {
        id: `rating-${index}`,
        interface: "public",
        region,
        region_id: region,
        url,
      };
    }),
  };
}

function tokenBody(catalog: Array<JSONObject>): JSONObject {
  return {
    token: {
      methods: ["application_credential"],
      expires_at: "2026-11-05T12:48:28.000000Z",
      issued_at: "2026-11-05T01:48:28.000000Z",
      project: {
        id: "own-project",
        name: "admin",
        domain: { id: "default", name: "Default" },
      },
      roles: [{ id: "role-admin", name: "admin" }],
      user: { id: "monitoring-user", name: "oneuptime-monitoring" },
      catalog,
    },
  };
}

function summaryOf(rows: Array<[string, number]>, total?: number): Answer {
  return {
    status: 200,
    body: {
      total: total ?? rows.length,
      columns: ["begin", "end", "qty", "rate", "project_id"],
      results: rows.map(([project, rate]: [string, number]) => {
        return [
          "2026-11-01T00:00:00+00:00",
          "2026-12-01T00:00:00+00:00",
          1,
          rate,
          project,
        ];
      }),
    },
  };
}

function cloudOf(data: {
  catalog?: Array<JSONObject> | undefined;
  answer: (url: URL) => Answer | undefined;
}): {
  transport: (request: OpenStackHttpRequest) => Promise<OpenStackHttpResponse>;
  ratingRequests: Array<string>;
} {
  const ratingRequests: Array<string> = [];

  return {
    ratingRequests,
    transport: async (
      request: OpenStackHttpRequest,
    ): Promise<OpenStackHttpResponse> => {
      const url: URL = new URL(request.url);

      if (url.pathname.endsWith("/auth/tokens")) {
        return {
          status: 201,
          headers: { "x-subject-token": "a-token" },
          body: JSON.stringify(
            tokenBody(
              data.catalog || [KEYSTONE, catalogEntry("rating", RATING_URL)],
            ),
          ),
        };
      }

      if (url.pathname.includes("/identity/v3/")) {
        const key: string = url.pathname.substring(
          url.pathname.lastIndexOf("/") + 1,
        );
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({ [key]: [] }),
        };
      }

      if (url.pathname.startsWith("/rating")) {
        ratingRequests.push(`${url.pathname}${url.search}`);
      }

      const answered: Answer | undefined = data.answer(url);

      return {
        status: answered?.status ?? 404,
        headers: { date: "Wed, 04 Nov 2026 11:50:00 GMT" },
        body:
          answered?.raw ??
          JSON.stringify(answered?.body ?? { message: "Not found." }),
      };
    },
  };
}

// A CloudKitty that has a version and a v2 summary, of these rows for every period.
function ratingAnswer(
  rowsFor: (month: string, offset: number) => Answer,
): (url: URL) => Answer | undefined {
  return (url: URL): Answer | undefined => {
    if (url.pathname === "/rating/") {
      return { status: 200, body: { versions: [{ id: "v2" }] } };
    }
    if (url.pathname === "/rating/v2/summary") {
      return rowsFor(
        (url.searchParams.get("begin") || "").slice(0, 7),
        Number(url.searchParams.get("offset") || 0),
      );
    }
    return undefined;
  };
}

async function collect(data: {
  cloud: ReturnType<typeof cloudOf>;
  harness?: CollectorHarness | undefined;
  regions?: Array<string> | undefined;
}): Promise<{
  report: OpenStackCollectionReport;
  points: Array<ReportedDatapoint>;
  harness: CollectorHarness;
}> {
  const harness: CollectorHarness =
    data.harness ||
    createCollectorHarness({ transport: data.cloud.transport as never });
  const report: OpenStackCollectionReport = await OpenStackCollector.collect(
    collectionJob({
      authUrl: RECORDED_AUTH_URL,
      ...(data.regions ? { regions: data.regions } : {}),
    }),
    harness.dependencies,
  );

  return { report, points: datapointsOf(report.resourceMetrics), harness };
}

function named(
  points: Array<ReportedDatapoint>,
  name: string,
): Array<ReportedDatapoint> {
  return points.filter((point: ReportedDatapoint): boolean => {
    return point.metric === name;
  });
}

function rowsOf(
  report: OpenStackCollectionReport,
): Array<OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
  const prepared: JSONArray = OpenStackProbeMetrics.prepare({
    resourceMetrics: report.resourceMetrics,
    cloudName: "devstack",
  }).resourceMetrics;

  for (const resource of prepared as Array<JSONObject>) {
    for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of scope["metrics"] as Array<JSONObject>) {
        const metricName: string = metric["name"] as string;
        const body: JSONObject = metric["gauge"] as JSONObject;

        for (const datapoint of body["dataPoints"] as Array<JSONObject>) {
          if (isOpenStackSnapshotDatapoint({ metricName, datapoint })) {
            bufferOpenStackSnapshotMetric({ metricName, datapoint, buffer });
          }
        }
      }
    }
  }

  return finishOpenStackBatch(buffer.values());
}

describe("a cloud with no CloudKitty", () => {
  test("shows no trace of it: no read, no series", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      catalog: [KEYSTONE],
      answer: () => {
        return undefined;
      },
    });
    const { points, report } = await collect({ cloud });

    expect(cloud.ratingRequests).toEqual([]);
    expect(named(points, "openstack_cloudkitty_up")).toEqual([]);
    expect(named(points, "openstack_cloudkitty_rated")).toEqual([]);
    expect(JSON.stringify(report.summary)).not.toContain("cloudkitty");
  });
});

describe("a cloud that runs it", () => {
  test("asks this month and last, once, and each project's figure reaches its row", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: ratingAnswer((month: string): Answer => {
        return month === THIS_MONTH
          ? summaryOf([
              ["payments", 12.5],
              ["research", 3],
            ])
          : summaryOf([["payments", 40]]);
      }),
    });
    const { points, report } = await collect({ cloud });

    expect(cloud.ratingRequests.length).toBe(3);
    expect(cloud.ratingRequests[0]).toBe("/rating/");
    expect(cloud.ratingRequests[1]).toContain("/rating/v2/summary?");
    expect(cloud.ratingRequests[1]).toContain("groupby=project_id");
    expect(cloud.ratingRequests[1]).toContain("begin=2026-11-01T00%3A00%3A00");
    expect(cloud.ratingRequests[1]).toContain("end=2026-12-01T00%3A00%3A00");
    expect(cloud.ratingRequests[2]).toContain("begin=2026-10-01T00%3A00%3A00");

    expect(named(points, "openstack_cloudkitty_up")[0]?.value).toBe(1);
    expect(
      named(points, "openstack_cloudkitty_rated")
        .map((point: ReportedDatapoint) => {
          return [
            point.labels["project_id"],
            point.labels["period"],
            point.value,
          ];
        })
        .sort(),
    ).toEqual([
      ["payments", LAST_MONTH, 40],
      ["payments", THIS_MONTH, 12.5],
      ["research", THIS_MONTH, 3],
    ]);

    const rows: Array<OpenStackResourceBufferEntry> = rowsOf(report);
    const payments: OpenStackResourceBufferEntry = rows.find(
      (row: OpenStackResourceBufferEntry): boolean => {
        return (
          row.kind === OpenStackResourceKind.Project &&
          row.externalId === "payments"
        );
      },
    )!;

    expect(payments.facts["rated:RegionOne"]).toEqual({
      [THIS_MONTH]: {
        total: 12.5,
        readAt: new Date(COLLECTED_AT_MS).toISOString(),
      },
      [LAST_MONTH]: {
        total: 40,
        readAt: new Date(COLLECTED_AT_MS).toISOString(),
      },
    });
  });

  test("once an hour, and in between only its version says it's there", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: ratingAnswer((): Answer => {
        return summaryOf([["payments", 1]]);
      }),
    });
    const first: Awaited<ReturnType<typeof collect>> = await collect({ cloud });

    expect(cloud.ratingRequests.length).toBe(3);

    first.harness.clock.advance(10 * 60_000);
    const second: Awaited<ReturnType<typeof collect>> = await collect({
      cloud,
      harness: first.harness,
    });

    // One version, and no summary.
    expect(cloud.ratingRequests.length).toBe(4);
    expect(named(second.points, "openstack_cloudkitty_up")[0]?.value).toBe(1);
    expect(named(second.points, "openstack_cloudkitty_rated")).toEqual([]);

    first.harness.clock.advance(61 * 60_000);
    await collect({ cloud, harness: first.harness });

    // A version, and both months again.
    expect(cloud.ratingRequests.length).toBe(7);
  });

  test("its API is read as often as the agent reads a service a cloud may not run: five minutes", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: ratingAnswer((): Answer => {
        return summaryOf([["payments", 1]]);
      }),
    });
    const first: Awaited<ReturnType<typeof collect>> = await collect({ cloud });

    expect(cloud.ratingRequests.length).toBe(3);

    first.harness.clock.advance(60_000);
    const soon: Awaited<ReturnType<typeof collect>> = await collect({
      cloud,
      harness: first.harness,
    });

    expect(cloud.ratingRequests.length).toBe(3);
    expect(named(soon.points, "openstack_cloudkitty_up")).toEqual([]);

    first.harness.clock.advance(4 * 60_000);
    const due: Awaited<ReturnType<typeof collect>> = await collect({
      cloud,
      harness: first.harness,
    });

    // So fifteen minutes holds three, which is what Rating API Down reads.
    expect(cloud.ratingRequests.length).toBe(4);
    expect(named(due.points, "openstack_cloudkitty_up")[0]?.value).toBe(1);
  });

  test("a CloudKitty per region: each is read, and what they rated adds up", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      catalog: [
        KEYSTONE,
        ratingInRegions([
          ["RegionOne", `${RATING_URL}/one`],
          ["RegionTwo", `${RATING_URL}/two`],
        ]),
      ],
      answer: (url: URL): Answer | undefined => {
        if (url.pathname.endsWith("/v2/summary")) {
          const isOne: boolean = url.pathname.startsWith("/rating/one");
          return (url.searchParams.get("begin") || "").startsWith(THIS_MONTH)
            ? summaryOf([["payments", isOne ? 2.5 : 1]])
            : summaryOf([]);
        }
        return { status: 200, body: { versions: [{ id: "v2" }] } };
      },
    });
    const { report } = await collect({
      cloud,
      regions: ["RegionOne", "RegionTwo"],
    });

    // A version and two months, from each.
    expect(cloud.ratingRequests.length).toBe(6);

    const payments: OpenStackResourceBufferEntry = rowsOf(report).find(
      (row: OpenStackResourceBufferEntry): boolean => {
        return (
          row.kind === OpenStackResourceKind.Project &&
          row.externalId === "payments"
        );
      },
    )!;

    expect(readOpenStackRatedByPeriod(payments.facts)[THIS_MONTH]?.total).toBe(
      3.5,
    );
  });

  test("one CloudKitty the catalog lists for two regions is asked once, or it would count twice", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      catalog: [
        KEYSTONE,
        ratingInRegions([
          ["RegionOne", RATING_URL],
          ["RegionTwo", RATING_URL],
        ]),
      ],
      answer: ratingAnswer((month: string): Answer => {
        return month === THIS_MONTH
          ? summaryOf([["payments", 2.5]])
          : summaryOf([]);
      }),
    });
    const { report } = await collect({
      cloud,
      regions: ["RegionOne", "RegionTwo"],
    });

    // Its version from each, and two months from one of them.
    expect(cloud.ratingRequests.length).toBe(4);

    const payments: OpenStackResourceBufferEntry = rowsOf(report).find(
      (row: OpenStackResourceBufferEntry): boolean => {
        return (
          row.kind === OpenStackResourceKind.Project &&
          row.externalId === "payments"
        );
      },
    )!;

    expect(readOpenStackRatedByPeriod(payments.facts)[THIS_MONTH]?.total).toBe(
      2.5,
    );
  });

  test("a page at a time: as many as it says there are, with exact requests", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: ratingAnswer((month: string, offset: number): Answer => {
        if (month !== THIS_MONTH) {
          return summaryOf([]);
        }
        const rows: Array<[string, number]> = [];
        for (let index: number = 0; index < 1000; index++) {
          rows.push([`project-${offset + index}`, 1]);
        }
        return summaryOf(rows, 2500);
      }),
    });

    await collect({ cloud });

    // A version, three pages of this month (2,500 rows), one of last.
    expect(cloud.ratingRequests.length).toBe(5);
    expect(cloud.ratingRequests[1]).toContain("offset=0");
    expect(cloud.ratingRequests[2]).toContain("offset=1000");
    expect(cloud.ratingRequests[3]).toContain("offset=2000");
  });

  test("however many it says there are, it reads no more than its most pages", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: ratingAnswer((): Answer => {
        return summaryOf([["p", 1]], 100000000);
      }),
    });

    await collect({ cloud });

    expect(cloud.ratingRequests.length).toBe(
      1 + 2 * OPENSTACK_CLOUDKITTY_MOST_PAGES,
    );
  });

  test("a CloudKitty too old for v2 is read through v1", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: (url: URL): Answer | undefined => {
        if (url.pathname === "/rating/") {
          return { status: 200, body: { versions: [{ id: "v1" }] } };
        }
        if (url.pathname === "/rating/v1/report/summary") {
          return {
            status: 200,
            body: {
              summary: [
                {
                  tenant_id: "payments",
                  res_type: "ALL",
                  rate: "7.5",
                  begin: "2026-11-01T00:00:00",
                  end: "2026-12-01T00:00:00",
                },
              ],
            },
          };
        }
        return undefined;
      },
    });
    const { points } = await collect({ cloud });

    // A version, then v2 refused and v1 answered for each of two months.
    expect(cloud.ratingRequests.length).toBe(5);
    expect(cloud.ratingRequests[2]).toContain("all_tenants=true");
    expect(named(points, "openstack_cloudkitty_rated").length).toBe(2);
    expect(named(points, "openstack_cloudkitty_rated")[0]?.value).toBe(7.5);
  });

  test("a credential it refuses is no news: its API still reads up, with no warning and no figures", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: (url: URL): Answer | undefined => {
        if (url.pathname === "/rating/") {
          return { status: 200, body: { versions: [{ id: "v2" }] } };
        }
        return { status: 403, body: { message: "Forbidden" } };
      },
    });
    const { points, report } = await collect({ cloud });

    // A version, and v2 and v1 each refused once. There's no sense asking of the other month.
    expect(cloud.ratingRequests.length).toBe(3);
    expect(named(points, "openstack_cloudkitty_up")[0]?.value).toBe(1);
    expect(named(points, "openstack_cloudkitty_rated")).toEqual([]);
    expect(
      JSON.stringify(report.summary?.warnings || []).toLowerCase(),
    ).not.toContain("rating");
    expect(
      JSON.stringify(report.summary?.warnings || []).toLowerCase(),
    ).not.toContain("cloudkitty");
  });

  test("CloudKitty down takes nothing from anything else, and its API reads down", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: (): Answer | undefined => {
        return { status: 503, body: { message: "Service Unavailable" } };
      },
    });
    const { points } = await collect({ cloud });

    expect(named(points, "openstack_cloudkitty_up")[0]?.value).toBe(0);
    expect(named(points, "openstack_identity_up")[0]?.value).toBe(1);
    expect(named(points, "openstack_cloudkitty_rated")).toEqual([]);
  });

  test("a rate of nothing, a total of everything and a row it can't read aren't figures", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: ratingAnswer((month: string): Answer => {
        return month === THIS_MONTH
          ? {
              status: 200,
              body: {
                total: 4,
                columns: ["rate", "project_id"],
                results: [
                  [0, "no-rule"],
                  [1, "ALL"],
                  ["x", "bad"],
                  [2, "kept"],
                ],
              },
            }
          : summaryOf([]);
      }),
    });
    const { points } = await collect({ cloud });

    expect(
      named(points, "openstack_cloudkitty_rated").map(
        (point: ReportedDatapoint) => {
          return point.labels["project_id"];
        },
      ),
    ).toEqual(["kept"]);
  });

  test("an answer that isn't JSON at all doesn't throw, and reads as nothing rated", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: ratingAnswer((): Answer => {
        return { status: 200, body: "<html>" };
      }),
    });
    const { points } = await collect({ cloud });

    expect(named(points, "openstack_cloudkitty_rated")).toEqual([]);
  });
});

/*
 * WHAT A REAL CLOUDKITTY ANSWERED, as it answered it: Fixtures/OpenStack/services-cloudkitty, rig run
 * 42010321592. CloudKitty on stable/2026.1 with InfluxDB behind it, rating what Ceilometer wrote to
 * Gnocchi every five minutes, with an instance in each of two projects. Each scene's how.txt says how
 * it got there. In `rated`, each project had three periods rated, the last of them at the rule's 0.5.
 */
const REAL_CLOUDKITTY: string = path.join(FIXTURES_ROOT, "services-cloudkitty");
const OU_PAYMENTS: string = "8c3413dee28c4da890948b17f234333d";
const OU_RESEARCH: string = "a1006e2604d14ae08e92e21bb431d5e7";

function recorded(scene: string, call: string): Answer {
  const folder: string = path.join(REAL_CLOUDKITTY, scene);
  const status: string | undefined = fs
    .readFileSync(path.join(folder, "api-status.txt"), "utf8")
    .split("\n")
    .find((line: string): boolean => {
      return line.split(" ")[1] === call;
    })
    ?.split(" ")[0];

  return {
    status: Number(status),
    raw: fs.readFileSync(path.join(folder, "api", `${call}.json`), "utf8"),
  };
}

// Each route as this scene recorded it. A project's member was recorded for this month.
function aRealOne(
  scene: string,
  data: { withoutV2?: boolean; asOuPayments?: boolean } = {},
): (url: URL) => Answer | undefined {
  return (url: URL): Answer | undefined => {
    const isThisMonth: boolean = (
      url.searchParams.get("begin") || ""
    ).startsWith(THIS_MONTH);
    const month: string = isThisMonth ? "this-month" : "last-month";
    const asked: string = `${month}${data.asOuPayments && isThisMonth ? "-ou-payments" : ""}`;

    switch (url.pathname) {
      case "/rating/":
        return recorded(scene, "cloudkitty-versions");
      case "/rating/v2/summary":
        return data.withoutV2
          ? undefined
          : recorded(scene, `cloudkitty-summary-${asked}`);
      case "/rating/v1/report/summary":
        return recorded(scene, `cloudkitty-report-${asked}`);
      default:
        return undefined;
    }
  };
}

function figuresOf(
  points: Array<ReportedDatapoint>,
): Array<[string | undefined, string | undefined, number]> {
  return named(points, "openstack_cloudkitty_rated")
    .map(
      (
        point: ReportedDatapoint,
      ): [string | undefined, string | undefined, number] => {
        return [
          point.labels["project_id"],
          point.labels["period"],
          point.value,
        ];
      },
    )
    .sort();
}

function warningsOf(report: OpenStackCollectionReport): string {
  return JSON.stringify(report.summary?.warnings || []).toLowerCase();
}

describe("what a real CloudKitty answered", () => {
  test("rated: it was asked what the recording asked, and each project's figure reaches its row", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: aRealOne("rated"),
    });
    const { points, report } = await collect({ cloud });

    expect(cloud.ratingRequests).toEqual([
      "/rating/",
      "/rating/v2/summary?begin=2026-11-01T00%3A00%3A00&end=2026-12-01T00%3A00%3A00&groupby=project_id&limit=1000&offset=0",
      "/rating/v2/summary?begin=2026-10-01T00%3A00%3A00&end=2026-11-01T00%3A00%3A00&groupby=project_id&limit=1000&offset=0",
    ]);
    expect(named(points, "openstack_cloudkitty_up")[0]?.value).toBe(1);
    expect(figuresOf(points)).toEqual([
      [OU_PAYMENTS, THIS_MONTH, 0.5],
      [OU_RESEARCH, THIS_MONTH, 0.5],
    ]);

    const payments: OpenStackResourceBufferEntry = rowsOf(report).find(
      (row: OpenStackResourceBufferEntry): boolean => {
        return (
          row.kind === OpenStackResourceKind.Project &&
          row.externalId === OU_PAYMENTS
        );
      },
    )!;

    expect(payments.facts["rated:RegionOne"]).toEqual({
      [THIS_MONTH]: {
        total: 0.5,
        readAt: new Date(COLLECTED_AT_MS).toISOString(),
      },
    });
  });

  test("rated: its figure is preferred to the prices, and with no rule yet the prices stand", async () => {
    const priceList: ReturnType<typeof readOpenStackPriceList> =
      readOpenStackPriceList({ vcpuHour: 1 });
    const costIn: (scene: string) => Promise<OpenStackProjectCost> = async (
      scene: string,
    ): Promise<OpenStackProjectCost> => {
      const { report } = await collect({
        cloud: cloudOf({ answer: aRealOne(scene) }),
      });
      const row: OpenStackResourceBufferEntry | undefined = rowsOf(report).find(
        (entry: OpenStackResourceBufferEntry): boolean => {
          return (
            entry.kind === OpenStackResourceKind.Project &&
            entry.externalId === OU_PAYMENTS
          );
        },
      );

      return getOpenStackProjectCost({
        quantities: getEmptyOpenStackUsageQuantities(),
        priceList,
        rated: readOpenStackRatedByPeriod(row?.facts)[THIS_MONTH],
      });
    };

    expect(await costIn("rated")).toEqual({
      amount: 0.5,
      source: OpenStackCostSource.CloudKitty,
      unpricedLineCount: 0,
    });
    expect((await costIn("no-rule-yet")).source).toBe(
      OpenStackCostSource.PriceList,
    );
  });

  test("no rule yet: it rated each project 0.0, and that isn't a figure", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: aRealOne("no-rule-yet"),
    });
    const { points, report } = await collect({ cloud });

    expect(cloud.ratingRequests.length).toBe(3);
    expect(named(points, "openstack_cloudkitty_up")[0]?.value).toBe(1);
    expect(figuresOf(points)).toEqual([]);
    expect(warningsOf(report)).not.toContain("cloudkitty");
    expect(warningsOf(report)).not.toContain("rating");
  });

  test("no rating data: no rows and no columns is a 200 that needs no second page and no v1", async () => {
    const answer: Answer = recorded(
      "no-rating-data",
      "cloudkitty-summary-this-month",
    );

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.raw as string)).toEqual({
      total: 0,
      columns: [],
      results: [],
      format: "table",
    });

    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: aRealOne("no-rating-data"),
    });
    const { points, report } = await collect({ cloud });

    expect(cloud.ratingRequests.length).toBe(3);
    expect(named(points, "openstack_cloudkitty_up")[0]?.value).toBe(1);
    expect(figuresOf(points)).toEqual([]);
    expect(warningsOf(report)).not.toContain("cloudkitty");
    expect(warningsOf(report)).not.toContain("rating");
  });

  test("a project's member reads its own project and no other", async () => {
    const { points } = await collect({
      cloud: cloudOf({ answer: aRealOne("rated", { asOuPayments: true }) }),
    });

    expect(figuresOf(points)).toEqual([[OU_PAYMENTS, THIS_MONTH, 0.5]]);
  });

  test("v1's report reads the same figures, in text, with ALL as the kind and not the project", async () => {
    const cloud: ReturnType<typeof cloudOf> = cloudOf({
      answer: aRealOne("rated", { withoutV2: true }),
    });
    const { points } = await collect({ cloud });

    expect(cloud.ratingRequests).toContain(
      "/rating/v1/report/summary?begin=2026-11-01T00%3A00%3A00&end=2026-12-01T00%3A00%3A00&groupby=tenant_id&all_tenants=true",
    );
    expect(figuresOf(points)).toEqual([
      [OU_PAYMENTS, THIS_MONTH, 0.5],
      [OU_RESEARCH, THIS_MONTH, 0.5],
    ]);

    for (const scene of ["no-rule-yet", "no-rating-data"]) {
      const empty: Awaited<ReturnType<typeof collect>> = await collect({
        cloud: cloudOf({ answer: aRealOne(scene, { withoutV2: true }) }),
      });

      expect(figuresOf(empty.points)).toEqual([]);
    }
  });

  test("v1's report refuses a project's member across projects: no news, and its API reads up", async () => {
    expect(
      recorded("rated", "cloudkitty-report-this-month-ou-payments").status,
    ).toBe(403);

    const { points, report } = await collect({
      cloud: cloudOf({
        answer: aRealOne("rated", { withoutV2: true, asOuPayments: true }),
      }),
    });

    expect(named(points, "openstack_cloudkitty_up")[0]?.value).toBe(1);
    expect(figuresOf(points)).toEqual([]);
    expect(warningsOf(report)).not.toContain("cloudkitty");
    expect(warningsOf(report)).not.toContain("rating");
  });

  test("its API stopped: Apache's 503 reads down and takes nothing from anything else", async () => {
    const { points } = await collect({
      cloud: cloudOf({ answer: aRealOne("api-down") }),
    });

    expect(named(points, "openstack_cloudkitty_up")[0]?.value).toBe(0);
    expect(named(points, "openstack_identity_up")[0]?.value).toBe(1);
    expect(figuresOf(points)).toEqual([]);
  });

  test("the API check's read answered while it ran, and failed once its API stopped", () => {
    const judged: (scene: string) => string = (scene: string): string => {
      return judgeOpenStackApiAnswer({
        status: recorded(scene, "cloudkitty-info-metrics").status,
        isKnownRead: true,
        hasAccessRules: true,
      });
    };

    expect(judged("no-rating-data")).toBe("Answered");
    expect(judged("rated")).toBe("Answered");
    expect(judged("api-down")).toBe("Failing");
  });
});
