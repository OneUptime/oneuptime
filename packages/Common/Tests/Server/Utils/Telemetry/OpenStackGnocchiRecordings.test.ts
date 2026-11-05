import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import { OpenStackResourceBufferEntry } from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONObject } from "../../../../Types/JSON";
import {
  OPENSTACK_GNOCCHI_BACKLOG_WARNING_MEASURES,
  OPENSTACK_GNOCCHI_MEASURES_FACT,
  OPENSTACK_GNOCCHI_METRICS_FACT,
  OPENSTACK_GNOCCHI_PROCESSORS_FACT,
} from "../../../../Types/OpenStack/OpenStackHealthRules";
import { isOpenStackApiClosedToThisCredential } from "../../../../Types/OpenStack/OpenStackOptionalServices";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  RECORDED_AT,
  RecordedServiceScene,
  factsOfRow,
  scanRecordedOtlp,
} from "../../../Helpers/OpenStackServiceRecording";
import {
  OpenStackTemplateReading,
  isAnythingFiring,
  readOpenStackTemplateOnRecording,
} from "../../../Types/Monitor/Utils/OpenStackTemplateOnRecording";
import {
  assessOpenStackResource,
  getOpenStackAttentionItems,
} from "../../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import { getOpenStackRowsAsThisCredentialReadsThem } from "../../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackServices";
import { ResourceAttentionSeverity } from "../../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";

/*
 * GNOCCHI, ON WHAT A REAL CLOUD SAID.
 *
 * Tests/Ops/openstack-e2e/services-gnocchi.sh ran Gnocchi on a real stable/2026.1 DevStack, stopped
 * gnocchi-metricd and then its API, and read the exporter at each step. All its scenes are in
 * Tests/Fixtures/OpenStack/services-gnocchi, each got to on its own. What no runner got to is a backlog anywhere
 * near the alert's line: 5 and then 10 measures, a minute apart. So the size of that line is judged only on
 * made-up readings, in OpenStackAlertTemplates.test.ts, and this says what those two real readings do.
 */

const GROUP: string = "services-gnocchi";

function scene(name: string): RecordedServiceScene {
  return new RecordedServiceScene({ group: GROUP, scene: name });
}

function apiOf(recorded: RecordedServiceScene): OpenStackResource {
  return recorded.api(OpenStackServiceType.Metric) as OpenStackResource;
}

async function fires(
  templateId: string,
  recorded: RecordedServiceScene,
): Promise<boolean> {
  const readings: Array<OpenStackTemplateReading> =
    await readOpenStackTemplateOnRecording({
      templateId,
      series: recorded.series,
    });
  return isAnythingFiring(readings);
}

function attentionOf(recorded: RecordedServiceScene): Array<string> {
  return getOpenStackAttentionItems({ rows: recorded.rows, now: RECORDED_AT })
    .map((item: { name: string }): string => {
      return item.name;
    })
    .sort();
}

describe("baseline: measures written, and gnocchi-metricd processing them", () => {
  const recorded: RecordedServiceScene = scene("baseline");

  test("everything Gnocchi says goes on its API's row, and it has no other", () => {
    const facts: JSONObject = factsOfRow(apiOf(recorded));

    expect(apiOf(recorded).status).toBe("up");
    expect(facts[OPENSTACK_GNOCCHI_MEASURES_FACT]).toBe(0);
    expect(facts[OPENSTACK_GNOCCHI_METRICS_FACT]).toBe(0);
    expect(facts[OPENSTACK_GNOCCHI_PROCESSORS_FACT]).toBe(4);
    expect(
      recorded.rows.filter((row: OpenStackResource): boolean => {
        return row.kind !== OpenStackResourceKind.Api;
      }),
    ).toEqual([]);
  });

  test("it reads what Gnocchi's own status said", () => {
    const status: JSONObject = recorded.readApi("gnocchi-status");
    const processors: Array<string> = (status["metricd"] as JSONObject)[
      "processors"
    ] as Array<string>;

    expect(processors).toHaveLength(
      factsOfRow(apiOf(recorded))[OPENSTACK_GNOCCHI_PROCESSORS_FACT] as number,
    );
  });

  test("nothing needs anyone, and no alert fires", async () => {
    expect(attentionOf(recorded)).toEqual([]);
    expect(await fires("openstack-metric-no-processors", recorded)).toBe(false);
    expect(await fires("openstack-metric-api-down", recorded)).toBe(false);
    expect(await fires("openstack-metric-backlog-growing", recorded)).toBe(
      false,
    );
  });
});

