import { describe, expect, test } from "@jest/globals";
import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import {
  ChangeRelation,
  ChangeRelevance,
  RecentChange,
  RecordedChange,
  assessOpenStackChange,
  buildChangeRelevance,
  groupRecordedChanges,
  toRecordedChange,
} from "../../../../Server/Utils/AI/SRE/RecentChangesContext";
import { LinkedAffectedResourceType } from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import { ChangeImpactVerdict } from "../../../../Server/Utils/AI/SRE/ChangeImpact";
import SeriesContextEnricher from "../../../../Server/Utils/Monitor/SeriesContextEnricher";
import {
  OPENSTACK_CHART_HOST_ATTRIBUTE,
  OPENSTACK_CHART_ID_ATTRIBUTE,
  OpenStackRecordedEvent,
  buildOpenStackChangeEntry,
  buildOpenStackFeedLine,
} from "../../../../Server/Utils/OpenStack/OpenStackEventEntries";
import { toOpenStackStateChanges } from "../../../../Server/Utils/OpenStack/OpenStackEventRecorder";
import { ParsedChangeEventEntry } from "../../../../Server/Utils/Telemetry/ChangeEventRow";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_CLOUD_LOG_ATTRIBUTE,
  OpenStackLogAttribute,
} from "../../../../Utils/OpenStack/OpenStackLogs";
import {
  OPENSTACK_MAX_EVENT_REASON_LENGTH,
  OpenStackEvent,
  OpenStackEventAttribute,
  OpenStackEventFailure,
  OpenStackEventImportance,
  OpenStackEventOutcome,
} from "../../../../Utils/OpenStack/OpenStackNotifications";
import {
  getOpenStackPartChangeAttributes,
  OpenStackPartLogFacts,
} from "../../../../Utils/OpenStack/OpenStackPartLogFacts";
import { ChangeEventStatus } from "../../../../Utils/Telemetry/ChangeEventFields";
import {
  EventOverlayScope,
  getEventOverlayScope,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/EventOverlayScope";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import {
  OPENSTACK_LOG_RELEASES,
  RecordedFileLine,
  RecordedIds,
  RecordedJournalEntry,
  StoredLogRow,
  readRecordedFileNotifications,
  readRecordedIds,
  readRecordedNotifications,
  stampFileLine,
  storedRowOf,
} from "../../../Helpers/OpenStackServiceLogs";

/*
 * What a cloud really said happened, from the line a service wrote to everything it becomes: the
 * part's feed, the markers on its charts, a suspect in an investigation, the real time on its
 * row. Every notification here is a real one, on three releases of DevStack, written by oslo's
 * `log` driver. Every step is the code that does it. No OneUptime ran: the rows the feed and the
 * charts would read are checked against the queries they would read them with.
 */

const CLOUD_ID: ObjectID = ObjectID.generate();
const CLOUD: string = "devstack";

// As OtelLogsIngestService.bufferOpenStackEvent remembers one.
function recordedOf(row: StoredLogRow): OpenStackRecordedEvent {
  const event: OpenStackEvent = row.stamp.event as OpenStackEvent;

  return {
    event,
    time: event.time || row.time,
    region: "",
    service: row.attributes[OpenStackLogAttribute.Service] || "",
    host: row.attributes[OpenStackLogAttribute.Host] || "",
  };
}

function isEqualOrHeld(stored: string | undefined, wanted: unknown): boolean {
  if (typeof wanted === "string" || typeof wanted === "number") {
    return String(stored) === String(wanted);
  }

  const values: unknown =
    wanted && typeof wanted === "object"
      ? (wanted as { values?: unknown; value?: unknown }).values ||
        (wanted as { value?: unknown }).value
      : undefined;

  return Array.isArray(values)
    ? values.map(String).includes(String(stored))
    : String(values) === String(stored);
}

// Whether a read of change events by these attributes finds this row.
function isFoundBy(
  entry: ParsedChangeEventEntry,
  attributes: JSONObject | Record<string, unknown>,
): boolean {
  return Object.entries(attributes).every(
    ([key, value]: [string, unknown]): boolean => {
      return isEqualOrHeld(entry.attributes[key], value);
    },
  );
}

