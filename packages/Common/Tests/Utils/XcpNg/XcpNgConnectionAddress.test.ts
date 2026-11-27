import { describe, expect, test } from "@jest/globals";
import XcpNgConnectionType from "../../../Types/XcpNg/XcpNgConnectionType";
import XcpNgConnectionAddress, {
  XcpNgAddressResult,
} from "../../../Utils/XcpNg/XcpNgConnectionAddress";

/*
 * Where a probe may send an XCP-ng connection's secrets (#10996, #10999):
 * the address a person typed, as the server and the probe both read it -
 * HTTPS only, a host and a port and nothing else, never a loopback,
 * link-local or cloud metadata address. A saved secret is bound to the
 * host and port read here, so two spellings of one address must read the
 * same and two addresses must never.
 */

const XO: XcpNgConnectionType = XcpNgConnectionType.XenOrchestra;
const XAPI: XcpNgConnectionType = XcpNgConnectionType.Xapi;

function urlOf(input: string, type: XcpNgConnectionType = XO): string | null {
  const result: XcpNgAddressResult = XcpNgConnectionAddress.normalize(
    input,
    type,
  );
  return result.address ? result.address.url : null;
}

function errorOf(input: string, type: XcpNgConnectionType = XO): string {
  return XcpNgConnectionAddress.normalize(input, type).error || "";
}

describe("XcpNgConnectionAddress.normalize", () => {
  test.each([
    ["xo.example.com", "https://xo.example.com"],
    ["https://xo.example.com", "https://xo.example.com"],
    ["HTTPS://XO.Example.COM/", "https://xo.example.com"],
    ["https://xo.example.com:443", "https://xo.example.com"],
    ["https://xo.example.com:8443", "https://xo.example.com:8443"],
    ["//xo.example.com", "https://xo.example.com"],
    ["xo.example.com.", "https://xo.example.com"],
    ["  https://10.0.0.5  ", "https://10.0.0.5"],
    // Xen Orchestra 5's pages live behind a fragment, which never reaches it.
    ["https://xo.example.com/#/home", "https://xo.example.com"],
    ["https://xo.example.com/v5", "https://xo.example.com"],
    ["https://xo.example.com/v6/", "https://xo.example.com"],
    ["https://xo.example.com/openmetrics/metrics", "https://xo.example.com"],
    ["https://xo.example.com/rest/v0", "https://xo.example.com"],
    ["https://[fd00::5]", "https://[fd00::5]"],
    ["https://[FD00::5]:9443", "https://[fd00::5]:9443"],
  ])("reads Xen Orchestra's %s as %s", (input: string, url: string) => {
    expect(urlOf(input)).toBe(url);
  });

  test.each([
    ["10.0.0.10", "https://10.0.0.10"],
    ["https://xcp-01.example.com/jsonrpc", "https://xcp-01.example.com"],
    ["https://10.0.0.10:443/", "https://10.0.0.10"],
  ])("reads a pool master's %s as %s", (input: string, url: string) => {
    expect(urlOf(input, XAPI)).toBe(url);
  });

  test("refuses http: no secret is ever sent unencrypted", () => {
    expect(urlOf("http://xo.example.com")).toBeNull();
    expect(errorOf("http://xo.example.com")).toContain("https://");
    expect(urlOf("http://10.0.0.10", XAPI)).toBeNull();
  });

  test("refuses a user name or password in the address: they have fields of their own", () => {
    expect(errorOf("https://admin:secret@xo.example.com")).toContain(
      "user name",
    );
    expect(errorOf("https://root@10.0.0.10", XAPI)).toContain("user name");
  });

  test("refuses a query, and a path that is not the product's own", () => {
    expect(urlOf("https://xo.example.com/?token=abc")).toBeNull();
    expect(urlOf("https://xo.example.com/somewhere")).toBeNull();
    expect(errorOf("https://xo.example.com/somewhere")).toContain(
      "without a path",
    );
    // Each product's paths are its own.
    expect(urlOf("https://xcp-01.example.com/v5", XAPI)).toBeNull();
    expect(urlOf("https://xo.example.com/jsonrpc", XO)).toBeNull();
  });

  test.each([
    ["localhost"],
    ["https://127.0.0.1"],
    ["https://[::1]"],
    ["https://169.254.169.254"],
    ["https://metadata.google.internal"],
  ])(
    "never reads %s: loopback, link-local and metadata addresses are refused",
    (input: string) => {
      expect(urlOf(input)).toBeNull();
      expect(urlOf(input, XAPI)).toBeNull();
    },
  );

  test("words each kind's refusals for what a person typed", () => {
    expect(errorOf("")).toContain("Xen Orchestra");
    expect(errorOf("", XAPI)).toContain("pool master");
    expect(errorOf("ftp://xo.example.com")).toContain("Xen Orchestra");
    expect(errorOf("xo example.com")).not.toBe("");
  });

  test("says whether the host is an address", () => {
    expect(
      XcpNgConnectionAddress.normalize("https://10.0.0.5", XO).address
        ?.isIpAddress,
    ).toBe(true);
    expect(
      XcpNgConnectionAddress.normalize("https://[fd00::5]", XO).address
        ?.isIpAddress,
    ).toBe(true);
    expect(
      XcpNgConnectionAddress.normalize("https://xo.example.com", XO).address
        ?.isIpAddress,
    ).toBe(false);
  });
});

