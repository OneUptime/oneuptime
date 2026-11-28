import {
  RUM_CLIENT_KIND_BROWSER,
  RUM_CLIENT_KIND_MOBILE,
  RumClientResourceReader,
  getRumClientKindOfResource,
} from "../../../Types/Rum/RumClientKind";
import { describe, expect, test } from "@jest/globals";

/*
 * The one reading of a resource that both the ingest (OtelIngestBaseService.
 * getRumClientType) and the Inventory's Host resolver (TelemetryEntity) file
 * a RUM client by, so a device an app names in host.name is a host item in
 * Inventory exactly when ingest files its telemetry as RUM (issue #11257).
 */

function reader(
  attributes: Record<string, string | Array<string>>,
  hasHostIdentity: boolean = false,
): RumClientResourceReader {
  return {
    read: (key: string): string | null => {
      const value: string | Array<string> | undefined = attributes[key];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    },
    readList: (key: string): Array<string> => {
      const value: string | Array<string> | undefined = attributes[key];
      return Array.isArray(value) ? value : [];
    },
    hasHostIdentity: (): boolean => {
      return hasHostIdentity;
    },
  };
}

describe("getRumClientKindOfResource", () => {
  test("a public key's stamp is read first, whatever else the resource says", () => {
    expect(
      getRumClientKindOfResource(
        reader({
          "oneuptime.rum.client.kind": "mobile",
          "browser.language": "en-US",
        }),
      ),
    ).toBe(RUM_CLIENT_KIND_MOBILE);
    expect(
      getRumClientKindOfResource(
        reader({
          "oneuptime.rum.client.kind": "browser",
          "device.id": "d1",
        }),
      ),
    ).toBe(RUM_CLIENT_KIND_BROWSER);
  });

  test("the browser detector's attributes are a browser's", () => {
    for (const attributes of [
      { "browser.platform": "Windows" },
      { "browser.language": "en-US" },
      { "browser.brands": ["Chromium 128"] },
    ] as Array<Record<string, string | Array<string>>>) {
      expect(getRumClientKindOfResource(reader(attributes))).toBe(
        RUM_CLIENT_KIND_BROWSER,
      );
    }
  });

  test("a mobile SDK's device attributes are a mobile app's", () => {
    expect(
      getRumClientKindOfResource(reader({ "device.id": "b3f1c2d4" })),
    ).toBe(RUM_CLIENT_KIND_MOBILE);
    expect(
      getRumClientKindOfResource(
        reader({ "device.model.identifier": "SM-T510" }),
      ),
    ).toBe(RUM_CLIENT_KIND_MOBILE);
  });

  test("a make alone is a phone's only where nothing names a machine", () => {
    expect(
      getRumClientKindOfResource(
        reader({ "device.manufacturer": "Samsung" }, false),
      ),
    ).toBe(RUM_CLIENT_KIND_MOBILE);
    expect(
      getRumClientKindOfResource(
        reader({ "device.manufacturer": "Dell Inc." }, true),
      ),
    ).toBeNull();
  });

  test("a backend's or a host's resource is no client", () => {
    expect(
      getRumClientKindOfResource(
        reader({ "service.name": "billing", "telemetry.sdk.language": "go" }),
      ),
    ).toBeNull();
    expect(
      getRumClientKindOfResource(
        reader({ "oneuptime.rum.client.kind": "desktop" }),
      ),
    ).toBeNull();
  });
});
