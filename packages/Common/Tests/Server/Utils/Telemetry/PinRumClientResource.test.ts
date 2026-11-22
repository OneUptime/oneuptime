import { describe, expect, test } from "@jest/globals";
import PinRumClientResource, {
  BROWSER_RUM_RESOURCE_ATTRIBUTE_PREFIXES,
  MOBILE_RUM_RESOURCE_ATTRIBUTE_PREFIXES,
  RUM_CLIENT_RESOURCE_ATTRIBUTE_PREFIXES,
  RUM_CLIENT_RESOURCE_ATTRIBUTE_PREFIXES_BY_KIND,
} from "../../../../Server/Utils/Telemetry/PinRumClientResource";
import PinServiceName from "../../../../Server/Utils/Telemetry/PinServiceName";
import { JSONObject } from "../../../../Types/JSON";
import {
  RUM_CLIENT_KIND_BROWSER,
  RUM_CLIENT_KIND_MOBILE,
  RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
  RumClientKind,
} from "../../../../Types/Rum/RumClientKind";

/*
 * WHAT A PUBLIC KEY WRITES IS ITS PAGE'S OR ITS APP'S RUM (issues #6457 and
 * #10539).
 *
 * A Browser key is copied out of a page and a Mobile key out of an app, by
 * anyone who has them. The ingest guard holds each to its surfaces and the
 * pin files what it writes under its service name; this keeps the rest of
 * each resource to what a page or an app says about itself, so a copy
 * cannot file its telemetry under a host, a Kubernetes cluster, a cloud
 * resource or a database - and stamps every resource as that kind of client.
 * One rule for both keys, in one place: what they share, and what each adds.
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

/*
 * Every routing attribute a copy could add to file its telemetry under
 * something else, and every family OneUptime's discovery reads.
 */
const FORGED_ROUTING_ATTRIBUTES: Array<JSONObject> = [
  attribute("host.name", "box-1"),
  attribute("host.id", "i-0abc"),
  attribute("k8s.cluster.name", "prod-east"),
  attribute("k8s.node.name", "node-1"),
  attribute("k8s.pod.name", "checkout-5d9"),
  attribute("container.runtime", "docker"),
  attribute("container.id", "c0ffee"),
  attribute("cloud.provider", "aws"),
  attribute("cloud.platform", "aws_lambda"),
  attribute("cloud.resource_id", "arn:aws:lambda:us-east-1:1:function:x"),
  attribute("cloud.account.id", "123456789012"),
  attribute("faas.name", "checkout"),
  attribute("aws.ecs.task.arn", "arn:aws:ecs:us-east-1:1:task/prod/abc"),
  attribute("gcp.resource_type", "gce_instance"),
  attribute("azuremonitor.subscription_id", "sub-1"),
  attribute("db.system", "postgresql"),
  attribute("db.system.name", "postgresql"),
  attribute("postgresql.database.name", "orders"),
  attribute("server.address", "prod-db.internal"),
  attribute("proxmox.cluster.name", "pve"),
  attribute("ceph.cluster.name", "ceph"),
  attribute("vmware.vcenter.name", "vc-1"),
  attribute("openstack.cloud.name", "os-1"),
  attribute("storage.array.name", "array-1"),
  attribute("iot.fleet.name", "fleet-1"),
  attribute("process.pid", "4242"),
  attribute("process.runtime.name", "browser"),
  attribute("oneuptime.database.server.id", "6457"),
  attribute("oneuptime.host.name", "box-1"),
  attribute("oneuptime.agent.version", "9.9.9"),
  attribute(RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE, "mobile"),
];

const ROUTING_VALUES: Array<string> = [
  "box-1",
  "i-0abc",
  "prod-east",
  "checkout-5d9",
  "c0ffee",
  "arn:aws:lambda",
  "123456789012",
  "gce_instance",
  "sub-1",
  "prod-db.internal",
  "orders",
  "fleet-1",
  "6457",
];

// A web page's own resource, as the browser SDK and the setup guide set it.
const BROWSER_OWN_ATTRIBUTES: Array<JSONObject> = [
  attribute("service.name", "storefront-web"),
  attribute("service.version", "4.2.0"),
  attribute("browser.platform", "macOS"),
  attribute("browser.language", "en-US"),
  attribute("browser.mobile", "false"),
  attribute("user_agent.original", "Mozilla/5.0"),
  attribute("telemetry.sdk.language", "webjs"),
  attribute("deployment.environment.name", "production"),
  attribute("session.id", "s-1"),
  attribute("enduser.pseudo.id", "visitor-1"),
  attribute("user.id", "u-1"),
  attribute("oneuptime.label.team", "web"),
];

