import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_STREAM_PATHS,
  CLOUD_STREAM_PROVIDERS,
  CLOUD_STREAM_PUBSUB_LOGS_PATH,
  CLOUD_STREAM_PUBSUB_MAX_MESSAGE_BYTES,
  CLOUD_STREAM_PUBSUB_MAX_REQUEST_BYTES,
  CLOUD_STREAM_PUBSUB_REQUESTS_PER_MINUTE,
  CLOUD_STREAM_REFUSAL_REASONS,
  CLOUD_STREAM_REQUESTS_PER_MINUTE,
  CloudStreamKeyHashes,
  CloudStreamRefusalReason,
  PUBSUB_ACKNOWLEDGING_STATUSES,
  canCloudStream,
  canPubSubPushTo,
  doesCloudStreamCarryMetrics,
  getCloudStreamPubSubEndpoint,
  getCloudStreamPushServiceAccountEmail,
  getCloudStreamPushServiceAccountId,
  getCloudStreamSuffix,
  isCloudStreamPushed,
  isGcpProjectId,
  isServiceAccountEmail,
  quoteForShell,
  readCloudStreamKeyHashes,
  readCloudStreamSummary,
  rotateCloudStreamKeyHashes,
} from "../../../Types/CloudConnection/CloudStream";
import { getCloudStreamSuffix as getAwsCloudStreamSuffix } from "../../../Types/CloudConnection/CloudStreamTemplate";
import { describe, expect, test } from "@jest/globals";

/*
 * What every cloud's stream shares (CloudStream): which clouds stream and
 * how, the Pub/Sub endpoint and its limits, the refusals a read of Azure's
 * event hubs adds, and Google Cloud's push service account - its name, and
 * that a stream key's hashes keep it through every rotation.
 */

const CONNECTION: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const HASH_A: string = "a".repeat(64);
const HASH_B: string = "b".repeat(64);
const NOW: Date = new Date("2026-11-06T10:00:00.000Z");

describe("Which clouds stream, and how", () => {
  test("AWS, Azure and Google Cloud stream; AWS and Google Cloud push, Azure is read", () => {
    expect(CLOUD_STREAM_PROVIDERS).toEqual([
      CloudProvider.AWS,
      CloudProvider.Azure,
      CloudProvider.GCP,
    ]);

    for (const provider of CLOUD_STREAM_PROVIDERS) {
      expect(canCloudStream(provider)).toBe(true);
      expect(canCloudStream(provider.toUpperCase())).toBe(true);
    }

    expect(canCloudStream("oracle")).toBe(false);
    expect(canCloudStream(undefined)).toBe(false);
    expect(isCloudStreamPushed(CloudProvider.AWS)).toBe(true);
    expect(isCloudStreamPushed(CloudProvider.GCP)).toBe(true);
    expect(isCloudStreamPushed(CloudProvider.Azure)).toBe(false);
    expect(isCloudStreamPushed(null)).toBe(false);
  });

  test("Google Cloud's stream carries logs alone: Cloud Monitoring pushes no metrics", () => {
    expect(doesCloudStreamCarryMetrics(CloudProvider.AWS)).toBe(true);
    expect(doesCloudStreamCarryMetrics(CloudProvider.Azure)).toBe(true);
    expect(doesCloudStreamCarryMetrics(CloudProvider.GCP)).toBe(false);
  });

  test("the endpoints are the three paths, the Pub/Sub one under /telemetry like the others", () => {
    expect(CLOUD_STREAM_PATHS).toEqual([
      "/aws-firehose/v1/metrics",
      "/aws-firehose/v1/logs",
      "/gcp-pubsub/v1/logs",
    ]);
    expect(CLOUD_STREAM_PUBSUB_LOGS_PATH).toBe("/gcp-pubsub/v1/logs");
    expect(getCloudStreamPubSubEndpoint("https://oneuptime.com//")).toBe(
      "https://oneuptime.com/telemetry/gcp-pubsub/v1/logs",
    );
    expect(getCloudStreamPubSubEndpoint(" https://status.acme.io ")).toBe(
      "https://status.acme.io/telemetry/gcp-pubsub/v1/logs",
    );
    expect(canPubSubPushTo("https://oneuptime.com/x")).toBe(true);
    expect(canPubSubPushTo("http://oneuptime.local/x")).toBe(false);
  });

  test("Pub/Sub's limits: one entry a request, so many more requests a minute than Firehose's, each small", () => {
    expect(CLOUD_STREAM_PUBSUB_REQUESTS_PER_MINUTE).toBeGreaterThan(
      CLOUD_STREAM_REQUESTS_PER_MINUTE,
    );
    // A log entry is at most 256 KiB, a third more in base64: both fit.
    expect(CLOUD_STREAM_PUBSUB_MAX_MESSAGE_BYTES).toBeGreaterThanOrEqual(
      256 * 1024,
    );
    expect(CLOUD_STREAM_PUBSUB_MAX_REQUEST_BYTES).toBeGreaterThan(
      Math.ceil((CLOUD_STREAM_PUBSUB_MAX_MESSAGE_BYTES * 4) / 3),
    );
    expect(PUBSUB_ACKNOWLEDGING_STATUSES).toEqual([102, 200, 201, 202, 204]);
  });

  test("the refusals a token and a read add are kept on a connection's summary like the others", () => {
    for (const reason of [
      CloudStreamRefusalReason.WrongToken,
      CloudStreamRefusalReason.NoAccess,
      CloudStreamRefusalReason.Unreachable,
    ]) {
      expect(CLOUD_STREAM_REFUSAL_REASONS).toContain(reason);
      expect(
        readCloudStreamSummary({
          metricSources: [],
          logSources: [],
          lastRefusal: { at: NOW.toISOString(), reason },
        }).lastRefusal,
      ).toEqual({ at: NOW.toISOString(), reason });
    }
  });
});