describe("metricd-stopped: gnocchi-metricd stopped", () => {
  const recorded: RecordedServiceScene = scene("metricd-stopped");

  test("its API still reads up, so only its processors say so", async () => {
    expect(apiOf(recorded).status).toBe("up");
    expect(factsOfRow(apiOf(recorded))[OPENSTACK_GNOCCHI_PROCESSORS_FACT]).toBe(
      0,
    );
    expect(await fires("openstack-metric-api-down", recorded)).toBe(false);
  });

  test("Gnocchi No Processors fires, and the row says why it needs someone", async () => {
    expect(await fires("openstack-metric-no-processors", recorded)).toBe(true);

    const assessment: { severity: unknown; reasons: Array<{ text: string }> } =
      assessOpenStackResource({ row: apiOf(recorded), now: RECORDED_AT });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(assessment.reasons[0]?.text).toBe(
      "Nothing is processing Gnocchi's measures",
    );
    expect(attentionOf(recorded)).toEqual([OpenStackServiceType.Metric]);
  });
});

describe("backlog-growing: measures arriving with nothing to process them", () => {
  const first: RecordedServiceScene = scene("backlog-growing");
  const second: RecordedServiceScene = scene("backlog-growing-more");

  test("the two real readings, a minute apart", () => {
    expect(factsOfRow(apiOf(first))[OPENSTACK_GNOCCHI_MEASURES_FACT]).toBe(5);
    expect(factsOfRow(apiOf(second))[OPENSTACK_GNOCCHI_MEASURES_FACT]).toBe(10);
    expect(factsOfRow(apiOf(second))[OPENSTACK_GNOCCHI_METRICS_FACT]).toBe(5);
  });

  test("that's far under the line: only its processors are what's wrong", async () => {
    expect(10).toBeLessThan(OPENSTACK_GNOCCHI_BACKLOG_WARNING_MEASURES);
    expect(await fires("openstack-metric-backlog-growing", second)).toBe(false);
    expect(await fires("openstack-metric-no-processors", second)).toBe(true);
    expect(
      assessOpenStackResource({ row: apiOf(second), now: RECORDED_AT })
        .reasons[0]?.text,
    ).toBe("Nothing is processing Gnocchi's measures");
  });
});

describe("recovered: gnocchi-metricd started again, and worked through the backlog", () => {
  const recorded: RecordedServiceScene = scene("recovered");

  test("what fired has recovered, with no one telling it to", async () => {
    expect(await fires("openstack-metric-no-processors", recorded)).toBe(false);

    const readings: Array<OpenStackTemplateReading> =
      await readOpenStackTemplateOnRecording({
        templateId: "openstack-metric-no-processors",
        series: recorded.series,
      });
    expect(
      readings.every((reading: OpenStackTemplateReading): boolean => {
        return reading.healthy;
      }),
    ).toBe(true);
    expect(attentionOf(recorded)).toEqual([]);
  });
});

