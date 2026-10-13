import { describe, expect, jest, test } from "@jest/globals";
import Protocol from "../../../Types/API/Protocol";
import type * as MobileAppServerUrlModule from "../../../../App/FeatureSet/Dashboard/src/Utils/MobileAppServerUrl";

/*
 * The address the "Get the mobile app" steps tell a person to connect the
 * OneUptime On-Call app to (Dashboard Utils/MobileAppServerUrl). The app's
 * first screen asks for it, filled in with OneUptime Cloud's, and checks it
 * by reading <address>/api/status - so it is the origin the API is served
 * from: the Dashboard's configured host, the way the agent and MCP setup
 * pages print it, or, with none configured, where the page came from.
 */

function addressWith(config: {
  HOST: string;
  HTTP_PROTOCOL: Protocol;
}): string {
  let address: string = "";

  jest.isolateModules(() => {
    jest.doMock("../../../UI/Config", () => {
      return {
        __esModule: true,
        HOST: config.HOST,
        HTTP_PROTOCOL: config.HTTP_PROTOCOL,
      };
    });

    const helper: typeof MobileAppServerUrlModule = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Utils/MobileAppServerUrl",
    ) as typeof MobileAppServerUrlModule;

    address = helper.getMobileAppServerUrl();
  });

  return address;
}

describe("the address the mobile app connects to", () => {
  test("OneUptime Cloud: the address the app fills in by itself", () => {
    expect(
      addressWith({ HOST: "oneuptime.com", HTTP_PROTOCOL: Protocol.HTTPS }),
    ).toBe("https://oneuptime.com");
  });

  test("a self-hosted server: its own host, with its port and protocol", () => {
    expect(
      addressWith({
        HOST: "oneuptime.acme.internal:8443",
        HTTP_PROTOCOL: Protocol.HTTPS,
      }),
    ).toBe("https://oneuptime.acme.internal:8443");
    expect(
      addressWith({ HOST: "10.0.4.12", HTTP_PROTOCOL: Protocol.HTTP }),
    ).toBe("http://10.0.4.12");
  });

  test("an origin and nothing more: the app adds /api/status to it", () => {
    const address: string = addressWith({
      HOST: "status.example.com",
      HTTP_PROTOCOL: Protocol.HTTPS,
    });

    expect(new URL(address).origin).toBe(address);
  });

  test("no host configured: where this page came from", () => {
    expect(addressWith({ HOST: "", HTTP_PROTOCOL: Protocol.HTTPS })).toBe(
      window.location.origin,
    );
  });
});
