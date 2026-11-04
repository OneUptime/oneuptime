import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import {
  buildFivetranRunEvent,
  FivetranSyncEvent,
  findSchemaTables,
  getFivetranRunState,
  isSignedByFivetran,
  readAirbyteRunEvents,
  readFivetranSyncEvent,
  toRunId,
} from "../../../../Server/Utils/DataObservability/SyncWebhooks";
import {
  OpenLineageRunEvent,
  OpenLineageRunState,
  readOpenLineageEvents,
} from "../../../../Server/Utils/DataObservability/OpenLineageEvent";
import {
  isFailedState,
  isFinalState,
  ProjectCatalog,
} from "../../../../Server/Utils/DataObservability/OpenLineageIngest";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";

/*
 * FIVETRAN AND AIRBYTE SYNCS, AS PIPELINE RUNS.
 *
 * A Fivetran delivery is taken only when it is signed with the ingestion
 * key its URL names; each sync's start and end, and each Airbyte sync's
 * end, become a run of the connector's pipeline; a sync Fivetran
 * rescheduled ends as neither a success nor a failure; and a Fivetran
 * connector's schema, in exactly one watched database, is what it writes.
 */

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");
const KEY: string = "8b1c2d3e-4f50-4a6b-9c7d-8e9f0a1b2c3d";
const SYNC_ID: string = "5D3B8F2A-1C4E-4B6A-9F0D-2E7C1A9B3D5F";

function fivetranDelivery(extra: Record<string, unknown> = {}): unknown {
  return {
    event: "sync_end",
    created: "2026-11-03T11:58:00.000Z",
    connector_type: "salesforce",
    connector_id: "mystified_presiding",
    connector_name: "salesforce",
    sync_id: SYNC_ID,
    destination_group_id: "deck_enjoy",
    data: { status: "SUCCESSFUL" },
    ...extra,
  };
}

function sign(body: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex")
    .toUpperCase();
}

describe("a Fivetran delivery's signature", () => {
  const body: string = JSON.stringify(fivetranDelivery());

  test("is Fivetran's HMAC-SHA256 of the body with the key, in hex of either case", () => {
    expect(
      isSignedByFivetran({
        rawBody: body,
        signature: sign(body, KEY),
        secret: KEY,
      }),
    ).toBe(true);
    expect(
      isSignedByFivetran({
        rawBody: body,
        signature: sign(body, KEY).toLowerCase(),
        secret: KEY,
      }),
    ).toBe(true);
    expect(
      isSignedByFivetran({
        rawBody: body,
        signature: [`sha256=${sign(body, KEY)}`],
        secret: KEY,
      }),
    ).toBe(true);
  });

  test("another key, a changed body, or no signature is refused", () => {
    expect(
      isSignedByFivetran({
        rawBody: body,
        signature: sign(body, "another-key"),
        secret: KEY,
      }),
    ).toBe(false);
    expect(
      isSignedByFivetran({
        rawBody: body.replace("SUCCESSFUL", "FAILURE"),
        signature: sign(body, KEY),
        secret: KEY,
      }),
    ).toBe(false);
    expect(
      isSignedByFivetran({ rawBody: body, signature: undefined, secret: KEY }),
    ).toBe(false);
    expect(
      isSignedByFivetran({ rawBody: body, signature: "abc", secret: KEY }),
    ).toBe(false);
    expect(
      isSignedByFivetran({
        rawBody: body,
        signature: sign(body, ""),
        secret: "",
      }),
    ).toBe(false);
  });
});