// A mobile app's own resource, as OpenTelemetry Android sets it.
const MOBILE_OWN_ATTRIBUTES: Array<JSONObject> = [
  attribute("service.name", "storefront-mobile"),
  attribute("service.version", "4.2.0"),
  attribute("device.model.identifier", "Pixel 8"),
  attribute("device.manufacturer", "Google"),
  attribute("os.name", "Android"),
  attribute("os.version", "15"),
  attribute("os.type", "linux"),
  attribute("android.os.api_level", "35"),
  attribute("rum.sdk.version", "0.11.0"),
  attribute("telemetry.sdk.language", "java"),
  attribute("app.build", "1042"),
  attribute("deployment.environment.name", "production"),
  attribute("enduser.id", "u-1"),
  attribute("oneuptime.label.team", "mobile"),
];

function keyOf(entry: JSONObject): string {
  return entry["key"] as string;
}

/*
 * A forged resource: a client's own attributes, the other client kind's and
 * every routing attribute a copy could add, with entity references naming a
 * host, and a span whose own attributes name one too.
 */
function forgedBlock(): JSONObject {
  return {
    resource: {
      attributes: [
        ...BROWSER_OWN_ATTRIBUTES,
        ...MOBILE_OWN_ATTRIBUTES.filter((entry: JSONObject): boolean => {
          return !keyOf(entry).startsWith("service.");
        }),
        ...FORGED_ROUTING_ATTRIBUTES,
      ],
      entityRefs: [{ type: "host", idKeys: ["host.name"] }],
      entity_refs: [{ type: "k8s.cluster", id_keys: ["k8s.cluster.name"] }],
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

const KINDS: Array<RumClientKind> = [
  RUM_CLIENT_KIND_BROWSER,
  RUM_CLIENT_KIND_MOBILE,
];

describe("the allowlists", () => {
  test("a Browser key keeps what a page says about itself (#10539)", () => {
    expect([...BROWSER_RUM_RESOURCE_ATTRIBUTE_PREFIXES].sort()).toEqual(
      [
        "service.",
        "browser.",
        "telemetry.",
        "deployment.",
        "user_agent.",
        "session.",
        "user.",
        "enduser.",
        "oneuptime.label.",
      ].sort(),
    );
  });

  test("a Mobile key keeps what an app says about itself (#6457)", () => {
    expect([...MOBILE_RUM_RESOURCE_ATTRIBUTE_PREFIXES].sort()).toEqual(
      [
        "service.",
        "device.",
        "os.",
        "telemetry.",
        "app.",
        "android.",
        "ios.",
        "rum.",
        "session.",
        "deployment.",
        "user_agent.",
        "user.",
        "enduser.",
        "oneuptime.label.",
      ].sort(),
    );
  });

  test("both are the shared families and their own, from one place", () => {
    for (const kind of KINDS) {
      for (const prefix of RUM_CLIENT_RESOURCE_ATTRIBUTE_PREFIXES) {
        expect(RUM_CLIENT_RESOURCE_ATTRIBUTE_PREFIXES_BY_KIND[kind]).toContain(
          prefix,
        );
      }
    }

    expect(BROWSER_RUM_RESOURCE_ATTRIBUTE_PREFIXES).not.toContain("device.");
    expect(BROWSER_RUM_RESOURCE_ATTRIBUTE_PREFIXES).not.toContain("os.");
    expect(MOBILE_RUM_RESOURCE_ATTRIBUTE_PREFIXES).not.toContain("browser.");
  });

  test("every prefix is a namespace, ending with a dot", () => {
    for (const kind of KINDS) {
      for (const prefix of RUM_CLIENT_RESOURCE_ATTRIBUTE_PREFIXES_BY_KIND[
        kind
      ]) {
        expect(prefix.endsWith(".")).toBe(true);
      }
    }
  });

  test("no prefix lets a routing attribute through, for either kind", () => {
    for (const kind of KINDS) {
      for (const entry of FORGED_ROUTING_ATTRIBUTES) {
        expect({
          kind,
          key: keyOf(entry),
          kept: PinRumClientResource.isClientAttributeKey(keyOf(entry), kind),
        }).toEqual({ kind, key: keyOf(entry), kept: false });
      }
    }
  });
});

describe("PinRumClientResource.pinInPlace for a Browser key (#10539)", () => {
  test("keeps a page's own attributes and drops everything that routes elsewhere", () => {
    const body: JSONObject = { resourceSpans: [forgedBlock()] };

    expect(PinRumClientResource.pinInPlace(body, RUM_CLIENT_KIND_BROWSER)).toBe(
      1,
    );

    const block: JSONObject = (body["resourceSpans"] as Array<JSONObject>)[0]!;

    expect(keysOf(block)).toEqual([
      ...BROWSER_OWN_ATTRIBUTES.map(keyOf),
      // The mobile family a page has no business sending, bar the shared ones.
      "telemetry.sdk.language",
      "deployment.environment.name",
      "enduser.id",
      "oneuptime.label.team",
      RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
    ]);
    for (const value of ROUTING_VALUES) {
      expect(JSON.stringify(block["resource"])).not.toContain(value);
    }
    expect(keysOf(block)).not.toContain("device.model.identifier");
    expect(keysOf(block)).not.toContain("os.name");
  });

  test("stamps every resource as a browser client once, whatever was sent", () => {
    const body: JSONObject = { resourceLogs: [forgedBlock()] };

    PinRumClientResource.pinInPlace(body, RUM_CLIENT_KIND_BROWSER);

    const block: JSONObject = (body["resourceLogs"] as Array<JSONObject>)[0]!;

    expect(
      keysOf(block).filter((key: string): boolean => {
        return key === RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE;
      }),
    ).toHaveLength(1);
    // A forged "mobile" stamp is replaced, not kept beside it.
    expect(valueOf(block, RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE)).toBe(
      RUM_CLIENT_KIND_BROWSER,
    );
  });

  test("a resource with no browser attributes at all is still stamped a browser client", () => {
    const body: JSONObject = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              attribute("service.name", "checkout"),
              attribute("host.name", "prod-db-1"),
            ],
          },
        },
      ],
    };

    PinRumClientResource.pinInPlace(body, RUM_CLIENT_KIND_BROWSER);

    const block: JSONObject = (body["resourceSpans"] as Array<JSONObject>)[0]!;

    expect(keysOf(block)).toEqual([
      "service.name",
      RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
    ]);
    expect(valueOf(block, RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE)).toBe(
      RUM_CLIENT_KIND_BROWSER,
    );
  });
});

