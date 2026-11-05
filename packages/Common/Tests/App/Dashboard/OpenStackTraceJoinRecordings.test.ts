import { describe, expect, test } from "@jest/globals";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "../../../Types/JSON";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_NODE_RESOURCE_ATTRIBUTE,
  OPENSTACK_TRACE_RESOURCE_ATTRIBUTES,
  getOpenStackTracedServiceOfApi,
  normalizeOSProfilerResourceInPlace,
  readOpenStackRequestResources,
} from "../../../Utils/OpenStack/OpenStackTraces";
import { OpenStackRecording } from "../../Helpers/OpenStackRecordings";
import {
  OpenStackTraceRecording,
  getRecordedTraceReleases,
} from "../../Helpers/OpenStackTraceRecordings";
import { findOpenStackServiceRow } from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackTraceContext";
import { getOpenStackPartTracedService } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPartTraces";

/*
 * A real trace's services, joined to the rows a real cloud's exporter made, on the same release.
 * "Services named by OpenStack service and joined to their OpenStackResource" stands or falls on
 * the words the two use for the same thing, and neither was written by anyone here.
 */

interface TracedService {
  service: string;
  host: string;
}

function servicesOfBoot(
  recording: OpenStackTraceRecording,
): Array<TracedService> {
  const found: Map<string, TracedService> = new Map();
  const otlp: JSONObject = recording.otlp("signed-boot", "agent");

  for (const block of otlp["resourceSpans"] as Array<JSONObject>) {
    const service: string = normalizeOSProfilerResourceInPlace(block)!.service;
    const attributes: Array<JSONObject> = (block["resource"] as JSONObject)[
      "attributes"
    ] as Array<JSONObject>;
    const host: string = (
      attributes.find((attribute: JSONObject): boolean => {
        return attribute["key"] === OPENSTACK_NODE_RESOURCE_ATTRIBUTE;
      })!["value"] as JSONObject
    )["stringValue"] as string;

    found.set(service, { service, host });
  }

  return Array.from(found.values());
}

describe.each(getRecordedTraceReleases())(
  "a real boot's services on %s, against the same release's inventory",
  (release: string) => {
    const recording: OpenStackTraceRecording = new OpenStackTraceRecording(
      release,
    );
    const rows: Array<OpenStackResource> = new OpenStackRecording(
      release,
      "healthy",
    ).rows;

    test.each([
      ["nova-api", "compute"],
      ["keystone", "identity"],
      ["neutron-server", "network"],
      ["glance-api", "image"],
    ])("%s goes to the row of the %s API", (service: string, type: string) => {
      if (service === "neutron-server" && recording.neutronWasLeftOut()) {
        return;
      }

      const traced: TracedService | undefined = servicesOfBoot(recording).find(
        (candidate: TracedService): boolean => {
          return candidate.service === service;
        },
      );

      expect(traced).toBeDefined();

      const row: OpenStackResource | null = findOpenStackServiceRow({
        service: service,
        host: traced!.host,
        rows: rows,
      });

      expect(row?.kind).toBe(OpenStackResourceKind.Api);
      expect(row?.name).toBe(type);
    });

    test("nova-compute goes to its worker's row, on the machine that sent it", () => {
      const traced: TracedService = servicesOfBoot(recording).find(
        (candidate: TracedService): boolean => {
          return candidate.service === "nova-compute";
        },
      )!;
      const row: OpenStackResource | null = findOpenStackServiceRow({
        service: "nova-compute",
        host: traced.host,
        rows: rows,
      });

      expect(row?.kind).toBe(OpenStackResourceKind.Service);
      expect(row?.name).toBe("nova-compute");
      expect(row?.externalId).toContain(traced.host);
    });

    test("every API a part's page has knows the word a trace uses for it", () => {
      for (const row of rows.filter((candidate: OpenStackResource) => {
        return candidate.kind === OpenStackResourceKind.Api;
      })) {
        const traced: string = getOpenStackTracedServiceOfApi(row.name || "");

        if (traced) {
          expect(
            getOpenStackPartTracedService(
              { kind: OpenStackResourceKind.Api },
              row,
            ),
          ).toBe(traced);
        }
      }
    });

    /*
     * A part's page finds its traces by a key made of its external id, and a trace by the id in
     * a request's path. So each kind's row has to call a thing what a request calls it.
     */
    test("a part's id is what a request calls it, for every kind a span can name", () => {
      const kinds: Array<OpenStackResourceKind> =
        OPENSTACK_TRACE_RESOURCE_ATTRIBUTES.map(
          (known: { kind: OpenStackResourceKind }) => {
            return known.kind;
          },
        );
      const seen: Set<OpenStackResourceKind> = new Set();

      for (const row of rows) {
        const kind: OpenStackResourceKind = row.kind as OpenStackResourceKind;

        if (!kinds.includes(kind)) {
          continue;
        }

        seen.add(kind);

        const collection: string = {
          [OpenStackResourceKind.Instance]: "servers",
          [OpenStackResourceKind.Volume]: "volumes",
          [OpenStackResourceKind.Snapshot]: "snapshots",
          [OpenStackResourceKind.Backup]: "backups",
          [OpenStackResourceKind.Network]: "networks",
          [OpenStackResourceKind.Subnet]: "subnets",
          [OpenStackResourceKind.Router]: "routers",
          [OpenStackResourceKind.FloatingIp]: "floatingips",
          [OpenStackResourceKind.Image]: "images",
          [OpenStackResourceKind.Project]: "projects",
        }[kind as string] as string;

        expect(
          readOpenStackRequestResources({
            path: `/v1/${collection}/${row.externalId}`,
          }),
        ).toEqual([{ kind: kind, id: row.externalId }]);
      }

      expect(seen.has(OpenStackResourceKind.Instance)).toBe(true);
      expect(seen.has(OpenStackResourceKind.Network)).toBe(true);
    });

    test("the inventory has the services a stock trace leaves out, so a page can name them", () => {
      const names: Array<string> = rows.map(
        (row: OpenStackResource): string => {
          return row.name || "";
        },
      );

      expect(names).toEqual(
        expect.arrayContaining([
          "nova-conductor",
          "nova-scheduler",
          "cinder-volume",
          "placement",
        ]),
      );
    });
  },
);