describe("XcpNgConnectionAddress.getEndpointKey", () => {
  test("is one key for every spelling of an address, and another for another port", () => {
    expect(
      XcpNgConnectionAddress.getEndpointKey("https://XO.example.com:443/", XO),
    ).toBe("xo.example.com:443");
    expect(XcpNgConnectionAddress.getEndpointKey("xo.example.com", XO)).toBe(
      "xo.example.com:443",
    );
    expect(
      XcpNgConnectionAddress.getEndpointKey("https://xo.example.com:8443", XO),
    ).toBe("xo.example.com:8443");
    expect(
      XcpNgConnectionAddress.getEndpointKey("https://[fd00::5]", XAPI),
    ).toBe("fd00::5:443");
  });

  test("is null for an address that is not one", () => {
    expect(XcpNgConnectionAddress.getEndpointKey("http://x", XO)).toBeNull();
    expect(XcpNgConnectionAddress.getEndpointKey(null, XO)).toBeNull();
  });
});

describe("XcpNgConnectionAddress.getDefaultName", () => {
  test("names a connection after its host, as the browser's address bar does", () => {
    expect(
      XcpNgConnectionAddress.getDefaultName("https://xo.example.com:8443", XO),
    ).toBe("xo.example.com");
    expect(XcpNgConnectionAddress.getDefaultName("10.0.0.10", XAPI)).toBe(
      "10.0.0.10",
    );
    expect(XcpNgConnectionAddress.getDefaultName("", XO)).toBeNull();
  });
});

describe("XcpNgConnectionAddress.getXapiHostUrl", () => {
  test("reads the address XAPI gives for a pool member as somewhere a probe may connect", () => {
    expect(XcpNgConnectionAddress.getXapiHostUrl("10.0.0.12")).toBe(
      "https://10.0.0.12",
    );
    expect(XcpNgConnectionAddress.getXapiHostUrl("xcp-02.example.com")).toBe(
      "https://xcp-02.example.com",
    );
    // XAPI writes an IPv6 address bare.
    expect(XcpNgConnectionAddress.getXapiHostUrl("fd00::12")).toBe(
      "https://[fd00::12]",
    );
  });

  test("trusts the pool's own report no more than a person's typing", () => {
    expect(XcpNgConnectionAddress.getXapiHostUrl("127.0.0.1")).toBeNull();
    expect(XcpNgConnectionAddress.getXapiHostUrl("169.254.169.254")).toBeNull();
    expect(
      XcpNgConnectionAddress.getXapiHostUrl("http://10.0.0.12"),
    ).toBeNull();
    expect(XcpNgConnectionAddress.getXapiHostUrl("10.0.0.12 evil")).toBeNull();
    expect(XcpNgConnectionAddress.getXapiHostUrl("")).toBeNull();
    expect(XcpNgConnectionAddress.getXapiHostUrl(null)).toBeNull();
  });
});
