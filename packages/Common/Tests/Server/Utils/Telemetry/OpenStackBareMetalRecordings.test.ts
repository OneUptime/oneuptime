import fs from "fs";
import path from "path";
import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  getOpenStackHostsToReconcile,
  isOpenStackSnapshotDatapoint,
} from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  canOpenStackBareMetalNodeTakeAnInstance,
  isOpenStackBareMetalMaintenanceTooLong,
  isOpenStackBareMetalNodeInMaintenance,
  isOpenStackBareMetalNodeStuck,
  isOpenStackServiceQuiet,
} from "../../../../Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_FIXTURES_FOLDER,
  RecordedSeries,
  readRecordedSeries,
  scanRecordedSeries,
} from "../../../Helpers/OpenStackRecordedRows";
import {
  OpenStackAssessment,
  assessOpenStackResource,
  getOpenStackAttentionItems,
  getOpenStackHealth,
} from "../../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";

/*
 * BARE METAL, ON WHAT A REAL CLOUD SAID.
 *
 * Tests/Ops/openstack-e2e/services-ironic.sh ran Ironic on a real stable/2026.1 DevStack with fake
 * hardware: its API, conductor and state machine are real, only the power and the disks are not. Six
 * of its ten scenes are in Tests/Fixtures/OpenStack/services-ironic, each what the agent's exporter
 * answered once Ironic had got there by itself:
 *
 *   half-enrolled, maintenance, clean-failed, wait-call-back, deploy-failed, api-down
 *
 * Not recorded yet, so not asserted here: baseline, power-off-while-active, conductor-down, recovered,
 * Nova's hypervisor list with a node in it, and what a system-scoped credential reads.
 */

const IRONIC: string = path.join(OPENSTACK_FIXTURES_FOLDER, "services-ironic");
const OBSERVED_AT_MS: number = 1793841200000;
const NOW: Date = new Date(OBSERVED_AT_MS);

function toRow(entry: OpenStackResourceBufferEntry): OpenStackResource {
  return Object.assign(new OpenStackResource(), {
    kind: entry.kind,
    externalId: entry.externalId,
    name: entry.name || undefined,
    regionName: entry.regionName || undefined,
    hypervisorName: entry.hypervisorName || undefined,
    openStackProjectId: entry.openStackProjectId || undefined,
    status: entry.status || undefined,
    adminState: entry.adminState || undefined,
    disabledReason: entry.disabledReason || undefined,
    facts: entry.facts,
    lastSeenAt: entry.observedAt,
    stateChangedAt: entry.observedAt,
  });
}

class Scene {
  public readonly series: Array<RecordedSeries>;
  public readonly entries: Array<OpenStackResourceBufferEntry>;
  public readonly rows: Array<OpenStackResource>;

  public constructor(scene: string, folder: string = "exporter") {
    this.series = readRecordedSeries(path.join(IRONIC, scene, folder));
    this.entries = scanRecordedSeries(this.series, OBSERVED_AT_MS);
    this.rows = this.entries.map(toRow);
  }

  public ofKind(kind: OpenStackResourceKind): Array<OpenStackResource> {
    return this.rows.filter((row: OpenStackResource): boolean => {
      return row.kind === kind;
    });
  }

  public node(name: string): OpenStackResource {
    const found: OpenStackResource | undefined = this.ofKind(
      OpenStackResourceKind.BareMetalNode,
    ).find((row: OpenStackResource): boolean => {
      return row.name === name;
    });
    if (!found) {
      throw new Error(`No node named ${name}`);
    }
    return found;
  }

  public api(service: OpenStackServiceType): OpenStackResource | undefined {
    return this.ofKind(OpenStackResourceKind.Api).find(
      (row: OpenStackResource): boolean => {
        return row.name === service;
      },
    );
  }
}

function assess(row: OpenStackResource, now: Date = NOW): OpenStackAssessment {
  return assessOpenStackResource({ row, now });
}

