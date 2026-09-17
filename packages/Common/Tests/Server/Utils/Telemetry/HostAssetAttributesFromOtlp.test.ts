/*
 * End-to-end for issue #3866, at the only seam that proves the feature
 * works: a real OTLP resource-attribute payload, flattened exactly the way
 * ingest flattens it, fed to the entity extractor.
 *
 * TelemetryEntity.test.ts covers the extractor against a hand-built
 * dictionary, which is where the logic lives. It cannot catch the failure
 * that actually matters here — that `host.ip` arrives from the wire in a
 * shape the extractor does not recognise. An OTLP `arrayValue` has to
 * survive `TelemetryUtil.getAttributes` as a real JS array under the same
 * key; if it were ever flattened to `host.ip.0` / `host.ip.1`, or
 * serialized to a string, every assertion in the other suite would still
 * pass while the Attributes card stayed empty.
 *
 * Stub the DatabaseService base class out before TelemetryUtil's import
 * graph drags the server-side service layer in. See
 * TelemetryUtilAttributeKeys.test.ts for why the stub needs these methods.
 */
jest.mock("../../../../Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class DatabaseServiceStub {
      public hardDeleteItemsOlderThanInDays(): void {
        // no-op: retention config, nothing for a pure unit test to do.
      }

      public setDoNotAllowDelete(): void {
        // no-op: delete-permission config, same.
      }
    },
  };
});

import TelemetryUtil, {
  AttributeType,
} from "../../../../Server/Utils/Telemetry/Telemetry";
import InventoryItem, {
  EntityAttributes,
  ExtractedEntity,
} from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import EntityType from "../../../../Types/Telemetry/EntityType";
import Dictionary from "../../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { normalizeHostIpAddresses } from "../../../../Utils/Telemetry/HostIpAddresses";
import { describe, expect, test } from "@jest/globals";

const PROJECT: string = "proj1";

/*
 * `OtelPayloadDecoder.decodeFromQueue` runs protobuf `message.toJSON()`,
 * which camelCases field names — so camelCase is the shape ingest really
 * sees. OTLP/JSON producers can send snake_case instead, and
 * `getAttributeValues` handles both; the snake_case case is asserted below.
 */
function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function stringArrayAttribute(key: string, values: Array<string>): JSONObject {
  return {
    key: key,
    value: {
      arrayValue: {
        values: values.map((value: string) => {
          return { stringValue: value };
        }),
      },
    },
  };
}

function snakeCaseStringArrayAttribute(
  key: string,
  values: Array<string>,
): JSONObject {
  return {
    key: key,
    value: {
      array_value: {
        values: values.map((value: string) => {
          return { string_value: value };
        }),
      },
    },
  };
}

const IP_ADDRESSES: Array<string> = [
  "10.1.2.3",
  "10.1.2.4",
  "fe80::42:acff:fe11:1",
];

/*
 * The reporter's machine: a Windows host whose collector runs the `system`
 * resource detector and has the three hardware values stamped onto the
 * resource. Deliberately carries no container.runtime, which would route
 * the batch to the DockerHost table instead.
 */
function windowsHostResourceAttributes(): JSONArray {
  return [
    stringAttribute("host.name", "wbprjdeais002"),
    stringAttribute("host.arch", "amd64"),
    stringAttribute("host.id", "4C4C4544-0037-5A10-8054-B4C04F335931"),
    stringArrayAttribute("host.ip", IP_ADDRESSES),
    stringAttribute("os.type", "windows"),
    stringAttribute("os.description", "Microsoft Windows 11 Enterprise"),
    stringAttribute("host.serial_number", "7XYZ123"),
    stringAttribute("device.manufacturer", "Dell Inc."),
    stringAttribute("device.model.name", "OptiPlex 7090"),
  ] as JSONArray;
}

/** Exactly what `OTelIngestService.resolveTelemetryResource` does. */
function extractHost(attributes: JSONArray): ExtractedEntity | undefined {
  const flat: Dictionary<AttributeType | Array<AttributeType>> =
    TelemetryUtil.getAttributes({
      items: attributes,
      prefixKeysWithString: "",
    });

  return InventoryItem.extractEntities({
    projectId: PROJECT,
    attributes: flat as EntityAttributes,
  }).find((entity: ExtractedEntity) => {
    return entity.entityType === EntityType.Host;
  });
}