describe("api-down: Gnocchi's API stopped, with gnocchi-metricd still running", () => {
  const recorded: RecordedServiceScene = scene("api-down");

  test("only `up` is left, and it reads 0: exactly what a credential it refuses reads", () => {
    expect(
      recorded.series.map((one: { name: string }): string => {
        return one.name;
      }),
    ).toEqual(["openstack_gnocchi_up"]);
    expect(apiOf(recorded).status).toBe("down");
    expect(isOpenStackApiClosedToThisCredential(apiOf(recorded))).toBe(true);
  });

  test("once it has answered, that's Metrics API Down", async () => {
    const answered: OpenStackResource = apiOf(recorded);
    answered.facts = {
      ...factsOfRow(answered),
      vouchedAt: RECORDED_AT.toISOString(),
    };

    expect(isOpenStackApiClosedToThisCredential(answered)).toBe(false);
    expect(await fires("openstack-metric-api-down", recorded)).toBe(true);
    expect(
      assessOpenStackResource({ row: answered, now: RECORDED_AT }).severity,
    ).toBe(ResourceAttentionSeverity.Critical);
  });

  test("a series it stopped sending fires nothing, however its last reading stood", async () => {
    expect(await fires("openstack-metric-no-processors", recorded)).toBe(false);
    expect(await fires("openstack-metric-backlog-growing", recorded)).toBe(
      false,
    );
  });

  test("what its last answer said of its processors isn't read while it's down", () => {
    const row: OpenStackResource = apiOf(recorded);
    row.facts = {
      ...factsOfRow(row),
      vouchedAt: RECORDED_AT.toISOString(),
      [OPENSTACK_GNOCCHI_PROCESSORS_FACT]: 0,
    };

    expect(
      assessOpenStackResource({ row, now: RECORDED_AT }).reasons[0]?.text,
    ).not.toContain("processing");
  });
});

describe("what each credential got", () => {
  function reader(level: string): RecordedServiceScene {
    return new RecordedServiceScene({
      group: GROUP,
      scene: "access-check/exporter",
      exporterFolder: level,
    });
  }

  test.each(["admin", "monitoring-admin-get"])(
    "%s reads its status",
    (level: string) => {
      const recorded: RecordedServiceScene = reader(level);

      expect(apiOf(recorded).status).toBe("up");
      expect(
        factsOfRow(apiOf(recorded))[OPENSTACK_GNOCCHI_PROCESSORS_FACT],
      ).toBe(4);
    },
  );

  test.each(["reader", "monitoring-role", "role-on-a-project"])(
    "%s is refused, which reads as a stopped API does, so it reads closed until it has answered once",
    (level: string) => {
      const recorded: RecordedServiceScene = reader(level);
      const api: OpenStackResource = apiOf(recorded);

      expect(api.status).toBe("down");
      expect(isOpenStackApiClosedToThisCredential(api)).toBe(true);

      const [read] = getOpenStackRowsAsThisCredentialReadsThem({
        rows: [api],
        apis: [api],
        workers: [],
      });
      expect(read?.status).toBe("closed");
      expect(
        assessOpenStackResource({
          row: read as OpenStackResource,
          now: RECORDED_AT,
        }).severity,
      ).toBe(null);
    },
  );
});

describe("what the agent's real collector sent", () => {
  const scanned: {
    entries: Array<OpenStackResourceBufferEntry>;
    scrapes: Array<{ service: string; up: number; samples: number }>;
  } = scanRecordedOtlp(GROUP);

  // It was sent with Gnocchi's API stopped, so its status series aren't in it.
  test("its API's row reads down, as it does from the exporter's text", () => {
    const row: OpenStackResourceBufferEntry | undefined = scanned.entries.find(
      (entry: OpenStackResourceBufferEntry): boolean => {
        return (
          entry.kind === OpenStackResourceKind.Api &&
          entry.name === OpenStackServiceType.Metric
        );
      },
    );

    expect(row?.regionName).toBe("RegionOne");
    expect(row?.status).toBe("down");
  });

  test("a service this cloud doesn't run reads up 1 with nothing, and makes no row", () => {
    const absent: { service: string; up: number; samples: number } | undefined =
      scanned.scrapes.find((scrape: { samples: number }): boolean => {
        return scrape.samples === 0;
      });

    expect(absent?.up).toBe(1);
    expect(
      scanned.entries
        .filter((entry: OpenStackResourceBufferEntry): boolean => {
          return entry.kind === OpenStackResourceKind.Api;
        })
        .map((entry: OpenStackResourceBufferEntry): string | null => {
          return entry.name;
        }),
    ).not.toContain(absent?.service);
  });
});
