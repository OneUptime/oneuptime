import { describe, expect, test } from "@jest/globals";
import { OPENSTACK_REGION_ATTRIBUTE } from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import {
  OpenStackApiCheckResult,
  OpenStackLifecycleRecords,
  OpenStackLifecycleStep,
} from "../../../Types/OpenStack/OpenStackCheck";
import {
  OpenStackCheckFindings,
  getOpenStackCheckFindings,
  isOpenStackCheckMonitor,
  openStackCheckFindingsToMarkdown,
} from "../../../Utils/OpenStack/OpenStackCheckFindings";
import { OpenStackCheckMetric } from "../../../Utils/OpenStack/OpenStackCheckMetrics";

/*
 * What a check's incident says it met: the step, and the fault in the service's own words, which are
 * text from outside OneUptime.
 */

const REGION: string = "RegionOne";
const LABELS: Record<string, string> = { [OPENSTACK_REGION_ATTRIBUTE]: REGION };

const FAILED: OpenStackLifecycleRecords = {
  [REGION]: {
    regionName: REGION,
    phaseVerdicts: {},
    recent: [],
    lastVerdict: {
      runId: "r",
      regionName: REGION,
      startedAt: "2026-11-05T09:50:00.000Z",
      finishedAt: "2026-11-05T09:55:00.000Z",
      status: "Failed",
      failedStep: OpenStackLifecycleStep.ServerActive,
      fault: { source: "nova", code: 500, message: "No valid host was found." },
      steps: [
        {
          step: OpenStackLifecycleStep.ServerCreate,
          status: "Passed",
          durationInMs: 1,
        },
        {
          step: OpenStackLifecycleStep.ServerActive,
          status: "Failed",
          durationInMs: 60_000,
          fault: {
            source: "nova",
            code: 500,
            message: "No valid host was found.",
          },
        },
      ],
      phases: {},
      leftoverCount: 0,
      traceId: "4e3e0ec6293840b1850409eb1d4b0dee",
      requestCount: 1,
      writeCount: 1,
      warnings: [],
    },
  },
};

const API_RESULT: OpenStackApiCheckResult = {
  startedAt: "2026-11-05T09:55:00.000Z",
  durationInMs: 1,
  regionNames: [REGION],
  token: { status: "Failed", durationInMs: 1, message: "Keystone said no." },
  services: [
    {
      regionName: REGION,
      serviceType: "compute",
      serviceName: "nova",
      read: "GET /servers?limit=1",
      outcome: "Failing",
      status: 503,
      durationInMs: 1,
      message: "It is restarting.",
    },
  ],
  certificates: [
    {
      host: "cloud.example.com",
      port: 443,
      validTo: "2026-11-12T00:00:00.000Z",
      subject: "CN=cloud.example.com",
      issuer: "CN=A CA",
      regionNames: [REGION],
      serviceTypes: ["compute"],
    },
  ],
  warnings: [],
};

function findings(data: {
  metric: OpenStackCheckMetric;
  labels?: Record<string, string> | undefined;
}): OpenStackCheckFindings | null {
  return getOpenStackCheckFindings({
    labels: data.labels || LABELS,
    metricNames: [data.metric],
    apiCheckResult: API_RESULT,
    lifecycleRecords: FAILED,
  });
}

describe("what a failed run's incident says", () => {
  test("names its step and the fault Nova gave", () => {
    const text: string = openStackCheckFindingsToMarkdown(
      findings({ metric: OpenStackCheckMetric.LifecyclePhaseSuccess })!,
    ).toString();

    expect(text).toContain("What the check met in RegionOne");
    expect(text).toContain("Wait for ACTIVE");
    expect(text).toContain("Nova said");
    expect(text).toContain("500");
    expect(text).toContain("No valid host was found.");
    expect(text).toContain("2026-11-05T09:55:00.000Z");
    expect(text).toContain("4e3e0ec6293840b1850409eb1d4b0dee");
  });

  test("a fault is text from outside: nothing in it acts", () => {
    const records: OpenStackLifecycleRecords = JSON.parse(
      JSON.stringify(FAILED),
    );

    records[REGION]!.lastVerdict!.steps[1]!.fault!.message =
      "![tracker](https://evil.example/x.png) <@channel>";

    const text: string = openStackCheckFindingsToMarkdown(
      getOpenStackCheckFindings({
        labels: LABELS,
        metricNames: [OpenStackCheckMetric.LifecyclePhaseSuccess],
        lifecycleRecords: records,
      })!,
    ).toString();

    expect(text).not.toContain("![tracker](https://evil.example/x.png)");
  });

  test("a slow boot that passed says how long it took", () => {
    const records: OpenStackLifecycleRecords = JSON.parse(
      JSON.stringify(FAILED),
    );

    records[REGION]!.lastVerdict!.status = "Succeeded";
    records[REGION]!.lastVerdict!.steps[1]!.status = "Passed";
    records[REGION]!.lastVerdict!.steps[1]!.durationInMs = 412_000;

    expect(
      getOpenStackCheckFindings({
        labels: LABELS,
        metricNames: [OpenStackCheckMetric.LifecycleStepDuration],
        lifecycleRecords: records,
      })?.lines[0]?.title,
    ).toBe("Wait for ACTIVE took 412 seconds");
  });

  test("a region with no verdict, and a series with no region, say nothing", () => {
    expect(
      findings({
        metric: OpenStackCheckMetric.LifecyclePhaseSuccess,
        labels: { [OPENSTACK_REGION_ATTRIBUTE]: "Elsewhere" },
      }),
    ).toBeNull();
    expect(
      findings({
        metric: OpenStackCheckMetric.LifecyclePhaseSuccess,
        labels: {},
      }),
    ).toBeNull();
  });
});

describe("what an API check's incident says", () => {
  test("Keystone's own words", () => {
    expect(
      findings({ metric: OpenStackCheckMetric.TokenSuccess })?.lines[0]?.fault
        ?.message,
    ).toBe("Keystone said no.");
  });

  test("the service that failed, what was asked, and what it said", () => {
    const line = findings({
      metric: OpenStackCheckMetric.ApiSuccess,
      labels: { ...LABELS, service_type: "compute" },
    })?.lines[0];

    expect(line?.title).toBe("GET /servers?limit=1 on nova");
    expect(line?.fault).toEqual({
      source: "probe",
      code: 503,
      message: "It is restarting.",
    });
  });

  test("a certificate, when it ends and who gave it", () => {
    const line = findings({
      metric: OpenStackCheckMetric.CertificateExpiry,
      labels: { ...LABELS, host: "cloud.example.com", port: "443" },
    })?.lines[0];

    expect(line?.title).toContain("cloud.example.com:443 ends on 2026-11-12");
    expect(line?.title).toContain("CN=A CA");
  });

  test("a service the check has no word on says nothing", () => {
    expect(
      findings({
        metric: OpenStackCheckMetric.ApiSuccess,
        labels: { ...LABELS, service_type: "image" },
      }),
    ).toBeNull();
  });
});

describe("which monitors are a check's", () => {
  test("by their series", () => {
    expect(
      isOpenStackCheckMonitor([OpenStackCheckMetric.LifecycleSuccess]),
    ).toBe(true);
    expect(isOpenStackCheckMonitor(["openstack_nova_up"])).toBe(false);
    expect(isOpenStackCheckMonitor([])).toBe(false);
  });
});