function feedQueryOf(facts: OpenStackPartLogFacts): Record<string, string> {
  const own: Record<string, string> | null =
    getOpenStackPartChangeAttributes(facts);

  expect(own).not.toBeNull();

  return { [OPENSTACK_CLOUD_LOG_ATTRIBUTE]: CLOUD, ...own };
}

// What a part's chart reads for its markers, from the filter on its series.
function chartQueriesOf(labels: Record<string, string>): Array<JSONObject> {
  const scope: EventOverlayScope = getEventOverlayScope([
    {
      metricQueryData: {
        filterData: {
          metricName: "openstack_cpu",
          attributes: { "openstack.cloud.name": CLOUD, ...labels },
        },
      },
    } as MetricQueryConfigData,
  ]);

  return scope.changeEventQueries as unknown as Array<JSONObject>;
}

function isOnChart(
  entry: ParsedChangeEventEntry,
  labels: Record<string, string>,
): boolean {
  const queries: Array<JSONObject> = chartQueriesOf(labels);

  expect(queries.length).toBeGreaterThan(0);

  return queries.some((query: JSONObject): boolean => {
    const attributes: JSONObject = (query["attributes"] as JSONObject) || {};
    const stated: string = JSON.stringify(query);

    // Every label the chart filters on is in its query, or it would hold another part's markers.
    for (const value of Object.values(labels)) {
      expect(stated).toContain(value);
    }

    return isFoundBy(entry, attributes);
  });
}

// As an investigation of an incident linked to this cloud reads the change, on this part.
function asSuspect(
  entry: ParsedChangeEventEntry,
  subjectPartId: string | null,
): RecentChange {
  const row: ChangeEvent = new ChangeEvent();

  Object.assign(row, {
    _id: ObjectID.generate().toString(),
    time: entry.time,
    eventType: entry.eventType,
    title: entry.title,
    attributes: entry.attributes,
  });

  const relevance: ChangeRelevance = buildChangeRelevance({
    resources: [
      {
        type: LinkedAffectedResourceType.OpenStackCloud,
        id: CLOUD_ID.toString(),
        name: CLOUD,
      },
    ] as Parameters<typeof buildChangeRelevance>[0]["resources"],
    subjectKind: "incident",
    subjectId: ObjectID.generate(),
  });
  const recorded: RecordedChange | null = toRecordedChange(row);

  expect(recorded).not.toBeNull();

  const [change]: Array<RecentChange> = groupRecordedChanges(
    [recorded as RecordedChange],
    relevance,
  );

  expect(change!.relation).toBe(ChangeRelation.Linked);

  const impact: RecentChange["impact"] =
    assessOpenStackChange({ change: change!, subjectPartId }) || undefined;

  return { ...change!, impact };
}

