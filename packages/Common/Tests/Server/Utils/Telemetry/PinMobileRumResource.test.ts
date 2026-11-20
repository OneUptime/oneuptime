import { describe, expect, test } from "@jest/globals";
import PinMobileRumResource, {
  MOBILE_RUM_RESOURCE_ATTRIBUTE_PREFIXES,
} from "../../../../Server/Utils/Telemetry/PinMobileRumResource";
import PinServiceName from "../../../../Server/Utils/Telemetry/PinServiceName";
import { JSONObject } from "../../../../Types/JSON";
import {
  RUM_CLIENT_KIND_MOBILE,
  RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
} from "../../../../Types/Rum/RumClientKind";

/*
 * WHAT A MOBILE KEY WRITES IS ITS APP'S MOBILE RUM (issue #6457).
 *
 * A Mobile key is copied out of an app by anyone who has the app. The ingest
 * guard holds it to OTLP traces, logs and metrics, and the pin files them
 * under the app's name; this keeps the rest of each resource to what a
 * mobile app says about itself, so a copy cannot file its telemetry under a
 * host, a Kubernetes cluster, a cloud resource or a database - and stamps
 * every resource as a mobile client.
 */

function attribute(key: string, value: string): JSONObject {
  return { key, value: { stringValue: value } };
}

function keysOf(block: JSONObject): Array<string> {
  return (
    ((block["resource"] as JSONObject)["attributes"] as Array<JSONObject>) || []
  ).map((entry: JSONObject): string => {
    return entry["key"] as string;
  });
}

function valueOf(block: JSONObject, key: string): unknown {
  const found: JSONObject | undefined = (
    ((block["resource"] as JSONObject)["attributes"] as Array<JSONObject>) || []
  ).find((entry: JSONObject): boolean => {
    return entry["key"] === key;
  });

  return found ? (found["value"] as JSONObject)["stringValue"] : undefined;
}

// A forged resource: a mobile app's attributes, and every routing attribute a copy could add.
function forgedBlock(): JSONObject {
  return {
    resource: {
      attributes: [
        attribute("service.name", "storefront-mobile"),
        attribute("service.version", "4.2.0"),
        attribute("device.model.identifier", "Pixel 8"),
        attribute("device.manufacturer", "Google"),
        attribute("os.name", "Android"),
        attribute("os.version", "15"),
        attribute("android.os.api_level", "35"),
        attribute("telemetry.sdk.language", "java"),
        attribute("app.build", "1042"),
        attribute("deployment.environment.name", "production"),
        attribute("oneuptime.label.team", "mobile"),
        // What a copy would add to file it under something else.
        attribute("host.name", "box-1"),
        attribute("host.id", "i-0abc"),
        attribute("k8s.cluster.name", "prod-east"),
        attribute("k8s.node.name", "node-1"),
        attribute("container.runtime", "docker"),
        attribute("cloud.resource_id", "arn:aws:lambda:us-east-1:1:function:x"),
        attribute("faas.name", "checkout"),
        attribute("db.system", "postgresql"),
        attribute("browser.platform", "Windows"),
        attribute("oneuptime.database.server.id", "6457"),
        attribute("oneuptime.host.name", "box-1"),
        attribute(RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE, "browser"),
      ],
      entityRefs: [{ type: "host", idKeys: ["host.name"] }],
    },
    scopeSpans: [
      {
        spans: [
          {
            name: "checkout",
            attributes: [attribute("host.name", "kept-on-the-span")],
          },
        ],
      },
    ],
  };
}