function namesOf(rows: Array<OpenStackResource>): Array<string | undefined> {
  return rows
    .map((row: OpenStackResource): string | undefined => {
      return row.name;
    })
    .sort();
}

function factsOf(row: OpenStackResource): JSONObject {
  return row.facts as JSONObject;
}

const SCENES_WITH_NODES: Array<string> = [
  "half-enrolled",
  "maintenance",
  "clean-failed",
  "wait-call-back",
  "deploy-failed",
];

describe("every scene with Ironic answering", () => {
  test.each(SCENES_WITH_NODES)(
    "%s: its API says up, and a node is never a hypervisor",
    (scene: string) => {
      const recorded: Scene = new Scene(scene);

      expect(recorded.api(OpenStackServiceType.BareMetal)?.status).toBe("up");
      expect(recorded.api(OpenStackServiceType.Compute)?.status).toBe("up");
      expect(recorded.api(OpenStackServiceType.Placement)?.status).toBe("up");

      // Placement holds every node under its UUID, with one of its own class and nothing else.
      expect(recorded.ofKind(OpenStackResourceKind.Hypervisor)).toEqual([]);
      expect(getOpenStackHostsToReconcile(recorded.entries)).not.toContain(
        recorded.ofKind(OpenStackResourceKind.BareMetalNode)[0]?.externalId,
      );
    },
  );

  test.each(SCENES_WITH_NODES)(
    "%s: each node's row is what the API said of it",
    (scene: string) => {
      const recorded: Scene = new Scene(scene);
      const answer: { nodes: Array<JSONObject> } = JSON.parse(
        fs.readFileSync(
          path.join(IRONIC, scene, "api", "ironic-nodes.json"),
          "utf8",
        ),
      );
      const nodes: Array<OpenStackResource> = recorded.ofKind(
        OpenStackResourceKind.BareMetalNode,
      );

      expect(nodes.length).toBe(answer.nodes.length);

      for (const said of answer.nodes) {
        const row: OpenStackResource = recorded.node(said["name"] as string);

        expect({
          name: row.name,
          id: row.externalId,
          provisionState: row.status,
          maintenance: isOpenStackBareMetalNodeInMaintenance(row.adminState),
          reason: row.disabledReason ?? null,
          resourceClass: factsOf(row)["resourceClass"],
          // The API says None for one nothing has set, and the exporter nothing at all.
          powerState: factsOf(row)["powerState"],
        }).toEqual({
          name: said["name"],
          id: said["uuid"],
          provisionState: said["provision_state"],
          maintenance: said["maintenance"],
          reason: said["maintenance_reason"],
          resourceClass: said["resource_class"],
          powerState: said["power_state"],
        });

        // What only the API has, which the exporter's series never carry.
        expect(factsOf(row)).not.toHaveProperty("driver");
        expect(factsOf(row)).not.toHaveProperty("lastError");
        expect(factsOf(row)).not.toHaveProperty("instanceId");
      }
    },
  );

  test.each(SCENES_WITH_NODES)(
    "%s: Placement's providers are what capacity adds up, with one of its own class each",
    (scene: string) => {
      const recorded: Scene = new Scene(scene);
      const providers: Array<OpenStackResource> = recorded.ofKind(
        OpenStackResourceKind.PlacementProvider,
      );

      // A half-enrolled node has a provider with no inventory, so no series and no row.
      const ids: Array<string> = providers.map(
        (row: OpenStackResource): string => {
          return row.name as string;
        },
      );
      expect(ids).not.toContain(recorded.node("ou-node-half").externalId);
      /*
       * Each is a node's. Not always all of them: Nova only finds a new node on its next periodic,
       * so what these say trails what Ironic says by up to a minute or so.
       */
      const nodesWithAClass: Array<string | undefined> = recorded
        .ofKind(OpenStackResourceKind.BareMetalNode)
        .filter((row: OpenStackResource): boolean => {
          return factsOf(row)["resourceClass"] === "baremetal";
        })
        .map((row: OpenStackResource): string | undefined => {
          return row.externalId;
        });
      expect(providers.length).toBeGreaterThan(0);
      expect(nodesWithAClass).toEqual(expect.arrayContaining(ids));

      for (const provider of providers) {
        expect(provider.externalId).toBe(`RegionOne/${provider.name}`);
        expect(factsOf(provider)).toMatchObject({
          "inventory:CUSTOM_BAREMETAL:total": 1,
          "inventory:CUSTOM_BAREMETAL:ratio": 1,
          "inventory:CUSTOM_BAREMETAL:used": 0,
        });
      }
    },
  );

  test.each(SCENES_WITH_NODES)(
    "%s: Nova's Ironic driver would reserve every one, as Placement recorded",
    (scene: string) => {
      const recorded: Scene = new Scene(scene);

      /*
       * Every node here has no power state or is not available, which is what the driver reports
       * reserved for, and the recording agrees: the rule and Placement say one thing.
       */
      for (const provider of recorded.ofKind(
        OpenStackResourceKind.PlacementProvider,
      )) {
        const node: OpenStackResource | undefined = recorded
          .ofKind(OpenStackResourceKind.BareMetalNode)
          .find((row: OpenStackResource): boolean => {
            return row.externalId === provider.name;
          });

        expect(factsOf(provider)["inventory:CUSTOM_BAREMETAL:reserved"]).toBe(
          1,
        );
        expect(
          canOpenStackBareMetalNodeTakeAnInstance({
            status: node?.status,
            adminState: node?.adminState,
            powerState: factsOf(node as OpenStackResource)["powerState"] as
              | string
              | null,
          }),
        ).toBe(false);
      }
    },
  );
});