describe("Google Cloud's push service account", () => {
  test("it is named after the connection, in the project given", () => {
    expect(getCloudStreamSuffix(CONNECTION)).toBe("6f1c3a2e");
    // The AWS template's names read the very same suffix.
    expect(getAwsCloudStreamSuffix(CONNECTION)).toBe("6f1c3a2e");
    expect(getCloudStreamPushServiceAccountId(CONNECTION)).toBe(
      "oneuptime-push-6f1c3a2e",
    );
    expect(
      getCloudStreamPushServiceAccountEmail({
        connectionId: CONNECTION,
        projectId: " Acme-Prod-1 ",
      }),
    ).toBe("oneuptime-push-6f1c3a2e@acme-prod-1.iam.gserviceaccount.com");
  });

  test("project IDs are read as Google writes them", () => {
    for (const valid of [
      "acme-prod-1",
      "abcdef",
      "a".repeat(30),
      "example.com:acme-prod",
    ]) {
      expect(isGcpProjectId(valid)).toBe(true);
    }

    for (const invalid of [
      "",
      "abcde",
      "a".repeat(31),
      "1acme-prod",
      "acme-prod-",
      "Acme-prod",
      "acme_prod",
      "acme prod",
      ":acme-prod",
      "example:acme-prod",
      "exa mple.com:acme-prod",
    ]) {
      expect(isGcpProjectId(invalid)).toBe(false);
    }
  });

  test("service account emails are read as Google writes them", () => {
    expect(
      isServiceAccountEmail(
        "oneuptime-push-6f1c3a2e@acme-prod-1.iam.gserviceaccount.com",
      ),
    ).toBe(true);
    expect(
      isServiceAccountEmail(
        "oneuptime-push-6f1c3a2e@acme-prod.example.com.iam.gserviceaccount.com",
      ),
    ).toBe(true);

    for (const invalid of [
      "oneuptime-push@acme-prod-1.gserviceaccount.com",
      "someone@gmail.com",
      "a@b@acme.iam.gserviceaccount.com",
      "abc@acme-prod-1.iam.gserviceaccount.com",
      "UPPER-case-name@acme-prod-1.iam.gserviceaccount.com",
      "@acme-prod-1.iam.gserviceaccount.com",
      "oneuptime-push-6f1c3a2e@.iam.gserviceaccount.com",
    ]) {
      expect(isServiceAccountEmail(invalid)).toBe(false);
    }
  });

  test("a stream key's hashes keep the push service account it was made for, through every rotation", () => {
    const pusher: string =
      "oneuptime-push-6f1c3a2e@acme-prod-1.iam.gserviceaccount.com";
    const first: CloudStreamKeyHashes = rotateCloudStreamKeyHashes({
      hashes: {},
      newHash: HASH_A,
      now: NOW,
      pushServiceAccount: pusher,
    });

    expect(first.pushServiceAccount).toBe(pusher);
    expect(readCloudStreamKeyHashes(JSON.parse(JSON.stringify(first)))).toEqual(
      first,
    );

    // A new key without one keeps it; a new key for another replaces it.
    const second: CloudStreamKeyHashes = rotateCloudStreamKeyHashes({
      hashes: first,
      newHash: HASH_B,
      now: NOW,
    });
    expect(second.pushServiceAccount).toBe(pusher);
    expect(second.previous?.[0]?.hash).toBe(HASH_A);

    const other: string =
      "oneuptime-push-6f1c3a2e@acme-data-2.iam.gserviceaccount.com";
    expect(
      rotateCloudStreamKeyHashes({
        hashes: second,
        newHash: HASH_A,
        now: NOW,
        pushServiceAccount: other,
      }).pushServiceAccount,
    ).toBe(other);

    // An AWS key's hashes hold none.
    expect(
      rotateCloudStreamKeyHashes({ hashes: {}, newHash: HASH_A, now: NOW }),
    ).not.toHaveProperty("pushServiceAccount");
  });

  test("a stored push service account that is not one is not read", () => {
    expect(
      readCloudStreamKeyHashes({
        current: { hash: HASH_A, createdAt: NOW.toISOString() },
        pushServiceAccount: "attacker@gmail.com",
      }),
    ).toEqual({ current: { hash: HASH_A, createdAt: NOW.toISOString() } });
    expect(
      readCloudStreamKeyHashes({ pushServiceAccount: 42 }).pushServiceAccount,
    ).toBeUndefined();
  });
});

describe("A value for the shell", () => {
  test("it is single-quoted, and a single quote in it ends and restarts the quotes", () => {
    expect(quoteForShell("plain")).toBe("'plain'");
    expect(quoteForShell("it's")).toBe("'it'\\''s'");
    expect(quoteForShell('$(touch x) `y` "z"')).toBe("'$(touch x) `y` \"z\"'");
  });
});