describe("a Fivetran sync", () => {
  test("its start and end are read; any other event is no sync", () => {
    const event: FivetranSyncEvent | null = readFivetranSyncEvent(
      fivetranDelivery({ event: "sync_start", data: {} }),
      NOW,
    );

    expect(event).toMatchObject({
      event: "sync_start",
      connectorId: "mystified_presiding",
      connectorName: "salesforce",
      connectorType: "salesforce",
      destinationGroupId: "deck_enjoy",
      syncId: SYNC_ID,
      status: null,
    });
    expect(event?.at).toEqual(new Date("2026-11-03T11:58:00.000Z"));
    expect(
      readFivetranSyncEvent(
        fivetranDelivery({ event: "pause_connector" }),
        NOW,
      ),
    ).toBe(null);
    expect(readFivetranSyncEvent({ event: "test" }, NOW)).toBe(null);
    expect(readFivetranSyncEvent("not json", NOW)).toBe(null);
  });

  test("a connection, as newer payloads name a connector, reads the same", () => {
    const event: FivetranSyncEvent | null = readFivetranSyncEvent(
      {
        event: "sync_end",
        created: "2026-11-03T11:58:00.000Z",
        connection_id: "mystified_presiding",
        connection_name: "salesforce",
        group_id: "deck_enjoy",
        sync_id: SYNC_ID,
        data: { status: "successful" },
      },
      NOW,
    );

    expect(event?.connectorId).toBe("mystified_presiding");
    expect(event?.destinationGroupId).toBe("deck_enjoy");
    expect(event?.status).toBe("SUCCESSFUL");
  });

  test("a time far from now is the tool's clock: the event is taken as now", () => {
    expect(
      readFivetranSyncEvent(
        fivetranDelivery({ created: "2001-01-01T00:00:00Z" }),
        NOW,
      )?.at,
    ).toEqual(NOW);
  });

  test("ends: successful completes, rescheduled is neither, anything else fails with its reason", () => {
    const at: FivetranSyncEvent = readFivetranSyncEvent(
      fivetranDelivery(),
      NOW,
    )!;

    expect(getFivetranRunState({ ...at, event: "sync_start" })).toBe(
      OpenLineageRunState.Start,
    );
    expect(getFivetranRunState(at)).toBe(OpenLineageRunState.Complete);
    expect(getFivetranRunState({ ...at, status: "RESCHEDULED" })).toBe(
      OpenLineageRunState.Rescheduled,
    );
    expect(getFivetranRunState({ ...at, status: "FAILURE_WITH_TASK" })).toBe(
      OpenLineageRunState.Fail,
    );

    expect(
      buildFivetranRunEvent({
        ...at,
        status: "FAILURE_WITH_TASK",
        reason: "Invalid credentials",
      }).errorMessage,
    ).toBe("Invalid credentials");
    expect(
      buildFivetranRunEvent({ ...at, status: "FAILURE", reason: null })
        .errorMessage,
    ).toBe("Fivetran ended the sync failure.");
    expect(
      buildFivetranRunEvent({
        ...at,
        status: "RESCHEDULED",
        reason: "API quota exceeded",
      }).errorMessage,
    ).toBe("Rescheduled by Fivetran: API quota exceeded");
    expect(buildFivetranRunEvent(at).errorMessage).toBe(null);
  });

  test("a run of the connector's pipeline in its destination, its id the sync's", () => {
    const start: OpenLineageRunEvent = buildFivetranRunEvent(
      readFivetranSyncEvent(fivetranDelivery({ event: "sync_start" }), NOW)!,
    );
    const end: OpenLineageRunEvent = buildFivetranRunEvent(
      readFivetranSyncEvent(fivetranDelivery(), NOW)!,
      ["asset-1", "asset-2"],
    );

    expect(start.jobNamespace).toBe("fivetran://deck_enjoy");
    expect(start.jobName).toBe("salesforce");
    expect(start.runId).toBe(SYNC_ID.toLowerCase());
    expect(end.runId).toBe(start.runId);
    expect(end.outputDataAssetIds).toEqual(["asset-1", "asset-2"]);
  });
});

describe("a run's id", () => {
  test("a tool's UUID is kept; anything else becomes the same UUID every time", () => {
    expect(toRunId(SYNC_ID)).toBe(SYNC_ID.toLowerCase());

    const derived: string = toRunId("airbyte:connection-1:9988");

    expect(derived).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(toRunId("airbyte:connection-1:9988")).toBe(derived);
    expect(toRunId("airbyte:connection-1:9989")).not.toBe(derived);
  });
});

describe("what a Fivetran connector writes", () => {
  const catalog: (
    assets: Array<{ id: string; store: string; schema: string }>,
  ) => ProjectCatalog = (
    assets: Array<{ id: string; store: string; schema: string }>,
  ): ProjectCatalog => {
    return {
      stores: [
        {
          dataStoreId: "warehouse",
          kind: DataStoreKind.Snowflake,
          databaseName: "ANALYTICS",
          serverAddress: null,
        },
      ],
      storeNames: new Map(),
      assets: assets.map(
        (asset: { id: string; store: string; schema: string }) => {
          return {
            dataAssetId: asset.id,
            dataStoreId: asset.store,
            schemaName: asset.schema,
            name: asset.id,
          };
        },
      ),
    };
  };

  test("its schema's tables, in any case, when one watched database has the schema", () => {
    expect(
      findSchemaTables(
        catalog([
          { id: "account", store: "warehouse", schema: "SALESFORCE" },
          { id: "opportunity", store: "warehouse", schema: "SALESFORCE" },
          { id: "orders", store: "warehouse", schema: "PUBLIC" },
        ]),
        "salesforce",
      ),
    ).toEqual(["account", "opportunity"]);
  });

  test("nothing when two have it, or none does", () => {
    const twoWarehouses: ProjectCatalog = catalog([
      { id: "account", store: "warehouse", schema: "salesforce" },
      { id: "account-dev", store: "warehouse-dev", schema: "salesforce" },
    ]);

    expect(findSchemaTables(twoWarehouses, "salesforce")).toEqual([]);
    expect(findSchemaTables(twoWarehouses, "hubspot")).toEqual([]);
  });
});