describe("host asset attributes survive the OTLP wire shape (issue #3866)", () => {
  test("an OTLP arrayValue reaches the extractor as a real array under the same key", () => {
    const flat: Dictionary<AttributeType | Array<AttributeType>> =
      TelemetryUtil.getAttributes({
        items: windowsHostResourceAttributes(),
        prefixKeysWithString: "",
      });

    expect(Array.isArray(flat["host.ip"])).toBe(true);
    expect(flat["host.ip"]).toEqual(IP_ADDRESSES);
    // Not flattened into indexed keys, which would make the join unreachable.
    expect(flat["host.ip.0"]).toBeUndefined();
  });

  test("the reporter's Windows host yields every requested attribute", () => {
    const host: ExtractedEntity | undefined = extractHost(
      windowsHostResourceAttributes(),
    );

    expect(host).toBeDefined();
    expect(host!.descriptiveAttributes).toEqual({
      "os.type": "windows",
      "os.description": "Microsoft Windows 11 Enterprise",
      "host.arch": "amd64",
      "host.id": "4C4C4544-0037-5A10-8054-B4C04F335931",
      "host.ip": "10.1.2.3, 10.1.2.4, fe80::42:acff:fe11:1",
      "host.serial_number": "7XYZ123",
      "device.manufacturer": "Dell Inc.",
      "device.model.name": "OptiPlex 7090",
    });
  });

  test("identity is still the host name alone", () => {
    const host: ExtractedEntity | undefined = extractHost(
      windowsHostResourceAttributes(),
    );

    expect(host!.identifyingAttributes).toEqual({
      "host.name": "wbprjdeais002",
    });
  });

  /*
   * The key is a hash of the identifying set only. If any asset attribute
   * leaked into it, the existing row would fork the moment a host got a new
   * IP — which is exactly the duplicate-inventory failure mode.
   */
  test("the entity key is unchanged by every asset attribute", () => {
    const withAssets: ExtractedEntity | undefined = extractHost(
      windowsHostResourceAttributes(),
    );
    const nameOnly: ExtractedEntity | undefined = extractHost([
      stringAttribute("host.name", "wbprjdeais002"),
      stringAttribute("os.type", "windows"),
    ] as JSONArray);

    expect(withAssets!.entityKey).toBe(nameOnly!.entityKey);
  });

  test("a snake_case OTLP/JSON producer yields the identical entity", () => {
    const camelCase: ExtractedEntity | undefined = extractHost(
      windowsHostResourceAttributes(),
    );
    const snakeCase: ExtractedEntity | undefined = extractHost([
      stringAttribute("host.name", "wbprjdeais002"),
      stringAttribute("os.type", "windows"),
      snakeCaseStringArrayAttribute("host.ip", IP_ADDRESSES),
      stringAttribute("host.arch", "amd64"),
      stringAttribute("host.id", "4C4C4544-0037-5A10-8054-B4C04F335931"),
      stringAttribute("os.description", "Microsoft Windows 11 Enterprise"),
      stringAttribute("host.serial_number", "7XYZ123"),
      stringAttribute("device.manufacturer", "Dell Inc."),
      stringAttribute("device.model.name", "OptiPlex 7090"),
    ] as JSONArray);

    expect(snakeCase!.entityKey).toBe(camelCase!.entityKey);
    expect(snakeCase!.descriptiveAttributes).toEqual(
      camelCase!.descriptiveAttributes,
    );
  });

  test("the joined value matches what the Host column stores", () => {
    const host: ExtractedEntity | undefined = extractHost(
      windowsHostResourceAttributes(),
    );

    expect(host!.descriptiveAttributes!["host.ip"]).toBe(
      normalizeHostIpAddresses(IP_ADDRESSES),
    );
  });

  /*
   * Unchanged behaviour, asserted here because the new attributes are
   * exactly the kind of thing a Kubernetes node also reports: a resource
   * carrying a Kubernetes identity must still mint no Host at all.
   */
  test("a Kubernetes resource still yields no Host entity", () => {
    const host: ExtractedEntity | undefined = extractHost([
      ...(windowsHostResourceAttributes() as Array<JSONObject>),
      stringAttribute("k8s.cluster.name", "prod-us"),
      stringAttribute("k8s.node.name", "node-1"),
    ] as JSONArray);

    expect(host).toBeUndefined();
  });
});