describe("half-enrolled: a node left in enroll with nothing filled in", () => {
  const recorded: Scene = new Scene("half-enrolled");

  test("breaks nothing: every API says up, and both nodes are listed", () => {
    expect(
      namesOf(recorded.ofKind(OpenStackResourceKind.BareMetalNode)),
    ).toEqual(["ou-node-available", "ou-node-half"]);
    expect(
      recorded.series.find((one: RecordedSeries): boolean => {
        return one.name === "openstack_nova_up";
      })?.value,
    ).toBe(1);
    expect(
      recorded.series.find((one: RecordedSeries): boolean => {
        return one.name === "openstack_ironic_up";
      })?.value,
    ).toBe(1);
  });

  test("reads what it is, with no resource class or power state, and nothing to do about it", () => {
    const half: OpenStackResource = recorded.node("ou-node-half");

    expect(half.status).toBe("enroll");
    expect(factsOf(half)["resourceClass"]).toBe(null);
    expect(factsOf(half)["powerState"]).toBe(null);
    // Nothing has ever moved it, so Ironic has no time to give.
    expect(factsOf(half)).not.toHaveProperty("provisionUpdatedAt");
    expect(assess(half)).toEqual({ severity: null, reasons: [] });
  });

  test("the cloud stays Healthy", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: recorded.rows,
      now: NOW,
    });

    expect(items).toEqual([]);
    expect(getOpenStackHealth(items)).toBe("Healthy");
  });
});