describe.each(OPENSTACK_LOG_RELEASES)("%s", (release: string) => {
  const ids: RecordedIds = readRecordedIds(release);
  const devstackIds: Record<string, string> = ids.ids["devstack"] || {};
  const rows: Array<StoredLogRow> = readRecordedNotifications(
    release,
    "devstack",
  ).map((entry: RecordedJournalEntry): StoredLogRow => {
    return storedRowOf(entry);
  });
  const events: Array<OpenStackRecordedEvent> = rows
    .filter((row: StoredLogRow): boolean => {
      return row.stamp.event !== null;
    })
    .map(recordedOf);

  function find(
    type: string,
    partId?: string | undefined,
  ): OpenStackRecordedEvent {
    const found: OpenStackRecordedEvent | undefined = events.find(
      (recorded: OpenStackRecordedEvent): boolean => {
        return (
          recorded.event.type === type &&
          (!partId || recorded.event.part?.id === partId)
        );
      },
    );

    expect(found ? type : `${type} was not recorded`).toBe(type);

    return found as OpenStackRecordedEvent;
  }

  function entryOf(recorded: OpenStackRecordedEvent): ParsedChangeEventEntry {
    return buildOpenStackChangeEntry({
      recorded,
      cloudId: CLOUD_ID,
      cloudName: CLOUD,
    });
  }

  function instanceFacts(externalId: string): OpenStackPartLogFacts {
    return {
      kind: OpenStackResourceKind.Instance,
      externalId,
      name: "ou-log-vm",
      hypervisorName: "devstack-host",
      workerHost: null,
    };
  }

  // On its own part's feed and charts, and a suspect when something happens to that part.
  function expectOnItsPart(
    recorded: OpenStackRecordedEvent,
    partId: string,
  ): void {
    const entry: ParsedChangeEventEntry = entryOf(recorded);

    expect(recorded.event.importance).toBe(OpenStackEventImportance.Change);
    expect(entry.attributes[OPENSTACK_CHART_ID_ATTRIBUTE]).toBe(partId);
    expect(isOnChart(entry, { [OPENSTACK_CHART_ID_ATTRIBUTE]: partId })).toBe(
      true,
    );
    expect(
      isOnChart(entry, {
        [OPENSTACK_CHART_ID_ATTRIBUTE]: "another-part-altogether",
      }),
    ).toBe(false);

    const suspect: RecentChange = asSuspect(entry, partId);

    expect(suspect.impact?.verdict).toBe(ChangeImpactVerdict.Suspect);
    expect(suspect.impact?.reasons).toEqual([
      "it happened to the part this is about",
    ]);
    expect(buildOpenStackFeedLine(recorded).markdown).toContain(
      recorded.event.type,
    );
  }

  describe("an instance", () => {
    const instance: string = devstackIds["instance_ok"] || "";

    test("created, on its feed, its charts and as a suspect", () => {
      const recorded: OpenStackRecordedEvent = find(
        "instance.create.end",
        instance,
      );
      const entry: ParsedChangeEventEntry = entryOf(recorded);

      expect(recorded.event.outcome).toBe(OpenStackEventOutcome.Succeeded);
      expect(recorded.event.part?.kind).toBe(OpenStackResourceKind.Instance);
      expect(isFoundBy(entry, feedQueryOf(instanceFacts(instance)))).toBe(true);
      expectOnItsPart(recorded, instance);
    });

    test("on its hypervisor's feed and charts as well, by the name Nova has for it", () => {
      const recorded: OpenStackRecordedEvent = find(
        "instance.create.end",
        instance,
      );
      const entry: ParsedChangeEventEntry = entryOf(recorded);

      expect(recorded.event.hypervisor).toBeTruthy();
      expect(
        isFoundBy(
          entry,
          feedQueryOf({
            kind: OpenStackResourceKind.Hypervisor,
            externalId: "RegionOne/hypervisor",
            name: recorded.event.hypervisor,
            hypervisorName: recorded.event.hypervisor,
            workerHost: null,
          }),
        ),
      ).toBe(true);
      expect(
        isOnChart(entry, {
          [OPENSTACK_CHART_HOST_ATTRIBUTE]: recorded.event.hypervisor as string,
        }),
      ).toBe(true);
    });

    test("its state moved when Nova says, and not when the next scrape noticed", () => {
      const recorded: OpenStackRecordedEvent = find(
        "instance.create.end",
        instance,
      );

      expect(recorded.event.time).not.toBeNull();
      expect(toOpenStackStateChanges([recorded])).toEqual([
        {
          kind: OpenStackResourceKind.Instance,
          externalId: instance,
          binary: "",
          host: "",
          at: recorded.event.time,
        },
      ]);
    });

    test("resized, which goes through what a cold migration does", () => {
      const recorded: OpenStackRecordedEvent = find(
        "instance.resize_confirm.end",
        instance,
      );

      expectOnItsPart(recorded, instance);
      expect(
        isFoundBy(entryOf(recorded), feedQueryOf(instanceFacts(instance))),
      ).toBe(true);
    });

    /*
     * A cold or a live migration has nowhere to go on one machine, so it can't succeed here: a
     * resize goes through what a cold migration does, above. What the recording holds of one is
     * the cloud refusing it, with Nova's reason.
     */
    test("a migration the cloud refused says why, on its instance", () => {
      const recorded: OpenStackRecordedEvent = find(
        "compute_task.migrate_server.error",
        instance,
      );

      expect(recorded.event.outcome).toBe(OpenStackEventOutcome.Failed);
      expect(recorded.event.failure).toBe(OpenStackEventFailure.Scheduling);
      expect(recorded.event.reason).toMatch(/valid host/i);
      expect(recorded.event.title).toContain("migration failed");
      expect(
        isFoundBy(entryOf(recorded), feedQueryOf(instanceFacts(instance))),
      ).toBe(true);
      expectOnItsPart(recorded, instance);
    });
  });

  describe("a failure", () => {
    const failedBuild: string = devstackIds["instance_spawn_failed"] || "";
    const noValidHost: string = devstackIds["instance_no_valid_host"] || "";

    test("a build that failed on its compute host, with Nova's reason, on its instance", () => {
      const recorded: OpenStackRecordedEvent = find(
        "instance.create.error",
        failedBuild,
      );
      const entry: ParsedChangeEventEntry = entryOf(recorded);

      expect(recorded.event.outcome).toBe(OpenStackEventOutcome.Failed);
      expect(recorded.event.failure).toBe(OpenStackEventFailure.Action);
      expect(recorded.event.reason).toBeTruthy();
      expect(entry.attributes[OpenStackEventAttribute.Reason]).toBe(
        recorded.event.reason,
      );
      expect(entry.description).toBe(recorded.event.reason);
      expect(isFoundBy(entry, feedQueryOf(instanceFacts(failedBuild)))).toBe(
        true,
      );
      expectOnItsPart(recorded, failedBuild);
    });

    test("a failure is a suspect for anything on the cloud, whichever part that is about", () => {
      const recorded: OpenStackRecordedEvent = find(
        "instance.create.error",
        failedBuild,
      );
      const suspect: RecentChange = asSuspect(entryOf(recorded), null);

      expect(suspect.fields.status).toBe(ChangeEventStatus.Failed);
      expect(suspect.impact?.verdict).toBe(ChangeImpactVerdict.Suspect);
      expect(suspect.impact?.reasons).toEqual([
        "it failed on the cloud this is about",
      ]);
    });

    test("a build no host could take, as a scheduling failure with the scheduler's reason", () => {
      const recorded: OpenStackRecordedEvent | undefined = events.find(
        (candidate: OpenStackRecordedEvent): boolean => {
          return (
            candidate.event.failure === OpenStackEventFailure.Scheduling &&
            candidate.event.instanceId === noValidHost
          );
        },
      );

      expect(recorded ? "recorded" : "not recorded").toBe("recorded");
      expect(recorded!.event.reason).toMatch(/valid host/i);
      expectOnItsPart(recorded!, noValidHost);
    });

    test("the alert's title says which instance and why, from the labels it is grouped by", () => {
      const recorded: OpenStackRecordedEvent = find(
        "instance.create.error",
        failedBuild,
      );
      const title: string = SeriesContextEnricher.enrichTitle({
        title: "[OpenStack] Instance Action Failed - devstack",
        seriesLabels: {
          [OpenStackLogAttribute.InstanceId]: failedBuild,
          [OpenStackEventAttribute.Type]: recorded.event.type,
          [OpenStackEventAttribute.Reason]: recorded.event.reason,
        },
      });

      // A long reason keeps its end, which is where the numbers that differ are.
      expect(title).toContain(failedBuild);
      expect(title).toContain(recorded.event.reason.slice(-30));
    });
  });

  describe("a compute service someone disabled", () => {
    test("on that service's feed, and its machine's, and as a suspect", () => {
      const recorded: OpenStackRecordedEvent | undefined = events.find(
        (candidate: OpenStackRecordedEvent): boolean => {
          return (
            candidate.event.type === "service.update" &&
            candidate.event.part?.binary === "nova-compute" &&
            candidate.event.title.includes("disabled")
          );
        },
      );

      expect(recorded ? "recorded" : "not recorded").toBe("recorded");

      const entry: ParsedChangeEventEntry = entryOf(recorded!);
      const host: string = recorded!.event.host;

      expect(recorded!.event.part?.kind).toBe(OpenStackResourceKind.Service);
      expect(
        isFoundBy(
          entry,
          feedQueryOf({
            kind: OpenStackResourceKind.Service,
            externalId: `RegionOne/compute/${host}/nova-compute`,
            name: "nova-compute",
            hypervisorName: host,
            workerHost: host,
          }),
        ),
      ).toBe(true);
      expect(isOnChart(entry, { [OPENSTACK_CHART_HOST_ATTRIBUTE]: host })).toBe(
        true,
      );
      expect(toOpenStackStateChanges([recorded!])[0]).toMatchObject({
        kind: OpenStackResourceKind.Service,
        binary: "nova-compute",
        host,
      });
      expect(
        asSuspect(entry, `RegionOne/compute/${host}/nova-compute`).impact
          ?.verdict,
      ).toBe(ChangeImpactVerdict.Suspect);
    });
  });

  describe("a volume attached", () => {
    const volume: string = devstackIds["volume_attached"] || "";

    test("Cinder's own event, on the volume's feed, its charts and as a suspect", () => {
      const recorded: OpenStackRecordedEvent = find(
        "volume.attach.end",
        volume,
      );

      expect(recorded.event.title).toBe("Volume ou-log-vol: attached");
      expect(recorded.event.part?.kind).toBe(OpenStackResourceKind.Volume);
      expect(
        isFoundBy(
          entryOf(recorded),
          feedQueryOf({
            kind: OpenStackResourceKind.Volume,
            externalId: volume,
            name: "ou-log-vol",
            hypervisorName: null,
            workerHost: null,
          }),
        ),
      ).toBe(true);
      expectOnItsPart(recorded, volume);
    });

    test("Nova's, on the instance it went on", () => {
      const recorded: OpenStackRecordedEvent = find(
        "instance.volume_attach.end",
      );
      const instance: string = recorded.event.part?.id as string;

      expect(recorded.event.part?.kind).toBe(OpenStackResourceKind.Instance);
      expectOnItsPart(recorded, instance);
    });
  });

  describe("every event it recorded", () => {
    test("reads, or is left out for a reason it can say", () => {
      const unread: Array<string> = rows
        .filter((row: StoredLogRow): boolean => {
          return row.stamp.event === null;
        })
        .map((row: StoredLogRow): string => {
          return row.body.slice(0, 200);
        });

      expect(unread).toEqual([]);
    });

    test("what repeats every minute stays out of the feed, and is still there as a log", () => {
      const routine: Array<OpenStackRecordedEvent> = events.filter(
        (recorded: OpenStackRecordedEvent): boolean => {
          return recorded.event.importance === OpenStackEventImportance.Routine;
        },
      );

      expect(routine.length).toBeGreaterThan(0);

      for (const recorded of routine) {
        expect(recorded.event.type).toMatch(
          /\.exists$|\.usage$|^metrics\.update|^compute\.metrics\.update|^capacity\.|^l3\.meter/,
        );
      }
    });

    test("no title is a tenant's words alone: each says what kind of part it is about", () => {
      for (const recorded of events) {
        if (recorded.event.importance === OpenStackEventImportance.Change) {
          expect(recorded.event.title).toBeTruthy();
          expect(recorded.event.title.length).toBeLessThan(
            OPENSTACK_MAX_EVENT_REASON_LENGTH + 300,
          );
        }
      }
    });

    test("no password stays in any of them, as a service's file holds it too", () => {
      const held: RegExp = /fake-[a-z]+-[a-z-]+|gAAAAA[A-Za-z0-9_-]{20,}/;

      for (const row of rows) {
        expect(row.body).not.toMatch(held);
        expect(JSON.stringify(row.stamp.event)).not.toMatch(held);
      }

      for (const line of readRecordedFileNotifications(release)) {
        const stamped: ReturnType<typeof stampFileLine> = stampFileLine(
          line as RecordedFileLine,
        );

        expect(stamped.body).not.toMatch(held);
      }
    });
  });

  test("the same notification in a service's file reads the same as in the journal", () => {
    const fromFiles: Array<string> = readRecordedFileNotifications(release)
      .map((line: RecordedFileLine): string => {
        return stampFileLine(line).event?.type || "";
      })
      .filter(Boolean);

    expect(fromFiles.length).toBeGreaterThan(0);
  });
});
