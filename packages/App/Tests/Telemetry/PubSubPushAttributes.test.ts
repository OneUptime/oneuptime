import { describe, expect, test } from "@jest/globals";
import { INHERITED_PROPERTY_NAMES } from "Common/Tests/Helpers/InheritedNames";
import { readOwnValue } from "Common/Utils/LookupTable";
import {
  PubSubPush,
  PubSubPushReading,
  readPubSubPush,
} from "../../FeatureSet/Telemetry/Utils/GcpPubSub/PubSubContract";

/*
 * Issue #8487: a Pub/Sub message's attributes are the push's own keys, so
 * one named "__proto__" - or any other name every object inherits - is
 * kept like any other text attribute; "__proto__" was left out. Each push
 * is JSON text, as Pub/Sub sends it, so the key is the message's own.
 */

const PROTOTYPE_KEYS: Array<string> = Object.getOwnPropertyNames(
  Object.prototype,
).sort();

function readPush(attributes: string): PubSubPush {
  const reading: PubSubPushReading = readPubSubPush(
    Buffer.from(
      `{"message":{"attributes":${attributes},"data":"${Buffer.from("{}").toString("base64")}","messageId":"2070443601311540","publishTime":"2026-11-06T10:00:00.123Z"},"subscription":"projects/acme/subscriptions/oneuptime-stream-push","deliveryAttempt":1}`,
    ),
  );

  if (!("push" in reading)) {
    throw new Error(reading.problem);
  }

  return reading.push;
}

describe("a push's attributes", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "an attribute named %s is the push's own",
    (name: string) => {
      const push: PubSubPush = readPush(
        `{${JSON.stringify(name)}:"the message's","logging.googleapis.com/timestamp":"2026-11-06T10:00:00Z"}`,
      );

      expect(Object.keys(push.attributes)).toEqual([
        name,
        "logging.googleapis.com/timestamp",
      ]);
      expect(readOwnValue(push.attributes, name)).toBe("the message's");
      expect(Object.getPrototypeOf(push.attributes)).toBe(Object.prototype);
      expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(
        PROTOTYPE_KEYS,
      );
    },
  );

  test("an attribute holding anything but text is left out, and nothing reaches a prototype", () => {
    const push: PubSubPush = readPush(
      '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"ok":"1"}',
    );

    expect(push.attributes).toEqual({ ok: "1" });
    expect(Object.getPrototypeOf(push.attributes)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