describe("an Airbyte sync", () => {
  function notification(data: Record<string, unknown>): unknown {
    return {
      text: "Your connection Postgres to Snowflake succeeded",
      data: {
        workspace: { id: "workspace-1", name: "Data", url: "https://..." },
        connection: {
          id: "connection-1",
          name: "Postgres to Snowflake",
          url: "https://...",
        },
        source: { id: "source-1", name: "Postgres", url: "https://..." },
        destination: { id: "dest-1", name: "Snowflake", url: "https://..." },
        jobId: 9988,
        startedAt: "2026-11-03T11:00:00Z",
        finishedAt: "2026-11-03T11:20:00Z",
        recordsCommitted: 89,
        durationInSeconds: 1200,
        ...data,
      },
    };
  }

  test("a succeeded sync: a run of the connection's pipeline, started and completed", () => {
    const events: Array<OpenLineageRunEvent> = readAirbyteRunEvents(
      notification({ success: true }),
      NOW,
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      eventType: OpenLineageRunState.Start,
      jobNamespace: "airbyte://workspace-1",
      jobName: "Postgres to Snowflake",
      eventTime: new Date("2026-11-03T11:00:00Z"),
    });
    expect(events[1]).toMatchObject({
      eventType: OpenLineageRunState.Complete,
      eventTime: new Date("2026-11-03T11:20:00Z"),
      errorMessage: null,
    });
    expect(events[1]!.runId).toBe(events[0]!.runId);
    expect(events[0]!.runId).toBe(toRunId("airbyte:connection-1:9988"));
  });

  test("a failed sync fails with Airbyte's error, its type and origin", () => {
    const events: Array<OpenLineageRunEvent> = readAirbyteRunEvents(
      notification({
        success: false,
        errorMessage: "Something went wrong in the connector.",
        errorType: "config_error",
        errorOrigin: "source",
      }),
      NOW,
    );

    expect(events[1]).toMatchObject({
      eventType: OpenLineageRunState.Fail,
      errorMessage:
        "Something went wrong in the connector. (config_error, source)",
    });
  });

  test("with no start, the start is the end less the duration; a start after the end is the end", () => {
    expect(
      readAirbyteRunEvents(
        notification({ success: true, startedAt: undefined }),
        NOW,
      )[0]!.eventTime,
    ).toEqual(new Date("2026-11-03T11:00:00Z"));
    expect(
      readAirbyteRunEvents(
        notification({ success: true, startedAt: "2026-11-03T11:30:00Z" }),
        NOW,
      )[0]!.eventTime,
    ).toEqual(new Date("2026-11-03T11:20:00Z"));
  });

  test("a notification with no sync in it (text for Slack only) is no run", () => {
    expect(readAirbyteRunEvents({ text: "Sync disabled" }, NOW)).toEqual([]);
    expect(readAirbyteRunEvents(notification({ success: "yes" }), NOW)).toEqual(
      [],
    );
  });
});

describe("a rescheduled run", () => {
  test("has ended, and has not failed", () => {
    expect(isFinalState(OpenLineageRunState.Rescheduled)).toBe(true);
    expect(isFailedState(OpenLineageRunState.Rescheduled)).toBe(false);
    expect(isFailedState(OpenLineageRunState.Fail)).toBe(true);
    expect(isFailedState(OpenLineageRunState.Abort)).toBe(true);
    expect(isFailedState(OpenLineageRunState.Complete)).toBe(false);
  });

  test("is OneUptime's own state: an OpenLineage producer cannot send it", () => {
    const events: Array<OpenLineageRunEvent> = readOpenLineageEvents(
      {
        eventType: "RESCHEDULED",
        eventTime: "2026-11-03T11:59:00.000Z",
        run: { runId: SYNC_ID },
        job: { namespace: "airflow", name: "load_orders" },
      },
      NOW,
    );

    expect(events[0]?.eventType).toBe(OpenLineageRunState.Other);
    expect(events[0]?.outputDataAssetIds).toBeUndefined();
  });
});