describe("maintenance: a node someone took out on purpose", () => {
  const recorded: Scene = new Scene("maintenance");
  const node: OpenStackResource = recorded.node("ou-node-maintenance");

  test("says so, in the operator's words", () => {
    expect(isOpenStackBareMetalNodeInMaintenance(node.adminState)).toBe(true);
    expect(node.disabledReason).toBe("OneUptime drill: a disk being swapped");
    expect(node.status).toBe("available");
  });

  test("is planned, so it needs nobody", () => {
    expect(assess(node)).toEqual({ severity: null, reasons: [] });
  });

  test("until it has been there a week", () => {
    const days: (count: number) => Date = (count: number): Date => {
      return new Date(OBSERVED_AT_MS + count * 24 * 60 * 60 * 1000);
    };

    expect(
      isOpenStackBareMetalMaintenanceTooLong({
        adminState: node.adminState,
        stateChangedAt: node.stateChangedAt,
        now: days(6.9),
      }),
    ).toBe(false);

    const assessment: OpenStackAssessment = assess(node, days(8));

    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.reasons).toEqual([
      { text: "In maintenance for {{days}} days", values: { days: "8" } },
    ]);
  });

  test("its reason is what Needs attention shows, since the exporter has nothing else", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: [node],
      now: new Date(OBSERVED_AT_MS + 8 * 24 * 60 * 60 * 1000),
    });

    expect(items[0]?.message).toBe("OneUptime drill: a disk being swapped");
  });
});

describe("clean-failed: the conductor could not run a step", () => {
  const recorded: Scene = new Scene("clean-failed");
  const node: OpenStackResource = recorded.node("ou-node-clean-failed");

  test("needs someone by name, in Ironic's word, and is not in maintenance", () => {
    expect(node.status).toBe("clean failed");
    expect(isOpenStackBareMetalNodeInMaintenance(node.adminState)).toBe(false);

    const assessment: OpenStackAssessment = assess(node);

    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.reasons).toEqual([
      { text: "In {{status}}", values: { status: "clean failed" } },
    ]);
  });

  test("reaches Needs attention, and says nothing it was not told about why", () => {
    const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
      rows: recorded.rows,
      now: NOW,
    });

    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["ou-node-clean-failed"]);
    expect(items[0]?.kind).toBe("Bare metal node");
    expect(items[0]?.message).toBeUndefined();
    expect(getOpenStackHealth(items)).toBe("Degraded");
  });

  test("the API had the reason when this was recorded, and the exporter never does", () => {
    const answer: { nodes: Array<JSONObject> } = JSON.parse(
      fs.readFileSync(
        path.join(IRONIC, "clean-failed", "api", "ironic-nodes.json"),
        "utf8",
      ),
    );
    const said: JSONObject = answer.nodes.find((one: JSONObject): boolean => {
      return one["name"] === "ou-node-clean-failed";
    }) as JSONObject;

    expect(said["last_error"]).toBeTruthy();
    expect(said["maintenance"]).toBe(false);
    expect(factsOf(node)).not.toHaveProperty("lastError");
  });

  test("Ironic says when it failed, which outlasts a read that was not watching", () => {
    expect(factsOf(node)["provisionUpdatedAt"]).toBe(
      new Date(1793840982 * 1000).toISOString(),
    );
  });
});

describe("wait-call-back: Ironic waiting for an agent that will never call", () => {
  const recorded: Scene = new Scene("wait-call-back");
  const node: OpenStackResource = recorded.node("ou-node-deploy-failed");
  const movedAt: string = factsOf(node)["provisionUpdatedAt"] as string;

  test("is on its way, so it needs nobody yet", () => {
    expect(node.status).toBe("wait call-back");
    expect(assess(node)).toEqual({ severity: null, reasons: [] });
  });

  test("is stuck two hours after Ironic last saw it move, however late anyone noticed", () => {
    const after: (minutes: number) => Date = (minutes: number): Date => {
      return new Date(new Date(movedAt).getTime() + minutes * 60 * 1000);
    };

    const reading: {
      status: string | undefined;
      adminState: string | undefined;
      // A read only just noticed: this says nothing of how long it has really been.
      stateChangedAt: Date;
      provisionUpdatedAt: string;
    } = {
      status: node.status,
      adminState: node.adminState,
      stateChangedAt: after(119),
      provisionUpdatedAt: movedAt,
    };

    expect(isOpenStackBareMetalNodeStuck({ ...reading, now: after(119) })).toBe(
      false,
    );
    expect(isOpenStackBareMetalNodeStuck({ ...reading, now: after(120) })).toBe(
      true,
    );
    expect(assess(node, after(180)).reasons).toEqual([
      {
        text: "{{status}} for {{duration}}",
        values: { status: "wait call-back", duration: "3h" },
      },
    ]);
  });
});