describe("PinRumClientResource.pinInPlace for a Mobile key (#6457)", () => {
  test("keeps a mobile app's own attributes and drops everything that routes elsewhere", () => {
    const body: JSONObject = { resourceSpans: [forgedBlock()] };

    expect(PinRumClientResource.pinInPlace(body, RUM_CLIENT_KIND_MOBILE)).toBe(
      1,
    );

    const block: JSONObject = (body["resourceSpans"] as Array<JSONObject>)[0]!;

    expect(keysOf(block)).not.toContain("browser.platform");
    expect(keysOf(block)).toContain("device.model.identifier");
    expect(keysOf(block)).toContain("os.name");
    expect(keysOf(block)).toContain("android.os.api_level");
    expect(keysOf(block)).toContain("app.build");
    expect(keysOf(block)).toContain("rum.sdk.version");
    for (const value of ROUTING_VALUES) {
      expect(JSON.stringify(block["resource"])).not.toContain(value);
    }
    /*
     * OpenTelemetry Android sets os.type ("linux") itself; without host.name
     * beside it, it names no host.
     */
    expect(keysOf(block)).toContain("os.type");
    expect(keysOf(block)).not.toContain("host.name");
    expect(keysOf(block)[keysOf(block).length - 1]).toBe(
      RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
    );
  });

  test("stamps the resource as a mobile client once, replacing whatever was sent", () => {
    const body: JSONObject = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              ...MOBILE_OWN_ATTRIBUTES,
              attribute(RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE, "browser"),
            ],
          },
        },
      ],
    };

    PinRumClientResource.pinInPlace(body, RUM_CLIENT_KIND_MOBILE);

    const block: JSONObject = (body["resourceLogs"] as Array<JSONObject>)[0]!;

    expect(keysOf(block)).toEqual([
      ...MOBILE_OWN_ATTRIBUTES.map(keyOf),
      RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
    ]);
    expect(valueOf(block, RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE)).toBe(
      RUM_CLIENT_KIND_MOBILE,
    );
  });
});

