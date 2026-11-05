import { describe, expect, test } from "@jest/globals";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import {
  OpenStackApiCheckResult,
  OpenStackLifecyclePhase,
  OpenStackLifecycleRecords,
  OpenStackLifecycleRun,
  OpenStackLifecycleStep,
} from "../../../Types/OpenStack/OpenStackCheck";
import { OPENSTACK_REGION_ATTRIBUTE } from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import { getOpenStackMetricByMetricName } from "../../../Types/Monitor/OpenStackMetricCatalog";
import {
  OPENSTACK_CHECK_RESOURCE_ATTRIBUTE,
  OPENSTACK_CHECK_RESOURCE_VALUE,
  OpenStackCheckMetric,
  getOpenStackApiCheckPoints,
  getOpenStackLifecycleCheckPoints,
  isOpenStackCheckResource,
  toOpenStackCheckResourceMetrics,
} from "../../../Utils/OpenStack/OpenStackCheckMetrics";

/*
 * What the checks say as series. #5750 builds SLOs and status pages on these names, so they are held
 * here word for word: a test failing below is an upgrade someone has to be told about.
 */

const NOW: number = Date.parse("2026-11-05T10:00:00.000Z");
const REGION: string = "RegionOne";
const MINUTE: number = 60_000;

function apiResult(
  overrides: Partial<OpenStackApiCheckResult> = {},
): OpenStackApiCheckResult {
  return {
    startedAt: new Date(NOW).toISOString(),
    durationInMs: 900,
    regionNames: [REGION],
    token: { status: "Passed", durationInMs: 250 },
    services: [
      {
        regionName: REGION,
        serviceType: "compute",
        serviceName: "nova",
        read: "GET /servers?limit=1",
        outcome: "Answered",
        status: 200,
        durationInMs: 120,
      },
    ],
    certificates: [
      {
        host: "cloud.example.com",
        port: 443,
        validTo: new Date(NOW + 12 * 24 * 60 * MINUTE).toISOString(),
        regionNames: [REGION],
        serviceTypes: ["compute"],
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function lifecycleRun(
  overrides: Partial<OpenStackLifecycleRun> = {},
): OpenStackLifecycleRun {
  return {
    runId: "20261105095000-abcdef",
    regionName: REGION,
    startedAt: new Date(NOW - 10 * MINUTE).toISOString(),
    finishedAt: new Date(NOW - 5 * MINUTE).toISOString(),
    status: "Succeeded",
    steps: [
      {
        step: OpenStackLifecycleStep.ServerCreate,
        status: "Passed",
        durationInMs: 1500,
      },
      {
        step: OpenStackLifecycleStep.ServerActive,
        status: "Passed",
        durationInMs: 42_000,
      },
    ],
    phases: {},
    leftoverCount: 0,
    requestCount: 20,
    writeCount: 2,
    warnings: [],
    ...overrides,
  };
}

function records(
  run: OpenStackLifecycleRun | undefined,
  extra?: Partial<OpenStackLifecycleRecords[string]>,
): OpenStackLifecycleRecords {
  return {
    [REGION]: {
      regionName: REGION,
      ...(run ? { lastVerdict: run } : {}),
      phaseVerdicts: {
        [OpenStackLifecyclePhase.Boot]: "Passed",
        [OpenStackLifecyclePhase.Volume]: "Failed",
      },
      recent: [],
      ...extra,
    },
  };
}

type Point = ReturnType<typeof getOpenStackApiCheckPoints>[number];

function valuesOf(
  points: Array<Point>,
  metric: OpenStackCheckMetric,
): Array<{ value: number; labels: Record<string, string | number> }> {
  return points
    .filter((point: Point): boolean => {
      return point.metric === metric;
    })
    .map((point: Point) => {
      return { value: point.value, labels: point.labels };
    });
}

describe("the names", () => {
  test("are these, for anyone building on them", () => {
    expect(Object.values(OpenStackCheckMetric).sort()).toEqual([
      "openstack_check_api_duration_seconds",
      "openstack_check_api_success",
      "openstack_check_certificate_expiry_days",
      "openstack_check_lifecycle_janitor_removed",
      "openstack_check_lifecycle_leftovers",
      "openstack_check_lifecycle_phase_success",
      "openstack_check_lifecycle_refused",
      "openstack_check_lifecycle_run_age_seconds",
      "openstack_check_lifecycle_run_duration_seconds",
      "openstack_check_lifecycle_step_duration_seconds",
      "openstack_check_lifecycle_step_success",
      "openstack_check_lifecycle_success",
      "openstack_check_token_duration_seconds",
      "openstack_check_token_success",
    ]);
  });

  test("each is in the catalogue, in its own category", () => {
    for (const metric of Object.values(OpenStackCheckMetric)) {
      expect(getOpenStackMetricByMetricName(metric)?.category).toBe("Checks");
    }
  });
});

describe("the API checks' series", () => {
  test("a healthy check", () => {
    const points: Array<Point> = getOpenStackApiCheckPoints({
      result: apiResult(),
      now: NOW,
    });

    const region: Record<string, string> = {
      [OPENSTACK_REGION_ATTRIBUTE]: REGION,
    };

    expect(valuesOf(points, OpenStackCheckMetric.TokenSuccess)).toEqual([
      { value: 1, labels: region },
    ]);
    expect(valuesOf(points, OpenStackCheckMetric.TokenDuration)).toEqual([
      { value: 0.25, labels: region },
    ]);
    expect(valuesOf(points, OpenStackCheckMetric.ApiSuccess)).toEqual([
      {
        value: 1,
        labels: {
          ...region,
          service_type: "compute",
          service_name: "nova",
          outcome: "Answered",
        },
      },
    ]);
    expect(valuesOf(points, OpenStackCheckMetric.ApiDuration)[0]?.value).toBe(
      0.12,
    );
    expect(valuesOf(points, OpenStackCheckMetric.CertificateExpiry)).toEqual([
      {
        value: 12,
        labels: { ...region, host: "cloud.example.com", port: 443 },
      },
    ]);
  });

  test("a token not issued reads 0 in every region, so each region's monitor hears it", () => {
    const points: Array<Point> = getOpenStackApiCheckPoints({
      result: apiResult({
        regionNames: ["one", "two"],
        token: {
          status: "Failed",
          durationInMs: 15_000,
          message: "It is down.",
        },
        services: [],
        certificates: [],
      }),
      now: NOW,
    });

    expect(
      valuesOf(points, OpenStackCheckMetric.TokenSuccess).map((one: ReturnType<typeof valuesOf>[number]) => {
        return one.value;
      }),
    ).toEqual([0, 0]);
    expect(valuesOf(points, OpenStackCheckMetric.TokenDuration)[0]?.value).toBe(
      15,
    );
  });

  test("a credential being left alone still reads as failing, with no time to measure", () => {
    const points: Array<Point> = getOpenStackApiCheckPoints({
      result: apiResult({
        token: { status: "BackingOff", durationInMs: 0 },
        services: [],
      }),
      now: NOW,
    });

    expect(valuesOf(points, OpenStackCheckMetric.TokenSuccess)[0]?.value).toBe(
      0,
    );
    expect(valuesOf(points, OpenStackCheckMetric.TokenDuration)).toEqual([]);
  });

  test.each<[string, number]>([
    ["Answered", 1],
    // It answered, and it is the credential that may not: the API is working.
    ["Refused", 1],
    ["Failing", 0],
  ])("a service that %s reads %i", (outcome: string, value: number) => {
    const points: Array<Point> = getOpenStackApiCheckPoints({
      result: apiResult({
        services: [
          {
            regionName: REGION,
            serviceType: "image",
            serviceName: "glance",
            read: "GET /images?limit=1",
            outcome: outcome as never,
            durationInMs: 1,
          },
        ],
      }),
      now: NOW,
    });

    expect(valuesOf(points, OpenStackCheckMetric.ApiSuccess)[0]?.value).toBe(
      value,
    );
  });

  test("a service that was not asked says nothing, rather than paging someone about a choice they made", () => {
    const points: Array<Point> = getOpenStackApiCheckPoints({
      result: apiResult({
        services: [
          {
            regionName: REGION,
            serviceType: "image",
            serviceName: "glance",
            read: "GET /images?limit=1",
            outcome: "NotChecked",
            durationInMs: 0,
          },
        ],
      }),
      now: NOW,
    });

    expect(valuesOf(points, OpenStackCheckMetric.ApiSuccess)).toEqual([]);
    expect(valuesOf(points, OpenStackCheckMetric.ApiDuration)).toEqual([]);
  });

  test("a certificate past its end reads negative, each region says so, and an unreadable date says nothing", () => {
    const points: Array<Point> = getOpenStackApiCheckPoints({
      result: apiResult({
        regionNames: ["one", "two"],
        certificates: [
          {
            host: "a.example.com",
            port: 443,
            validTo: new Date(NOW - 36 * 60 * MINUTE).toISOString(),
            regionNames: ["one", "two"],
            serviceTypes: [],
          },
          {
            host: "b.example.com",
            port: 443,
            validTo: "not a date",
            regionNames: ["one"],
            serviceTypes: [],
          },
        ],
      }),
      now: NOW,
    });

    expect(
      valuesOf(points, OpenStackCheckMetric.CertificateExpiry).map((one: ReturnType<typeof valuesOf>[number]) => {
        return [one.labels[OPENSTACK_REGION_ATTRIBUTE], one.value];
      }),
    ).toEqual([
      ["one", -1.5],
      ["two", -1.5],
    ]);
  });
});

describe("the lifecycle check's series: what the last run found, said again each minute", () => {
  function pointsOf(
    recordsOfRegions: OpenStackLifecycleRecords,
    now: number = NOW,
  ): Array<Point> {
    return getOpenStackLifecycleCheckPoints({
      records: recordsOfRegions,
      intervalInMinutes: 30,
      now: now,
    });
  }

  test("a run that passed", () => {
    const points: Array<Point> = pointsOf(records(lifecycleRun()));
    const region: Record<string, string> = {
      [OPENSTACK_REGION_ATTRIBUTE]: REGION,
    };

    expect(valuesOf(points, OpenStackCheckMetric.LifecycleSuccess)).toEqual([
      { value: 1, labels: region },
    ]);
    expect(valuesOf(points, OpenStackCheckMetric.LifecycleRefused)).toEqual([
      { value: 0, labels: region },
    ]);
    expect(
      valuesOf(points, OpenStackCheckMetric.LifecycleStepDuration),
    ).toEqual([
      { value: 1.5, labels: { ...region, step: "server_create" } },
      { value: 42, labels: { ...region, step: "server_active" } },
    ]);
    expect(
      valuesOf(points, OpenStackCheckMetric.LifecycleRunDuration)[0]?.value,
    ).toBe(300);
    expect(
      valuesOf(points, OpenStackCheckMetric.LifecycleRunAge)[0]?.value,
    ).toBe(300);
  });

  test("each phase reads what it last came to", () => {
    expect(
      valuesOf(
        pointsOf(records(lifecycleRun())),
        OpenStackCheckMetric.LifecyclePhaseSuccess,
      ).map((one: ReturnType<typeof valuesOf>[number]) => {
        return [one.labels["phase"], one.value];
      }),
    ).toEqual([
      ["boot", 1],
      ["volume", 0],
    ]);
  });

  test("a step that failed has a verdict and no duration: how long it took to fail says nothing of how slow it is", () => {
    const points: Array<Point> = pointsOf(
      records(
        lifecycleRun({
          status: "Failed",
          failedStep: OpenStackLifecycleStep.ServerActive,
          steps: [
            {
              step: OpenStackLifecycleStep.ServerActive,
              status: "Failed",
              durationInMs: 600_000,
            },
          ],
        }),
      ),
    );

    expect(
      valuesOf(points, OpenStackCheckMetric.LifecycleSuccess)[0]?.value,
    ).toBe(0);
    expect(
      valuesOf(points, OpenStackCheckMetric.LifecycleStepSuccess)[0]?.value,
    ).toBe(0);
    expect(
      valuesOf(points, OpenStackCheckMetric.LifecycleStepDuration),
    ).toEqual([]);
  });

  test("a verdict is said until two and a half intervals after it, and then silence, which is not recovery", () => {
    const run: OpenStackLifecycleRun = lifecycleRun({
      finishedAt: new Date(NOW).toISOString(),
    });

    const at: (minutes: number) => Array<Point> = (minutes: number) => {
      return pointsOf(records(run), NOW + minutes * MINUTE);
    };

    expect(
      valuesOf(at(75), OpenStackCheckMetric.LifecycleSuccess),
    ).toHaveLength(1);
    expect(valuesOf(at(76), OpenStackCheckMetric.LifecycleSuccess)).toEqual([]);
    expect(
      valuesOf(at(76), OpenStackCheckMetric.LifecyclePhaseSuccess),
    ).toEqual([]);
  });

  test("a credential it refuses says so, and no run's verdict is said as if it still stood", () => {
    const points: Array<Point> = pointsOf(
      records(lifecycleRun(), {
        lastAttempt: lifecycleRun({ status: "Refused", message: "No." }),
      }),
    );

    expect(
      valuesOf(points, OpenStackCheckMetric.LifecycleRefused)[0]?.value,
    ).toBe(1);
    expect(valuesOf(points, OpenStackCheckMetric.LifecycleSuccess)).toEqual([]);
  });

  test("a skipped attempt says nothing about the cloud, and the last verdict stands", () => {
    const points: Array<Point> = pointsOf(
      records(lifecycleRun(), {
        lastAttempt: lifecycleRun({ status: "Skipped", message: "Later." }),
      }),
    );

    expect(
      valuesOf(points, OpenStackCheckMetric.LifecycleRefused)[0]?.value,
    ).toBe(0);
    expect(
      valuesOf(points, OpenStackCheckMetric.LifecycleSuccess)[0]?.value,
    ).toBe(1);
  });

  test("no verdict yet, and a run that could not name a region, say nothing", () => {
    expect(
      valuesOf(
        pointsOf(records(undefined)),
        OpenStackCheckMetric.LifecycleSuccess,
      ),
    ).toEqual([]);

    expect(
      pointsOf({
        "": {
          regionName: "",
          lastVerdict: lifecycleRun({ regionName: "" }),
          phaseVerdicts: {},
          recent: [],
        },
      }),
    ).toEqual([]);
  });

  test("what the last run left and what the janitor took", () => {
    const points: Array<Point> = pointsOf(
      records(
        lifecycleRun({
          leftoverCount: 2,
          janitor: {
            removed: [
              { kind: "server", id: "1", name: "x", ageInMinutes: 61 },
              { kind: "volume", id: "2", name: "y", ageInMinutes: 61 },
              { kind: "floating_ip", id: "3", name: "z", ageInMinutes: 61 },
            ],
            remainingCount: 0,
            errors: [],
          },
        }),
      ),
    );

    expect(
      valuesOf(points, OpenStackCheckMetric.LifecycleLeftovers)[0]?.value,
    ).toBe(2);
    expect(
      valuesOf(points, OpenStackCheckMetric.LifecycleJanitorRemoved)[0]?.value,
    ).toBe(3);
  });
});

describe("as OTLP", () => {
  const resourceMetrics: JSONArray = toOpenStackCheckResourceMetrics({
    points: getOpenStackApiCheckPoints({ result: apiResult(), now: NOW }),
    now: NOW,
    scopeVersion: "1.2.3",
  });

  test("one resource, marked as a check's, so it does not read as whatever collects the cloud reporting", () => {
    expect(resourceMetrics).toHaveLength(1);

    const resource: JSONObject = (resourceMetrics[0] as JSONObject)[
      "resource"
    ] as JSONObject;

    expect(resource["attributes"]).toEqual([
      {
        key: OPENSTACK_CHECK_RESOURCE_ATTRIBUTE,
        value: { stringValue: OPENSTACK_CHECK_RESOURCE_VALUE },
      },
    ]);
    expect(isOpenStackCheckResource(resource["attributes"])).toBe(true);
    expect(
      isOpenStackCheckResource([
        { key: "openstack.cloud.name", value: { stringValue: "Lab" } },
      ]),
    ).toBe(false);
    expect(isOpenStackCheckResource(undefined)).toBe(false);
    expect(isOpenStackCheckResource([null, "x", {}])).toBe(false);
  });

  test("gauges, with every label a string and the time in nanoseconds", () => {
    const scope: JSONObject = (
      (resourceMetrics[0] as JSONObject)["scopeMetrics"] as JSONArray
    )[0] as JSONObject;
    const metrics: JSONArray = scope["metrics"] as JSONArray;

    const certificate: JSONObject = metrics.find((metric: unknown): boolean => {
      return (
        (metric as JSONObject)["name"] ===
        OpenStackCheckMetric.CertificateExpiry
      );
    }) as JSONObject;

    const point: JSONObject = (
      (certificate["gauge"] as JSONObject)["dataPoints"] as JSONArray
    )[0] as JSONObject;

    expect(point["asDouble"]).toBe(12);
    expect(point["timeUnixNano"]).toBe(`${NOW}000000`);
    expect(point["attributes"]).toContainEqual({
      key: "port",
      value: { stringValue: "443" },
    });
  });

  test("nothing to say is no resource", () => {
    expect(
      toOpenStackCheckResourceMetrics({
        points: [],
        now: NOW,
        scopeVersion: "1",
      }),
    ).toEqual([]);
  });
});
