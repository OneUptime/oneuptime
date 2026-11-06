import {
  CLOUD_CONNECTION_ID_ATTRIBUTE,
  isCloudConnectionDeliveredResource,
} from "../../../Types/Cloud/CloudConnectionTelemetry";
import {
  CLOUD_CONNECTION_ID_ATTRIBUTE as PAYLOAD_CONNECTION_ID_ATTRIBUTE,
  OtlpAttribute,
  connectionResourceAttributes,
} from "../../../Server/Utils/CloudConnection/CloudMetricPayload";
import { describe, expect, test } from "@jest/globals";

/*
 * Telemetry a cloud connection delivers itself - its reads' metrics and
 * what a stream of the cloud's own metrics and logs delivers - carries the
 * connection's id, and nothing a workload sends of its own does. Discovery
 * reads it to keep what a connection delivers off apps and instances
 * (CloudAppIdentity), so the attribute must be the one the connection's
 * reads write, and the check must hold for every way a getter answers.
 */

function getter(
  values: Record<string, string | null | undefined>,
): (key: string) => string | null | undefined {
  return (key: string): string | null | undefined => {
    return values[key];
  };
}

describe("the attribute a cloud connection's telemetry carries", () => {
  test("is OneUptime's own, named for the connection", () => {
    expect(CLOUD_CONNECTION_ID_ATTRIBUTE).toBe("oneuptime.cloud.connection.id");
  });

  test("is the one a connection's reads write on every resource they export", () => {
    expect(PAYLOAD_CONNECTION_ID_ATTRIBUTE).toBe(CLOUD_CONNECTION_ID_ATTRIBUTE);

    const attributes: Array<OtlpAttribute> = connectionResourceAttributes({
      serviceName: "Production AWS",
      connectionId: "33333333-3333-4333-8333-333333333333",
      cloudProvider: "aws",
    });
    const read: (key: string) => string | null = (
      key: string,
    ): string | null => {
      const found: OtlpAttribute | undefined = attributes.find(
        (attribute: OtlpAttribute): boolean => {
          return attribute.key === key;
        },
      );

      return found ? (found.value["stringValue"] as string) : null;
    };

    expect(isCloudConnectionDeliveredResource(read)).toBe(true);
  });
});

describe("isCloudConnectionDeliveredResource", () => {
  test("a resource with a connection's id is the connection's", () => {
    expect(
      isCloudConnectionDeliveredResource(
        getter({
          [CLOUD_CONNECTION_ID_ATTRIBUTE]:
            "33333333-3333-4333-8333-333333333333",
          "service.name": "Production AWS",
        }),
      ),
    ).toBe(true);
  });

  test.each([
    ["no connection id", {}],
    ["a null one", { [CLOUD_CONNECTION_ID_ATTRIBUTE]: null }],
    ["an empty one", { [CLOUD_CONNECTION_ID_ATTRIBUTE]: "" }],
    ["a blank one", { [CLOUD_CONNECTION_ID_ATTRIBUTE]: "   " }],
    [
      "only a workload's own attributes",
      {
        "service.name": "storefront",
        "cloud.platform": "aws_app_runner",
        "cloud.account.id": "123456789012",
      },
    ],
    [
      "the security events' attribute, which names a connection otherwise",
      { "oneuptime.cloud.connection_id": "33333333" },
    ],
  ])(
    "%s is a workload's own telemetry",
    (_label: string, values: Record<string, string | null>) => {
      expect(isCloudConnectionDeliveredResource(getter(values))).toBe(false);
    },
  );
});