describe.each(KINDS)(
  "PinRumClientResource for a %s client",
  (kind: RumClientKind) => {
    test("drops the resource's entity references, which ingest trusts over its attributes", () => {
      const body: JSONObject = { resourceMetrics: [forgedBlock()] };

      PinRumClientResource.pinInPlace(body, kind);

      const resource: JSONObject = (
        body["resourceMetrics"] as Array<JSONObject>
      )[0]!["resource"] as JSONObject;

      expect(Object.prototype.hasOwnProperty.call(resource, "entityRefs")).toBe(
        false,
      );
      expect(
        Object.prototype.hasOwnProperty.call(resource, "entity_refs"),
      ).toBe(false);
    });

    test("leaves a span's own attributes as they were sent", () => {
      const body: JSONObject = { resourceSpans: [forgedBlock()] };

      PinRumClientResource.pinInPlace(body, kind);

      expect(JSON.stringify(body)).toContain("kept-on-the-span");
    });

    test("rewrites every resource of every signal container", () => {
      const body: JSONObject = {
        resourceSpans: [forgedBlock(), forgedBlock()],
        resourceLogs: [forgedBlock()],
        resourceMetrics: [forgedBlock()],
        resourceProfiles: [forgedBlock()],
      };

      expect(PinRumClientResource.pinInPlace(body, kind)).toBe(5);
      expect(JSON.stringify(body)).not.toContain("prod-east");
      expect(JSON.stringify(body)).not.toContain(
        "oneuptime.database.server.id",
      );
    });

    test("keeps the service name the pin set, after the pin", () => {
      const body: JSONObject = {
        resourceSpans: [
          {
            resource: {
              attributes: [attribute("service.name", "payments-api")],
            },
          },
        ],
      };

      PinServiceName.pinInPlace(body, "storefront");
      PinRumClientResource.pinInPlace(body, kind);

      const block: JSONObject = (
        body["resourceSpans"] as Array<JSONObject>
      )[0]!;

      expect(valueOf(block, "service.name")).toBe("storefront");
      expect(valueOf(block, RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE)).toBe(kind);
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

      expect(PinRumClientResource.pinInPlace(body, kind)).toBe(3);

      for (const block of (body["resourceSpans"] as Array<JSONObject>).slice(
        0,
        3,
      )) {
        expect(keysOf(block)).toEqual([RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE]);
      }
    });

    test("never throws on a body that is not one", () => {
      expect(
        PinRumClientResource.pinInPlace(null as unknown as JSONObject, kind),
      ).toBe(0);
      expect(
        PinRumClientResource.pinInPlace([] as unknown as JSONObject, kind),
      ).toBe(0);
      expect(
        PinRumClientResource.pinInPlace(
          { resourceSpans: "x" } as JSONObject,
          kind,
        ),
      ).toBe(0);
    });
  },
);

describe("PinRumClientResource.isClientAttributeKey", () => {
  test("matches prefixes without case or surrounding space, and never a look-alike outside them", () => {
    expect(
      PinRumClientResource.isClientAttributeKey(
        "Device.Id",
        RUM_CLIENT_KIND_MOBILE,
      ),
    ).toBe(true);
    expect(
      PinRumClientResource.isClientAttributeKey(
        " os.type ",
        RUM_CLIENT_KIND_MOBILE,
      ),
    ).toBe(true);
    expect(
      PinRumClientResource.isClientAttributeKey(
        "Browser.Platform",
        RUM_CLIENT_KIND_BROWSER,
      ),
    ).toBe(true);
    expect(
      PinRumClientResource.isClientAttributeKey(
        "devices.id",
        RUM_CLIENT_KIND_MOBILE,
      ),
    ).toBe(false);
    expect(
      PinRumClientResource.isClientAttributeKey(
        "browsers.platform",
        RUM_CLIENT_KIND_BROWSER,
      ),
    ).toBe(false);
    expect(
      PinRumClientResource.isClientAttributeKey(
        "hostname",
        RUM_CLIENT_KIND_BROWSER,
      ),
    ).toBe(false);
    expect(
      PinRumClientResource.isClientAttributeKey(
        "oneuptime.label",
        RUM_CLIENT_KIND_BROWSER,
      ),
    ).toBe(false);
    expect(
      PinRumClientResource.isClientAttributeKey(42, RUM_CLIENT_KIND_MOBILE),
    ).toBe(false);
  });

  test("never keeps ingest's own stamp as it was sent", () => {
    for (const kind of KINDS) {
      expect(
        PinRumClientResource.isClientAttributeKey(
          RUM_CLIENT_KIND_RESOURCE_ATTRIBUTE,
          kind,
        ),
      ).toBe(false);
    }
  });

  test("a kind it does not know keeps nothing", () => {
    expect(
      PinRumClientResource.isClientAttributeKey(
        "service.name",
        "server" as unknown as RumClientKind,
      ),
    ).toBe(false);
  });
});
