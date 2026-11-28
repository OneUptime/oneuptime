import { describe, expect, test } from "@jest/globals";
import POWERMAX_PROBE_COLLECTOR from "../../../Types/StorageArray/Platforms/Dell/PowerMax/PowerMaxProbeCollector";
import StorageArrayConnectionAddress, {
  STORAGE_ARRAY_INVALID_ADDRESS_MESSAGE,
  StorageArrayAddressResult,
} from "../../../Utils/StorageArray/StorageArrayConnectionAddress";

/*
 * The address a person types for Unisphere for PowerMax (#11004), read the
 * one way the dashboard, the server and the probe agree on: as a browser
 * shows it, written back as the one https://host:port the probe connects
 * to - never plain http, never with a password in it, never a loopback,
 * link-local or cloud metadata host.
 */

function normalize(
  input: string | null | undefined,
): StorageArrayAddressResult {
  return StorageArrayConnectionAddress.normalize(
    input,
    POWERMAX_PROBE_COLLECTOR,
  );
}

describe("StorageArrayConnectionAddress: what is accepted", () => {
  test.each([
    ["unisphere.example.com", "https://unisphere.example.com:8443"],
    ["Unisphere.Example.com", "https://unisphere.example.com:8443"],
    ["https://unisphere.example.com", "https://unisphere.example.com:8443"],
    [
      "HTTPS://unisphere.example.com:8443",
      "https://unisphere.example.com:8443",
    ],
    ["unisphere.example.com:9443", "https://unisphere.example.com:9443"],
    ["//unisphere.example.com", "https://unisphere.example.com:8443"],
    ["unisphere.example.com.", "https://unisphere.example.com:8443"],
    ["  unisphere.example.com  ", "https://unisphere.example.com:8443"],
    // What a browser shows for Unisphere, pasted as it is.
    [
      "https://unisphere.example.com:8443/univmax",
      "https://unisphere.example.com:8443",
    ],
    [
      "https://unisphere.example.com:8443/univmax/",
      "https://unisphere.example.com:8443",
    ],
    [
      "https://unisphere.example.com:8443/univmax/restapi",
      "https://unisphere.example.com:8443",
    ],
    [
      "https://unisphere.example.com:8443/univmax/rest/",
      "https://unisphere.example.com:8443",
    ],
    [
      "https://unisphere.example.com:8443/",
      "https://unisphere.example.com:8443",
    ],
    // Port 443 written, though WHATWG URL drops it.
    ["https://unisphere.example.com:443", "https://unisphere.example.com:443"],
    ["unisphere.example.com:443/univmax", "https://unisphere.example.com:443"],
    ["10.0.0.20", "https://10.0.0.20:8443"],
    ["https://10.0.0.20:8443", "https://10.0.0.20:8443"],
    ["[fd00::20]:8443", "https://[fd00::20]:8443"],
  ])("%s reads as %s", (input: string, url: string) => {
    expect(normalize(input).address?.url).toBe(url);
  });

  test("an address says its host, port, and whether it is an IP address", () => {
    expect(normalize("https://unisphere.example.com:8443").address).toEqual({
      url: "https://unisphere.example.com:8443",
      host: "unisphere.example.com",
      port: 8443,
      isIpAddress: false,
    });
    expect(normalize("10.0.0.20").address).toMatchObject({
      host: "10.0.0.20",
      isIpAddress: true,
    });
    expect(normalize("[fd00::20]").address).toMatchObject({
      host: "fd00::20",
      port: 8443,
      isIpAddress: true,
    });
  });
});

describe("StorageArrayConnectionAddress: what is refused, and why", () => {
  test("nothing typed", () => {
    for (const input of ["", "   ", null, undefined]) {
      expect(normalize(input).error).toBe(
        "Enter the server's address, such as unisphere.example.com or https://10.0.0.20:8443.",
      );
    }
  });

  test("plain http: a password is never sent unencrypted", () => {
    expect(normalize("http://unisphere.example.com:8443").error).toBe(
      "Use https://. The server's API is served over HTTPS, and OneUptime never sends a password unencrypted.",
    );
  });

  test("another scheme, spaces, a query or a fragment", () => {
    for (const input of [
      "ftp://unisphere.example.com",
      "unisphere example.com",
      "https://unisphere.example.com:8443/?a=1",
      "https://unisphere.example.com:8443/#x",
      "https://",
    ]) {
      expect({ input, error: normalize(input).error }).toEqual({
        input,
        error: STORAGE_ARRAY_INVALID_ADDRESS_MESSAGE,
      });
    }
  });

  test("a user name or password in the address", () => {
    for (const input of [
      "https://admin:secret@unisphere.example.com:8443",
      "https://admin@unisphere.example.com",
    ]) {
      expect(normalize(input).error).toBe(
        "Leave the user name and password out of the address. They have fields of their own.",
      );
    }
  });

  test("a path that is not Unisphere's", () => {
    expect(normalize("https://unisphere.example.com:8443/admin").error).toBe(
      "Enter only the server's address, without a path - such as https://unisphere.example.com:8443.",
    );
  });

  test("loopback, link-local and cloud metadata hosts", () => {
    for (const input of [
      "localhost",
      "127.0.0.1",
      "https://[::1]:8443",
      "169.254.169.254",
      "metadata.google.internal",
    ]) {
      expect({ input, error: normalize(input).error }).toEqual({
        input,
        error:
          "Loopback, link-local and cloud metadata addresses are never used. Enter the server's own host name or IP address.",
      });
    }
  });
});

describe("StorageArrayConnectionAddress: what a saved password is bound to", () => {
  test("an address's host and port, however it was written", () => {
    expect(
      StorageArrayConnectionAddress.getEndpointKey(
        "https://Unisphere.example.com:8443/univmax",
        POWERMAX_PROBE_COLLECTOR,
      ),
    ).toBe("unisphere.example.com:8443");
    expect(
      StorageArrayConnectionAddress.getEndpointKey(
        "unisphere.example.com",
        POWERMAX_PROBE_COLLECTOR,
      ),
    ).toBe("unisphere.example.com:8443");
    expect(
      StorageArrayConnectionAddress.getEndpointKey(
        "http://x",
        POWERMAX_PROBE_COLLECTOR,
      ),
    ).toBeNull();
    expect(
      StorageArrayConnectionAddress.getEndpointKey(
        null,
        POWERMAX_PROBE_COLLECTOR,
      ),
    ).toBeNull();
  });

  test("a connection nobody named is named after its host", () => {
    expect(
      StorageArrayConnectionAddress.getDefaultName(
        "https://unisphere-dc1.example.com:8443",
        POWERMAX_PROBE_COLLECTOR,
      ),
    ).toBe("unisphere-dc1.example.com");
    expect(
      StorageArrayConnectionAddress.getDefaultName(
        "",
        POWERMAX_PROBE_COLLECTOR,
      ),
    ).toBeNull();
  });
});
