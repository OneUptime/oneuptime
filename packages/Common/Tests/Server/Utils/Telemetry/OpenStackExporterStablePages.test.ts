import fs from "fs";
import path from "path";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import {
  OPENSTACK_ANCHOR_METRIC_ALIAS,
  OpenStackAlertTemplate,
  OpenStackAlertTemplateArgs,
  getAllOpenStackAlertTemplates,
} from "../../../../Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "../../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import { OPENSTACK_RECEIVER_SERIES } from "../../../Types/Monitor/Utils/OpenStackExporterSeries";

/*
 * WHAT THE PAGES GO WITHOUT ON KOLLA-ANSIBLE'S EXPORTER, READ RATHER THAN REMEMBERED.
 *
 * A cloud can point the agent at the exporter it already runs. Kolla-Ansible pins 1.7.0,
 * the last release that is not an alpha, and the agent pins a newer one because 1.7.0 says
 * less. This runs the real scan over what both answered about one cloud at one moment, on
 * five real clouds (Tests/Ops/openstack-e2e records them side by side), so the sentence the
 * guide, the README and the docs say about it cannot drift from what happens.
 */

const FIXTURES: string = path.join(__dirname, "../../../Fixtures/OpenStack");
const REPO_ROOT: string = path.resolve(__dirname, "../../../../../..");

const RELEASES: ReadonlyArray<string> = [
  "epoxy-ovn",
  "flamingo-ovn",
  "gazpacho-ovn",
  "gazpacho-ovs",
  "hibiscus-ovn",
];

// The same words in all three places, so each is held to the same list.
const WHERE_IT_IS_SAID: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackDeploymentGuides.ts",
  "agents/OpenStackAgent/README.md",
  "packages/App/FeatureSet/Docs/Content/en/telemetry/openstack-deployment-tools.md",
];

interface Series {
  metricName: string;
  datapoint: JSONObject;
}

function seriesOf(folder: string): Array<Series> {
  const series: Array<Series> = [];
  for (const file of fs.readdirSync(folder).sort()) {
    if (!file.endsWith(".prom")) {
      continue;
    }
    const text: string = fs.readFileSync(path.join(folder, file), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim() || line.startsWith("#")) {
        continue;
      }
      const brace: number = line.indexOf("{");
      const end: number = line.lastIndexOf(" ");
      const attributes: JSONArray = [
        { key: "openstack.region.name", value: { stringValue: "RegionOne" } },
      ];
      if (brace >= 0) {
        const labels: string = line.substring(brace + 1, line.lastIndexOf("}"));
        for (const match of labels.matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) {
          attributes.push({
            key: match[1] as string,
            value: { stringValue: match[2] as string },
          });
        }
      }
      series.push({
        metricName: line.substring(0, brace < 0 ? end : brace),
        datapoint: {
          attributes,
          timeUnixNano: "1793785799000000000",
          asDouble: Number.parseFloat(line.substring(end + 1)),
        },
      });
    }
  }
  return series;
}

function rowsOf(folder: string): Array<OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
  for (const point of seriesOf(folder)) {
    if (isOpenStackSnapshotDatapoint(point)) {
      bufferOpenStackSnapshotMetric({ ...point, buffer });
    }
  }
  return finishOpenStackBatch(buffer.values());
}

function kindsOf(
  rows: Array<OpenStackResourceBufferEntry>,
): Set<OpenStackResourceKind> {
  return new Set(
    rows.map((row: OpenStackResourceBufferEntry): OpenStackResourceKind => {
      return row.kind;
    }),
  );
}

function idOf(row: OpenStackResourceBufferEntry): string {
  return `${row.kind}/${row.externalId}`;
}

const FIELDS: ReadonlyArray<keyof OpenStackResourceBufferEntry> = [
  "name",
  "regionName",
  "availabilityZone",
  "hypervisorName",
  "openStackProjectId",
  "status",
  "adminState",
  "disabledReason",
  "vcpuCapacity",
  "vcpuAllocated",
  "memoryCapacityBytes",
  "memoryAllocatedBytes",
  "diskCapacityBytes",
  "diskAllocatedBytes",
  "instanceCount",
];