describe("PinMobileRumResource.pinInPlace", () => {
  test("keeps a mobile app's own attributes and drops everything that routes elsewhere", () => {
    const body: JSONObject = { resourceSpans: [forgedBlock()] };

    expect(PinMobileRumResource.pinInPlace(body)).toBe(1);

    const block: JSONObject = (body["resourceSpans"] as Array<JSONObject>)[0]!;

    expect(keysOf(block)).toEqual([
      "service.name",
      "service.version",
      "device.model.identifier",
      "device.manufacturer",
      "os.name",
      "os.version",
      "android.os.api_level",
      "telemetry.sdk.language",
      "app.build",
      "deployment.environment.name",
      "oneuptime.label.team",
      RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
    ]);
  });

  test("stamps the resource as a mobile client once, replacing whatever was sent", () => {
    const body: JSONObject = { resourceLogs: [forgedBlock()] };

    PinMobileRumResource.pinInPlace(body);

    const block: JSONObject = (body["resourceLogs"] as Array<JSONObject>)[0]!;

    expect(
      keysOf(block).filter((key: string): boolean => {
        return key === RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE;
      }),
    ).toHaveLength(1);
    expect(valueOf(block, RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE)).toBe(
      RUM_CLIENT_KIND_MOBILE,
    );
  });

  test("drops the resource's entity references, which ingest trusts over its attributes", () => {
    const body: JSONObject = { resourceMetrics: [forgedBlock()] };

    PinMobileRumResource.pinInPlace(body);

    const resource: JSONObject = (
      body["resourceMetrics"] as Array<JSONObject>
    )[0]!["resource"] as JSONObject;

    expect(Object.prototype.hasOwnProperty.call(resource, "entityRefs")).toBe(
      false,
    );
  });

  test("leaves a span's own attributes as the app sent them", () => {
    const body: JSONObject = { resourceSpans: [forgedBlock()] };

    PinMobileRumResource.pinInPlace(body);

    expect(JSON.stringify(body)).toContain("kept-on-the-span");
  });

  test("rewrites every resource of every signal container", () => {
    const body: JSONObject = {
      resourceSpans: [forgedBlock(), forgedBlock()],
      resourceLogs: [forgedBlock()],
      resourceMetrics: [forgedBlock()],
      resourceProfiles: [forgedBlock()],
    };

    expect(PinMobileRumResource.pinInPlace(body)).toBe(5);
    expect(JSON.stringify(body)).not.toContain("prod-east");
    expect(JSON.stringify(body)).not.toContain("oneuptime.database.server.id");
  });

  test("matches prefixes without case, and never a look-alike outside them", () => {
    expect(PinMobileRumResource.isMobileAppAttributeKey("Device.Id")).toBe(
      true,
    );
    expect(PinMobileRumResource.isMobileAppAttributeKey(" os.type ")).toBe(
      true,
    );
    expect(PinMobileRumResource.isMobileAppAttributeKey("devices.id")).toBe(
      false,
    );
    expect(PinMobileRumResource.isMobileAppAttributeKey("hostname")).toBe(
      false,
    );
    expect(
      PinMobileRumResource.isMobileAppAttributeKey("oneuptime.label"),
    ).toBe(false);
    expect(PinMobileRumResource.isMobileAppAttributeKey(42)).toBe(false);
    expect(
      PinMobileRumResource.isMobileAppAttributeKey(
        RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
      ),
    ).toBe(false);
  });

  test("every prefix is a namespace, ending with a dot", () => {
    for (const prefix of MOBILE_RUM_RESOURCE_ATTRIBUTE_PREFIXES) {
      expect(prefix.endsWith(".")).toBe(true);
    }
  });

  test("keeps the service name the pin set, after the pin", () => {
    const body: JSONObject = {
      resourceSpans: [
        {
          resource: { attributes: [attribute("service.name", "payments-api")] },
        },
      ],
    };

    PinServiceName.pinInPlace(body, "storefront-mobile");
    PinMobileRumResource.pinInPlace(body);

    const block: JSONObject = (body["resourceSpans"] as Array<JSONObject>)[0]!;

    expect(valueOf(block, "service.name")).toBe("storefront-mobile");
  });

  test("repairs a malformed resource rather than letting it through unfiltered", () => {
    const body: JSONObject = {
      resourceSpans: [
        { resource: "not-an-object" },
        { resource: { attributes: "nope" } },
        {},
        "not-a-block",
        null,
      ] as unknown as Array<JSONObject>,
    };

    expect(PinMobileRumResource.pinInPlace(body)).toBe(3);

    for (const block of (body["resourceSpans"] as Array<JSONObject>).slice(
      0,
      3,
    )) {
      expect(keysOf(block)).toEqual([RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE]);
    }
  });

  test("never throws on a body that is not one", () => {
    expect(PinMobileRumResource.pinInPlace(null as unknown as JSONObject)).toBe(
      0,
    );
    expect(PinMobileRumResource.pinInPlace([] as unknown as JSONObject)).toBe(
      0,
    );
    expect(
      PinMobileRumResource.pinInPlace({ resourceSpans: "x" } as JSONObject),
    ).toBe(0);
  });
});
