import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import {
  OPENSTACK_API_STATUS_CLOSED,
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import { ResourceAttentionItem } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import {
  getOpenStackStatusReading,
  OpenStackStatusReading,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackStatus";
import { OPENSTACK_ACCESS_TABLE } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/DocumentationMarkdown";
import {
  getOpenStackAttentionItems,
  getOpenStackHealth,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import {
  OpenStackListView,
  getOpenStackEmptyWords,
  getOpenStackListView,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackPartFacts";
import {
  OpenStackAccessGap,
  getOpenStackAccessGaps,
  getOpenStackRowsAsThisCredentialReadsThem,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackServices";

/*
 * What a page may say at each level of access, on what the agent's exporter really answered
 * each credential on a healthy cloud (Fixtures/OpenStack/<release>/access/exporter/<level>,
 * from Tests/Ops/openstack-e2e/access-matrix.sh), through the scan ingest runs.
 *
 * The docs' table is generated from those same recordings, so it is what these words are held to:
 * a page that sends someone to a credential that wouldn't help, or calls a closed
 * list empty, fails here. OpenStackAccessLevels.spec.ts walks the same answers in a browser.
 */
const FIXTURES: string = path.join(__dirname, "../../Fixtures/OpenStack");
const OBSERVED_AT_MS: number = 1793785799000;
const NOW: Date = new Date(OBSERVED_AT_MS + 60 * 1000);

const RELEASES: ReadonlyArray<string> = fs
  .readdirSync(FIXTURES)
  .filter((release: string): boolean => {
    return fs.existsSync(path.join(FIXTURES, release, "access", "exporter"));
  })
  .sort();

interface Series {
  name: string;
  labels: Record<string, string>;
  value: number;
}

// Prometheus' text format: a tenant's label can hold anything, so this reads escapes.
function parse(text: string): Array<Series> {
  const series: Array<Series> = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) {
      continue;
    }
    const labelsAt: number = line.indexOf("{");
    const valueAt: number = line.lastIndexOf(" ");
    const labels: Record<string, string> = {};
    if (labelsAt >= 0) {
      let at: number = labelsAt + 1;
      while (at < line.length && line[at] !== "}") {
        const equals: number = line.indexOf("=", at);
        const key: string = line.substring(at, equals);
        at = equals + 2;
        let value: string = "";
        while (line[at] !== '"') {
          if (line[at] === "\\") {
            at += 1;
            value += line[at] === "n" ? "\n" : line[at];
          } else {
            value += line[at];
          }
          at += 1;
        }
        labels[key] = value;
        at += 1;
        if (line[at] === ",") {
          at += 1;
        }
      }
    }
    series.push({
      name: line.substring(0, labelsAt >= 0 ? labelsAt : valueAt),
      labels,
      value: Number.parseFloat(line.substring(valueAt + 1)),
    });
  }
  return series;
}

function rowsOf(release: string, level: string): Array<OpenStackResource> {
  const folder: string = path.join(
    FIXTURES,
    release,
    "access",
    "exporter",
    level,
  );
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
  for (const file of fs.readdirSync(folder).sort()) {
    for (const series of parse(
      fs.readFileSync(path.join(folder, file), "utf8"),
    )) {
      const attributes: JSONArray = Object.keys(series.labels).map(
        (key: string): JSONObject => {
          return { key, value: { stringValue: series.labels[key] as string } };
        },
      );
      attributes.push({
        key: "openstack.region.name",
        value: { stringValue: "RegionOne" },
      });
      const datapoint: JSONObject = {
        attributes,
        timeUnixNano: `${OBSERVED_AT_MS}000000`,
        asDouble: series.value,
      };
      if (
        isOpenStackSnapshotDatapoint({ metricName: series.name, datapoint })
      ) {
        bufferOpenStackSnapshotMetric({
          metricName: series.name,
          datapoint,
          buffer,
        });
      }
    }
  }
  return finishOpenStackBatch(buffer.values()).map(
    (entry: OpenStackResourceBufferEntry): OpenStackResource => {
      return Object.assign(new OpenStackResource(), {
        kind: entry.kind,
        externalId: entry.externalId,
        name: entry.name || undefined,
        regionName: entry.regionName || undefined,
        status: entry.status || undefined,
        adminState: entry.adminState || undefined,
        facts: entry.facts,
      });
    },
  );
}

function ofKind(
  rows: Array<OpenStackResource>,
  kind: OpenStackResourceKind,
): Array<OpenStackResource> {
  return rows.filter((row: OpenStackResource): boolean => {
    return row.kind === kind;
  });
}

function gapsOf(rows: Array<OpenStackResource>): Array<OpenStackAccessGap> {
  return getOpenStackAccessGaps({
    apis: ofKind(rows, OpenStackResourceKind.Api),
    workers: ofKind(rows, OpenStackResourceKind.Service),
    hypervisors: ofKind(rows, OpenStackResourceKind.Hypervisor),
    hasStoragePools: ofKind(rows, OpenStackResourceKind.StoragePool).length > 0,
  });
}

function keysOf(gaps: Array<OpenStackAccessGap>): Array<string> {
  return gaps.map((gap: OpenStackAccessGap): string => {
    return gap.key;
  });
}

function apiOf(
  rows: Array<OpenStackResource>,
  service: string,
): OpenStackResource | undefined {
  return ofKind(rows, OpenStackResourceKind.Api).find(
    (row: OpenStackResource): boolean => {
      return row.name === service;
    },
  );
}

function asThisCredentialReadsThem(
  rows: Array<OpenStackResource>,
): Array<OpenStackResource> {
  return getOpenStackRowsAsThisCredentialReadsThem({
    rows: rows,
    apis: ofKind(rows, OpenStackResourceKind.Api),
    workers: ofKind(rows, OpenStackResourceKind.Service),
  });
}

const PROJECT_VIEW: string = "reader";
const INFRASTRUCTURE_ONLY: string = "monitoring-role";
const FULL_VIEW: string = "monitoring-admin-get";

describe("the recordings these rest on", () => {
  test("every release we record has all three levels", () => {
    expect(RELEASES).toEqual([
      "epoxy-ovn",
      "flamingo-ovn",
      "gazpacho-ovn",
      "gazpacho-ovs",
      "hibiscus-ovn",
    ]);
    for (const release of RELEASES) {
      for (const level of [PROJECT_VIEW, INFRASTRUCTURE_ONLY, FULL_VIEW]) {
        expect(rowsOf(release, level).length).toBeGreaterThan(0);
      }
    }
  });
});

describe.each(RELEASES)("on %s", (release: string) => {
  describe("Project view, a plain reader", () => {
    const rows: Array<OpenStackResource> = rowsOf(release, PROJECT_VIEW);

    test("what a real credential got is what the gaps say", () => {
      expect(ofKind(rows, OpenStackResourceKind.Hypervisor)).toEqual([]);
      expect(ofKind(rows, OpenStackResourceKind.Service)).toEqual([]);
      expect(ofKind(rows, OpenStackResourceKind.StoragePool)).toEqual([]);
      expect(keysOf(gapsOf(rows))).toEqual([
        "hypervisors",
        "compute-services",
        "network-agents",
        "volume-services",
        "storage-pools",
        "placement",
      ]);
    });

    test("Placement says down, and every call being refused is all that means", () => {
      expect(apiOf(rows, OpenStackServiceType.Placement)?.status).toBe("down");
      expect(
        apiOf(asThisCredentialReadsThem(rows), OpenStackServiceType.Placement)
          ?.status,
      ).toBe(OPENSTACK_API_STATUS_CLOSED);
    });

    test("no critical comes of what it could not read", () => {
      const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
        rows: asThisCredentialReadsThem(rows),
        now: NOW,
      });
      const names: Array<string> = items.map(
        (item: ResourceAttentionItem): string => {
          return item.name;
        },
      );
      expect(names.join(" ")).not.toContain("placement");
      expect(getOpenStackHealth(items)).not.toBe("Unhealthy");
    });

    test("without that, a page would read Unhealthy on nothing but its own credential", () => {
      expect(
        getOpenStackHealth(getOpenStackAttentionItems({ rows, now: NOW })),
      ).toBe("Unhealthy");
    });

    test("no instances, and that is the credential, because its hypervisors are closed too", () => {
      expect(ofKind(rows, OpenStackResourceKind.Instance)).toEqual([]);
      expect(
        getOpenStackEmptyWords({
          kind: OpenStackResourceKind.Instance,
          api: "up",
          hypervisorsAreListed: false,
        })?.title,
      ).toBe("This credential can't list instances");
    });

    test("no domains, and every cloud has one", () => {
      expect(ofKind(rows, OpenStackResourceKind.Domain)).toEqual([]);
      expect(
        getOpenStackEmptyWords({
          kind: OpenStackResourceKind.Domain,
          api: "up",
        })?.title,
      ).toBe("This credential can't list domains");
    });
  });

  describe("Infrastructure only, the monitoring role on an empty project", () => {
    const rows: Array<OpenStackResource> = rowsOf(release, INFRASTRUCTURE_ONLY);

    test("reads hypervisors and every project's instances, and only Cinder's are closed", () => {
      expect(
        ofKind(rows, OpenStackResourceKind.Hypervisor).length,
      ).toBeGreaterThan(0);
      expect(
        ofKind(rows, OpenStackResourceKind.Instance).length,
      ).toBeGreaterThan(0);
      expect(keysOf(gapsOf(rows))).toEqual([
        "volume-services",
        "storage-pools",
      ]);
    });

    test("both take Full view alone, which is what the docs' table recorded", () => {
      for (const gap of gapsOf(rows)) {
        expect(gap.isFullViewOnly).toBe(true);
      }
    });

    test("Placement is read, and left as it reads", () => {
      expect(apiOf(rows, OpenStackServiceType.Placement)?.status).toBe("up");
      expect(asThisCredentialReadsThem(rows)).toBe(rows);
    });

    test("Cinder lists it no workers, so its Neutron and Cinder lists are its own project's", () => {
      expect(
        getOpenStackListView({
          volumeApi: "up",
          volumeWorkerCount: ofKind(rows, OpenStackResourceKind.Service).filter(
            (row: OpenStackResource): boolean => {
              return (row.facts as JSONObject)["family"] === "volume";
            },
          ).length,
          projectIdsInList: [],
          knownProjectCount: ofKind(rows, OpenStackResourceKind.Project).length,
        }),
      ).toBe("own-project");
    });
  });

  describe("Full view, an application credential limited by access rules", () => {
    const rows: Array<OpenStackResource> = rowsOf(release, FULL_VIEW);

    test("nothing is closed", () => {
      expect(gapsOf(rows)).toEqual([]);
      expect(asThisCredentialReadsThem(rows)).toBe(rows);
    });

    test("one project's volumes among many is that cloud, and never a notice", () => {
      const volumes: Array<OpenStackResource> = ofKind(
        rows,
        OpenStackResourceKind.Volume,
      );
      const workers: Array<OpenStackResource> = ofKind(
        rows,
        OpenStackResourceKind.Service,
      ).filter((row: OpenStackResource): boolean => {
        return (row.facts as JSONObject)["family"] === "volume";
      });
      expect(workers.length).toBeGreaterThan(0);
      expect(volumes.length).toBeGreaterThan(0);
      expect(
        getOpenStackListView({
          volumeApi: "up",
          volumeWorkerCount: workers.length,
          projectIdsInList: ["one-project"],
          knownProjectCount: ofKind(rows, OpenStackResourceKind.Project).length,
        }),
      ).toBe("whole");
    });
  });
});

describe("what a list can say of a credential", () => {
  const LOOKS_LIKE_ONE_PROJECT: ReadonlyArray<string | null> = ["a"];

  test.each<
    [string, Parameters<typeof getOpenStackListView>[0], OpenStackListView]
  >([
    [
      "Cinder lists its workers: an admin, whatever the rows look like",
      {
        volumeApi: "up",
        volumeWorkerCount: 2,
        projectIdsInList: LOOKS_LIKE_ONE_PROJECT,
        knownProjectCount: 8,
      },
      "whole",
    ],
    [
      "Cinder answers and lists none: its own project, however many rows",
      {
        volumeApi: "up",
        volumeWorkerCount: 0,
        projectIdsInList: ["a", "b"],
        knownProjectCount: 8,
      },
      "own-project",
    ],
    [
      "and with no rows at all: an empty 200 is not an empty cloud",
      {
        volumeApi: "up",
        volumeWorkerCount: 0,
        projectIdsInList: [],
        knownProjectCount: 8,
      },
      "own-project",
    ],
    [
      "a plain reader knows of one project, and it still says so",
      {
        volumeApi: "up",
        volumeWorkerCount: 0,
        projectIdsInList: LOOKS_LIKE_ONE_PROJECT,
        knownProjectCount: 1,
      },
      "own-project",
    ],
    [
      "Cinder's API down: last known workers still say an admin read them",
      {
        volumeApi: "down",
        volumeWorkerCount: 2,
        projectIdsInList: LOOKS_LIKE_ONE_PROJECT,
        knownProjectCount: 8,
      },
      "whole",
    ],
    [
      "no Cinder at all: a guess from the rows, and it only says may",
      {
        volumeApi: "not-reported",
        volumeWorkerCount: 0,
        projectIdsInList: LOOKS_LIKE_ONE_PROJECT,
        knownProjectCount: 8,
      },
      "possibly-one-project",
    ],
    [
      "no Cinder, and several projects' rows: nothing to say",
      {
        volumeApi: "not-reported",
        volumeWorkerCount: 0,
        projectIdsInList: ["a", "b"],
        knownProjectCount: 8,
      },
      "whole",
    ],
    [
      "no Cinder, and one project known: a cloud with one project looks the same",
      {
        volumeApi: "not-reported",
        volumeWorkerCount: 0,
        projectIdsInList: LOOKS_LIKE_ONE_PROJECT,
        knownProjectCount: 1,
      },
      "whole",
    ],
    [
      "no Cinder and no rows: nothing to go on",
      {
        volumeApi: "not-reported",
        volumeWorkerCount: 0,
        projectIdsInList: [],
        knownProjectCount: 8,
      },
      "whole",
    ],
    [
      "Cinder's API down and no workers ever seen: can't tell, so it doesn't say",
      {
        volumeApi: "down",
        volumeWorkerCount: 0,
        projectIdsInList: [],
        knownProjectCount: 8,
      },
      "whole",
    ],
  ])(
    "%s",
    (
      _name: string,
      data: Parameters<typeof getOpenStackListView>[0],
      view: OpenStackListView,
    ) => {
      expect(getOpenStackListView(data)).toBe(view);
    },
  );
});

describe("Placement closed, and Placement stopped", () => {
  function row(data: JSONObject): OpenStackResource {
    return Object.assign(new OpenStackResource(), data) as OpenStackResource;
  }
  const NOVA_UP: OpenStackResource = row({
    kind: OpenStackResourceKind.Api,
    name: OpenStackServiceType.Compute,
    status: "up",
    regionName: "RegionOne",
  });
  const PLACEMENT_DOWN: OpenStackResource = row({
    kind: OpenStackResourceKind.Api,
    name: OpenStackServiceType.Placement,
    status: "down",
    regionName: "RegionOne",
  });
  const NOVA_COMPUTE: OpenStackResource = row({
    kind: OpenStackResourceKind.Service,
    name: "nova-compute",
    status: "up",
    regionName: "RegionOne",
    facts: { family: "compute" },
  });

  function placementAfter(
    apis: Array<OpenStackResource>,
    workers: Array<OpenStackResource>,
  ): string | undefined {
    return getOpenStackRowsAsThisCredentialReadsThem({
      rows: apis,
      apis: apis,
      workers: workers,
    }).find((one: OpenStackResource): boolean => {
      return one.name === OpenStackServiceType.Placement;
    })?.status;
  }

  test("Nova answers and lists no services: this credential is closed to infrastructure", () => {
    expect(placementAfter([NOVA_UP, PLACEMENT_DOWN], [])).toBe(
      OPENSTACK_API_STATUS_CLOSED,
    );
  });

  test("Nova lists its services: a stopped Placement stays stopped", () => {
    expect(placementAfter([NOVA_UP, PLACEMENT_DOWN], [NOVA_COMPUTE])).toBe(
      "down",
    );
  });

  test("Nova down too: nothing says this is the credential", () => {
    const novaDown: OpenStackResource = row({
      kind: OpenStackResourceKind.Api,
      name: OpenStackServiceType.Compute,
      status: "down",
      regionName: "RegionOne",
    });
    expect(placementAfter([novaDown, PLACEMENT_DOWN], [])).toBe("down");
  });

  test("no Nova to ask: nothing says this is the credential", () => {
    expect(placementAfter([PLACEMENT_DOWN], [])).toBe("down");
  });

  test("a region closed elsewhere says nothing about this one", () => {
    const novaUpElsewhere: OpenStackResource = row({
      kind: OpenStackResourceKind.Api,
      name: OpenStackServiceType.Compute,
      status: "up",
      regionName: "RegionTwo",
    });
    const novaComputeHere: OpenStackResource = row({
      kind: OpenStackResourceKind.Service,
      name: "nova-compute",
      status: "up",
      regionName: "RegionOne",
      facts: { family: "compute" },
    });
    expect(
      placementAfter(
        [NOVA_UP, novaUpElsewhere, PLACEMENT_DOWN],
        [novaComputeHere],
      ),
    ).toBe("down");
  });

  test("only Placement: another API down is a real outage, whatever is closed", () => {
    const neutronDown: OpenStackResource = row({
      kind: OpenStackResourceKind.Api,
      name: OpenStackServiceType.Network,
      status: "down",
      regionName: "RegionOne",
    });
    expect(
      getOpenStackRowsAsThisCredentialReadsThem({
        rows: [NOVA_UP, neutronDown],
        apis: [NOVA_UP, neutronDown],
        workers: [],
      })[1]?.status,
    ).toBe("down");
  });

  test("a closed API reads as closed, in the reader's language, and as nothing to look at", () => {
    const reading: OpenStackStatusReading | null = getOpenStackStatusReading({
      kind: OpenStackResourceKind.Api,
      status: OPENSTACK_API_STATUS_CLOSED,
    });
    expect(reading?.label).toBe("Closed to this credential");
    expect(reading?.isOpenStackWord).toBe(false);
    expect(reading?.tone).toBe("neutral");
  });

  test("the row a page was given is not changed", () => {
    getOpenStackRowsAsThisCredentialReadsThem({
      rows: [NOVA_UP, PLACEMENT_DOWN],
      apis: [NOVA_UP, PLACEMENT_DOWN],
      workers: [],
    });
    expect(PLACEMENT_DOWN.status).toBe("down");
  });
});

describe("the words, held to the table the docs print from the recordings", () => {
  // | Read | Level 1 | Level 2 | Level 3 |
  function levelsOf(read: string): Array<string> {
    const line: string | undefined = OPENSTACK_ACCESS_TABLE.split("\n").find(
      (candidate: string): boolean => {
        return candidate.startsWith(`| ${read} |`);
      },
    );
    if (!line) {
      throw new Error(`The table has no row for ${read}`);
    }
    return line
      .split("|")
      .map((cell: string): string => {
        return cell.trim();
      })
      .slice(2, 5);
  }

  test.each<[string, boolean]>([
    ["Nova: hypervisors", false],
    ["Nova: services", false],
    ["Neutron: agents", false],
    ["Placement: resource providers", false],
    ["Keystone: domains", false],
    ["Cinder: services", true],
    ["Cinder: pools", true],
  ])(
    "%s: the table says whether Infrastructure only reads it",
    (read: string, isFullViewOnly: boolean) => {
      const [level1, level2]: Array<string> = levelsOf(read);
      expect(level1).toBe("all");
      expect(level2).toBe(isFullViewOnly ? "refused" : "all");
    },
  );

  test("Cinder's gaps, and only Cinder's, are the ones marked Full view alone", () => {
    const gaps: Array<OpenStackAccessGap> = gapsOf(
      rowsOf("hibiscus-ovn", PROJECT_VIEW),
    );
    expect(
      gaps
        .filter((gap: OpenStackAccessGap): boolean => {
          return gap.isFullViewOnly;
        })
        .map((gap: OpenStackAccessGap): string => {
          return gap.key;
        }),
    ).toEqual(["volume-services", "storage-pools"]);
  });

  test("a closed list of storage pools never offers the credential that can't read them", () => {
    const words: string = JSON.stringify(
      getOpenStackEmptyWords({
        kind: OpenStackResourceKind.StoragePool,
        api: "up",
      }),
    );
    expect(words).toContain("Only the Full view credential");
    expect(words).not.toContain("Infrastructure only");
  });

  test.each<[string]>([["Nova: servers, all projects"], ["Nova: flavors"]])(
    "%s: Infrastructure only is not told it needs more",
    (read: string) => {
      expect(levelsOf(read)[1]).not.toBe("refused");
    },
  );

  test("instances: every project's take Full view or Infrastructure only, as the table recorded", () => {
    expect(levelsOf("Nova: servers, all projects")).toEqual([
      "all",
      "all",
      "refused",
    ]);
    const words: string = JSON.stringify(
      getOpenStackEmptyWords({
        kind: OpenStackResourceKind.Instance,
        api: "up",
        hypervisorsAreListed: false,
      }),
    );
    expect(words).toContain("Full view or Infrastructure only");
  });

  test("an empty list of instances on a cloud whose hosts it can read is a cloud with none", () => {
    expect(
      getOpenStackEmptyWords({
        kind: OpenStackResourceKind.Instance,
        api: "up",
        hypervisorsAreListed: true,
      }),
    ).toBeNull();
  });

  test("before anyone has asked about its hosts, an empty list says nothing about the credential", () => {
    expect(
      getOpenStackEmptyWords({
        kind: OpenStackResourceKind.Instance,
        api: "up",
      }),
    ).toBeNull();
  });
});