function isSaid(value: unknown): boolean {
  return value !== null && value !== undefined;
}

// What a row of the pinned exporter's says that the same row of 1.7.0's does not.
function lostFromRows(data: {
  pinned: Array<OpenStackResourceBufferEntry>;
  stable: Array<OpenStackResourceBufferEntry>;
}): Record<string, Array<string>> {
  const stableById: Map<string, OpenStackResourceBufferEntry> = new Map(
    data.stable.map(
      (
        row: OpenStackResourceBufferEntry,
      ): [string, OpenStackResourceBufferEntry] => {
        return [idOf(row), row];
      },
    ),
  );
  const lost: Record<string, Set<string>> = {};
  const add: (kind: string, what: string) => void = (
    kind: string,
    what: string,
  ): void => {
    (lost[kind] ||= new Set<string>()).add(what);
  };

  for (const row of data.pinned) {
    const other: OpenStackResourceBufferEntry | undefined = stableById.get(
      idOf(row),
    );
    if (!other) {
      continue;
    }
    for (const field of FIELDS) {
      if (isSaid(row[field]) && !isSaid(other[field])) {
        add(row.kind, field);
      }
    }
    for (const fact of Object.keys(row.facts)) {
      if (isSaid(row.facts[fact]) && !isSaid(other.facts[fact])) {
        add(row.kind, `facts.${fact}`);
      }
    }
  }

  return Object.fromEntries(
    Object.entries(lost).map(
      ([kind, what]: [string, Set<string>]): [string, Array<string>] => {
        return [kind, Array.from(what).sort()];
      },
    ),
  );
}

const ARGS: OpenStackAlertTemplateArgs = {
  cloudIdentifier: "production",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Test Cloud",
};

// The series a template compares: not its anchor, and not the receiver's own.
function seriesTemplateReads(template: OpenStackAlertTemplate): Array<string> {
  const queries: Array<MetricQueryConfigData> =
    template.getMonitorStep(ARGS).data!.openstackMonitor!.metricViewConfig
      .queryConfigs;

  return queries
    .filter((query: MetricQueryConfigData): boolean => {
      return (
        query.metricAliasData?.metricVariable !== OPENSTACK_ANCHOR_METRIC_ALIAS
      );
    })
    .map((query: MetricQueryConfigData): string => {
      return query.metricQueryData.filterData.metricName as string;
    })
    .filter((name: string): boolean => {
      return !OPENSTACK_RECEIVER_SERIES.includes(name);
    });
}