describe("deploy-failed: the callback never came, and Ironic gave up", () => {
  const recorded: Scene = new Scene("deploy-failed");

  test("every state in this scene reads as itself", () => {
    expect(
      recorded
        .ofKind(OpenStackResourceKind.BareMetalNode)
        .map((row: OpenStackResource): Array<unknown> => {
          return [row.name, row.status, factsOf(row)["powerState"]];
        })
        .sort(),
    ).toEqual([
      ["ou-node-available", "available", null],
      ["ou-node-clean-failed", "clean failed", null],
      ["ou-node-deploy-failed", "deploy failed", "power on"],
      ["ou-node-half", "enroll", null],
      ["ou-node-maintenance", "available", null],
    ]);
  });

  test("both failed nodes reach Needs attention, and the one in maintenance does not", () => {
    expect(
      getOpenStackAttentionItems({ rows: recorded.rows, now: NOW })
        .map((item: ResourceAttentionItem): string => {
          return item.name;
        })
        .sort(),
    ).toEqual(["ou-node-clean-failed", "ou-node-deploy-failed"]);
  });

  test("a failed deploy leaves its power on, and that is not Power State Unexpected", () => {
    expect(assess(recorded.node("ou-node-deploy-failed")).reasons).toEqual([
      { text: "In {{status}}", values: { status: "deploy failed" } },
    ]);
  });
});

