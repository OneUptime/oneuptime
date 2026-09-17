/*
 * Issue #3866 made `device.manufacturer` and `device.model.name` first-class
 * host inventory attributes, which collided with an existing rule:
 * `getRumClientType` treated `device.manufacturer` on its own as proof of a
 * phone.
 *
 * The collision is not cosmetic. A truthy client type makes
 * `getServiceNameFromAttributes` return null, so the host's real Service row
 * stops being created, and it makes `autoDiscoverRum` mint a Mobile RUM
 * Application named after that service. An operator who stamps their fleet's
 * make through OTEL_RESOURCE_ATTRIBUTES sets it for every process on the
 * box, so the blast radius is every SDK on every host they configured.
 *
 * This suite pins both directions: a machine is never mobile, and every
 * genuine mobile signal still is.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Replaced WITH A FACTORY — an automock
 * would still require, and type-check, the real file.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import { ExpressRequest } from "Common/Server/Utils/Express";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/* getRumClientType and getServiceNameFromAttributes are protected statics. */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function attributes(pairs: Record<string, string>): JSONArray {
  return Object.entries(pairs).map(([key, value]: [string, string]) => {
    return stringAttribute(key, value);
  }) as JSONArray;
}

function classify(pairs: Record<string, string>): string | null {
  return baseService["getRumClientType"](attributes(pairs)) as string | null;
}

/** A request with no service-name header — the ordinary OTLP case. */
function requestWithoutServiceNameHeader(): ExpressRequest {
  return { headers: {} } as unknown as ExpressRequest;
}

describe("getRumClientType — a machine host is not a phone (issue #3866)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("host resources carrying device.manufacturer", () => {
    test("the reporter's Windows host is not RUM", () => {
      expect(
        classify({
          "host.name": "wbprjdeais002",
          "host.arch": "amd64",
          "os.type": "windows",
          "device.manufacturer": "Dell Inc.",
          "device.model.name": "OptiPlex 7090",
          "host.serial_number": "7XYZ123",
        }),
      ).toBeNull();
    });

    test("host.id alone is enough host identity to rule mobile out", () => {
      expect(
        classify({
          "host.id": "4C4C4544-0037-5A10-8054-B4C04F335931",
          "device.manufacturer": "Dell Inc.",
        }),
      ).toBeNull();
    });

    test("device.model.name is not a mobile signal on its own", () => {
      expect(classify({ "device.model.name": "OptiPlex 7090" })).toBeNull();
    });

    /*
     * A DaemonSet collector and the eBPF profiler label a node with
     * k8s.node.name and no host.name. getServiceNameFromAttributes already
     * treats that as host identity via getHostNameFromAttributes, so this
     * classifier has to as well — otherwise the two host branches of the
     * same file disagree and a node stamped for the CMDB is read as a phone.
     */
    test("a Kubernetes node labelled only with k8s.node.name is not RUM", () => {
      expect(
        classify({
          "k8s.node.name": "ip-10-0-1-23.ec2.internal",
          "k8s.cluster.name": "prod-us",
          "device.manufacturer": "Amazon EC2",
        }),
      ).toBeNull();
    });
  });

  describe("genuine client telemetry is classified exactly as before", () => {
    test.each([
      ["browser.platform", "browser", { "browser.platform": "macOS" }],
      ["browser.language", "browser", { "browser.language": "en-GB" }],
      ["device.id", "mobile", { "device.id": "b1e0-4a" }],
      [
        "device.model.identifier",
        "mobile",
        { "device.model.identifier": "iPhone14,3" },
      ],
      [
        "device.manufacturer with no host identity",
        "mobile",
        { "device.manufacturer": "Apple" },
      ],
    ])(
      "%s still classifies as %s",
      (
        _label: string,
        expected: string,
        pairs: Record<string, string>,
      ): void => {
        expect(classify({ "service.name": "storefront", ...pairs })).toBe(
          expected,
        );
      },
    );

    /*
     * The documented Android recipe (Content/en/rum/mobile-setup.md) sets
     * device.model.identifier alongside the manufacturer, so it is still
     * classified from an unambiguous signal even though it names a make.
     */
    test("the documented Android resource is still mobile", () => {
      expect(
        classify({
          "service.name": "storefront-mobile",
          "device.manufacturer": "Samsung",
          "device.model.identifier": "SM-G991B",
          "device.id": "8f2c-install-scoped",
        }),
      ).toBe("mobile");
    });

    test("browser classification wins over a device attribute", () => {
      expect(
        classify({
          "browser.platform": "Android",
          "device.manufacturer": "Samsung",
        }),
      ).toBe("browser");
    });

    test("a plain backend service is still not client telemetry", () => {
      expect(
        classify({
          "service.name": "checkout",
          "telemetry.sdk.language": "nodejs",
        }),
      ).toBeNull();
    });
  });

  /*
   * The classifier is an internal detail; this is the symptom the customer
   * would actually report. A host that names its manufacturer must keep its
   * Service row, because a null service name is what routes the batch away
   * from `telemetryServiceFromName`.
   */
  describe("the customer-visible consequence", () => {
    test("a host naming its manufacturer keeps its service name", async () => {
      await expect(
        baseService["getServiceNameFromAttributes"](
          requestWithoutServiceNameHeader(),
          attributes({
            "service.name": "payments-api",
            "host.name": "wbprjdeais002",
            "host.arch": "amd64",
            "os.type": "windows",
            "device.manufacturer": "Dell Inc.",
          }),
        ),
      ).resolves.toBe("payments-api");
    });

    test("a real mobile batch still yields no service name", async () => {
      await expect(
        baseService["getServiceNameFromAttributes"](
          requestWithoutServiceNameHeader(),
          attributes({
            "service.name": "storefront-mobile",
            "device.id": "8f2c-install-scoped",
            "device.manufacturer": "Samsung",
          }),
        ),
      ).resolves.toBeNull();
    });
  });
});