describe("what the pages go without on exporter 1.7.0", () => {
  describe.each(RELEASES)("%s", (release: string) => {
    const pinned: Array<OpenStackResourceBufferEntry> = rowsOf(
      path.join(FIXTURES, release, "healthy", "exporter"),
    );
    const stable: Array<OpenStackResourceBufferEntry> = rowsOf(
      path.join(FIXTURES, release, "healthy", "exporter-stable"),
    );

    test("the kinds that have no row at all", () => {
      const had: Set<OpenStackResourceKind> = kindsOf(pinned);
      const has: Set<OpenStackResourceKind> = kindsOf(stable);

      expect(
        Array.from(had)
          .filter((kind: OpenStackResourceKind): boolean => {
            return !has.has(kind);
          })
          .sort(),
      ).toEqual([
        OpenStackResourceKind.Domain,
        OpenStackResourceKind.StoragePool,
        OpenStackResourceKind.Volume,
      ]);
    });

    test("Cinder's API and workers, and nothing else of the kinds it still has", () => {
      const stableIds: Set<string> = new Set(stable.map(idOf));

      const missing: Array<string> = pinned
        .filter((row: OpenStackResourceBufferEntry): boolean => {
          return (
            !stableIds.has(idOf(row)) &&
            (row.kind === OpenStackResourceKind.Api ||
              row.kind === OpenStackResourceKind.Service)
          );
        })
        .map((row: OpenStackResourceBufferEntry): string => {
          return row.kind === OpenStackResourceKind.Api
            ? `Api/${row.name}`
            : `Service/${row.name}`;
        })
        .sort();

      expect(missing).toEqual([
        "Api/volume",
        "Service/cinder-scheduler",
        "Service/cinder-volume",
      ]);

      // Everything but those is there, row for row.
      for (const row of pinned) {
        if (
          row.kind !== OpenStackResourceKind.Domain &&
          row.kind !== OpenStackResourceKind.StoragePool &&
          row.kind !== OpenStackResourceKind.Volume &&
          !missing.includes(`${row.kind}/${row.name}`)
        ) {
          expect(stableIds.has(idOf(row))).toBe(true);
        }
      }
    });

    test("what a row it still has no longer says", () => {
      const lost: Record<string, Array<string>> = lostFromRows({
        pinned,
        stable,
      });

      // Set by the scan once a status is read: it is the status that is missing.
      delete lost["Image"]?.[
        lost["Image"]?.indexOf("statusObservedAt") as number
      ];

      expect(lost).toEqual({
        Hypervisor: ["facts.aggregates", "instanceCount"],
        Image: [
          "facts.createdAtSeconds",
          "facts.isHidden",
          "facts.visibility",
          "status",
        ],
        Network: ["facts.mtu"],
      });
    });

    test("a hypervisor's capacity is still there, from Placement", () => {
      const hypervisor: OpenStackResourceBufferEntry | undefined = stable.find(
        (row: OpenStackResourceBufferEntry): boolean => {
          return row.kind === OpenStackResourceKind.Hypervisor;
        },
      );

      expect(hypervisor?.vcpuCapacity).toBeGreaterThan(0);
      expect(hypervisor?.memoryCapacityBytes).toBeGreaterThan(0);
      expect(hypervisor?.diskCapacityBytes).toBeGreaterThan(0);
    });
  });

  describe("the alerts that stay quiet", () => {
    /*
     * Those whose every series the pinned exporter said on these clouds, and 1.7.0 did not.
     * A template that reads nothing on either was not exercised by this comparison, so it
     * is not said to be lost.
     */
    const quietOn: (release: string) => Array<string> = (
      release: string,
    ): Array<string> => {
      const said: (folder: string) => Set<string> = (
        folder: string,
      ): Set<string> => {
        return new Set(
          seriesOf(path.join(FIXTURES, release, "healthy", folder)).map(
            (series: Series): string => {
              return series.metricName;
            },
          ),
        );
      };
      const pinned: Set<string> = said("exporter");
      const stable: Set<string> = said("exporter-stable");

      return getAllOpenStackAlertTemplates()
        .filter((template: OpenStackAlertTemplate): boolean => {
          const reads: Array<string> = seriesTemplateReads(template);
          return (
            reads.length > 0 &&
            reads.some((name: string): boolean => {
              return pinned.has(name);
            }) &&
            !reads.some((name: string): boolean => {
              return stable.has(name);
            })
          );
        })
        .map((template: OpenStackAlertTemplate): string => {
          return template.name;
        })
        .sort();
    };

    const QUIET: ReadonlyArray<string> = [
      "Block Storage API Down",
      "Block Storage Service Down",
      "Storage Pool Critical",
      "Storage Pool Warning",
      "Volume Stuck",
      "Volumes in Error",
    ];

    test.each(RELEASES)("%s reads none of these", (release: string) => {
      expect(quietOn(release)).toEqual(QUIET);
    });

    test.each(WHERE_IT_IS_SAID)("%s names each of them", (file: string) => {
      const text: string = fs.readFileSync(
        path.join(REPO_ROOT, file),
        "utf8",
      );

      for (const name of QUIET) {
        expect(text).toContain(name);
      }
    });
  });

  test.each(WHERE_IT_IS_SAID)(
    "%s says each thing the pages go without",
    (file: string) => {
      const text: string = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");

      for (const words of [
        "`volumev3`",
        "**Volumes**",
        "**Storage pools**",
        "**Domains**",
        "`cinder-volume`",
        "`cinder-scheduler`",
        "How many instances a hypervisor holds",
        "aggregates",
        "An image's status, visibility and creation date",
        "A network's MTU",
      ]) {
        expect(text).toContain(words);
      }
    },
  );
});