describe("api-down: Ironic's API stopped", () => {
  const recorded: Scene = new Scene("api-down");

  test("the exporter says nothing at all of Ironic, as it does for a cloud without it", () => {
    expect(
      fs.existsSync(path.join(IRONIC, "api-down/exporter/baremetal.prom")),
    ).toBe(false);
    expect(
      fs.readFileSync(
        path.join(IRONIC, "api-down/exporter/status.txt"),
        "utf8",
      ),
    ).toContain("baremetal 200");
    expect(recorded.api(OpenStackServiceType.BareMetal)).toBeUndefined();
    expect(recorded.ofKind(OpenStackResourceKind.BareMetalNode)).toEqual([]);
  });

  test("so nothing here can read it as down: a cloud that had it goes quiet", () => {
    const api: OpenStackResource = Object.assign(new OpenStackResource(), {
      kind: OpenStackResourceKind.Api,
      externalId: "RegionOne/baremetal",
      name: OpenStackServiceType.BareMetal,
      regionName: "RegionOne",
      status: "up",
      lastSeenAt: NOW,
    });

    const minutes: (count: number) => Date = (count: number): Date => {
      return new Date(OBSERVED_AT_MS + count * 60 * 1000);
    };

    expect(assess(api, minutes(19))).toEqual({ severity: null, reasons: [] });

    const quiet: OpenStackAssessment = assess(api, minutes(25));

    expect(quiet.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(quiet.reasons[0]?.text).toContain("Not heard from");
    expect(quiet.reasons[0]?.text).not.toContain("Not answering");
    expect(quiet.reasons[0]?.values).toEqual({ duration: "25m" });

    // A service every cloud runs says its own 0, and going quiet is the whole cloud's.
    expect(
      isOpenStackServiceQuiet({
        service: OpenStackServiceType.Compute,
        lastSeenAt: NOW,
        now: minutes(120),
      }),
    ).toBe(false);
  });

  test("the exporter's last release does say 0, and then it is down", () => {
    const stable: Scene = new Scene("api-down", "exporter-stable");

    expect(stable.api(OpenStackServiceType.BareMetal)?.status).toBe("down");
    expect(
      assess(stable.api(OpenStackServiceType.BareMetal) as OpenStackResource),
    ).toEqual({
      severity: ResourceAttentionSeverity.Critical,
      reasons: [{ text: "Not answering" }],
    });
  });

  test("Placement still holds the nodes it knew, so what capacity adds up does not go with it", () => {
    expect(
      recorded.ofKind(OpenStackResourceKind.PlacementProvider).length,
    ).toBe(4);
  });
});

describe("the access check: what a project's admin reads through the exporter", () => {
  test("the same nodes the other scenes hold, because it owns every one it created", () => {
    const recorded: Scene = new Scene("access-check", "exporter/admin");

    expect(
      namesOf(recorded.ofKind(OpenStackResourceKind.BareMetalNode)),
    ).toEqual([
      "ou-node-available",
      "ou-node-clean-failed",
      "ou-node-deploy-failed",
      "ou-node-half",
      "ou-node-maintenance",
    ]);
  });
});

/*
 * What the agent's collector sent, recorded end to end (services-ironic/otlp.json). The collector
 * drops a label with nothing in it, which the .prom files above still hold.
 */
describe("the recording's OTLP, as ingest reads it", () => {
  const otlp: JSONObject = JSON.parse(
    fs.readFileSync(path.join(IRONIC, "otlp.json"), "utf8"),
  );

  function scanOtlp(): Array<OpenStackResourceBufferEntry> {
    const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();

    for (const resource of otlp["resourceMetrics"] as JSONArray) {
      for (const scope of (resource as JSONObject)[
        "scopeMetrics"
      ] as JSONArray) {
        for (const metric of (scope as JSONObject)["metrics"] as JSONArray) {
          const name: string = (metric as JSONObject)["name"] as string;
          const data: JSONObject = ((metric as JSONObject)["gauge"] ||
            (metric as JSONObject)["sum"]) as JSONObject;

          for (const datapoint of data["dataPoints"] as JSONArray) {
            if (
              isOpenStackSnapshotDatapoint({
                metricName: name,
                datapoint: datapoint as JSONObject,
              })
            ) {
              bufferOpenStackSnapshotMetric({
                metricName: name,
                datapoint: datapoint as JSONObject,
                buffer,
              });
            }
          }
        }
      }
    }

    return finishOpenStackBatch(buffer.values());
  }

  test("a node with empty labels reads the same as it does from the exporter's text", () => {
    const entries: Array<OpenStackResourceBufferEntry> = scanOtlp();
    const node: OpenStackResourceBufferEntry | undefined = entries.find(
      (entry: OpenStackResourceBufferEntry): boolean => {
        return (
          entry.kind === OpenStackResourceKind.BareMetalNode &&
          entry.name === "ou-node-available"
        );
      },
    );

    expect(node?.status).toBe("available");
    expect(node?.regionName).toBe("RegionOne");
    expect(node?.adminState).toBe("in service");
    expect(node?.disabledReason).toBe(null);
    expect(node?.facts["powerState"]).toBe(null);
    expect(node?.facts["resourceClass"]).toBe("baremetal");
    expect(node?.facts["isRetired"]).toBe(false);
  });

  test("the scrape's own series make no row for Ironic: only Ironic's own do", () => {
    const entries: Array<OpenStackResourceBufferEntry> = scanOtlp();
    const api: OpenStackResourceBufferEntry | undefined = entries.find(
      (entry: OpenStackResourceBufferEntry): boolean => {
        return (
          entry.kind === OpenStackResourceKind.Api &&
          entry.name === OpenStackServiceType.BareMetal
        );
      },
    );

    expect(api?.status).toBe("up");
    // collectionSeconds and scrapeFailed come from the scrape's series, which are not read here.
    expect(api?.facts).not.toHaveProperty("collectionSeconds");
    expect(api?.facts).not.toHaveProperty("scrapeFailed");
    expect(api?.facts).toHaveProperty("vouchedAt");
  });
});
