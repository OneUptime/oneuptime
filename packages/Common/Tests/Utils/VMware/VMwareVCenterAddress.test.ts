import { describe, expect, test } from "@jest/globals";
import VMwareVCenterAddress, {
  VCenterAddressResult,
} from "../../../Utils/VMware/VMwareVCenterAddress";

/*
 * The one reading of a vCenter address that the dashboard's form, the
 * server's save hook and the probe share: what people paste from the
 * browser is accepted and stored as https://host[:port]; anything that would
 * make the address mean something else is refused with what to type.
 */

function urlOf(input: string): string | undefined {
  return VMwareVCenterAddress.normalize(input).address?.url;
}

function errorOf(input: string | null | undefined): string | undefined {
  return VMwareVCenterAddress.normalize(input).error;
}

describe("VMwareVCenterAddress.normalize", () => {
  test.each([
    ["vcsa.example.com", "https://vcsa.example.com"],
    ["https://vcsa.example.com", "https://vcsa.example.com"],
    ["HTTPS://VCSA.Example.COM/", "https://vcsa.example.com"],
    ["https://vcsa.example.com/ui/", "https://vcsa.example.com"],
    ["https://vcsa.example.com/sdk", "https://vcsa.example.com"],
    ["https://vcsa.example.com:443/sdk", "https://vcsa.example.com"],
    ["vcsa.example.com:8443", "https://vcsa.example.com:8443"],
    ["  https://vcsa.example.com.  ", "https://vcsa.example.com"],
    ["//vcsa.example.com", "https://vcsa.example.com"],
    ["10.0.0.20", "https://10.0.0.20"],
    ["https://[fd12:3456::20]:8443/ui", "https://[fd12:3456::20]:8443"],
  ])("%s is stored as %s", (input: string, expected: string) => {
    expect(urlOf(input)).toBe(expected);
  });

  test("says what it found: host, port and whether it is an IP address", () => {
    const result: VCenterAddressResult = VMwareVCenterAddress.normalize(
      "https://[FD12:3456::20]:8443",
    );

    expect(result.address).toEqual({
      url: "https://[fd12:3456::20]:8443",
      host: "fd12:3456::20",
      port: 8443,
      isIpAddress: true,
    });
    expect(VMwareVCenterAddress.normalize("vcsa.example.com").address).toEqual({
      url: "https://vcsa.example.com",
      host: "vcsa.example.com",
      port: 443,
      isIpAddress: false,
    });
  });

  test("an empty address asks for one", () => {
    expect(errorOf("")).toBe(
      "Enter vCenter's address, such as vcsa.example.com or https://10.0.0.20.",
    );
    expect(errorOf(null)).toBe(errorOf(""));
    expect(errorOf(undefined)).toBe(errorOf(""));
    expect(errorOf("   ")).toBe(errorOf(""));
  });

  test("plain http is refused: a password is never sent unencrypted", () => {
    expect(errorOf("http://vcsa.example.com")).toBe(
      "Use https://. vCenter serves its API over HTTPS only, and OneUptime never sends a password unencrypted.",
    );
  });

  test("a user name or password in the address is refused - they have fields of their own", () => {
    const message: string =
      "Leave the user name and password out of the address. They have fields of their own.";

    expect(errorOf("https://admin:secret@vcsa.example.com")).toBe(message);
    expect(errorOf("admin@vcsa.example.com")).toBe(message);
  });

  test("a path other than vCenter's own is refused", () => {
    expect(errorOf("https://vcsa.example.com/folder/x")).toBe(
      "Enter only vCenter's address, without a path - such as https://vcsa.example.com.",
    );
  });

  test.each([
    "ftp://vcsa.example.com",
    "https://vcsa.example.com/?x=1",
    "https://vcsa.example.com/#top",
    "vcsa example.com",
    "https://",
    "https://exa mple.com",
  ])("%s is not an address", (input: string) => {
    expect(errorOf(input)).toBe(
      "Enter vCenter's address as you open it in a browser, such as https://vcsa.example.com.",
    );
  });

  test.each([
    "localhost",
    "https://LOCALHOST:443",
    "vcenter.localhost",
    "127.0.0.1",
    "127.10.0.1",
    "0.0.0.0",
    "169.254.169.254",
    "metadata.google.internal",
    "metadata.goog",
    "instance-data.ec2.internal",
    "100.100.100.200",
    "[::1]",
    "[::]",
    "[fe80::1]",
    "[febf::1]",
    "[fd00:ec2::254]",
    "[::ffff:127.0.0.1]",
    "[::ffff:a9fe:a9fe]",
  ])("%s is never connected to", (input: string) => {
    expect(errorOf(input)).toBe(
      "Loopback, link-local and cloud metadata addresses are never used. Enter vCenter's own host name or IP address.",
    );
  });

  test.each([
    "10.0.0.20",
    "172.16.0.5",
    "192.168.1.10",
    "100.64.0.1",
    "[fd12:3456::20]",
    "[fec0::1]",
    "[::ffff:10.0.0.20]",
  ])(
    "%s - a private address, where vCenter usually is - is accepted",
    (input: string) => {
      expect(errorOf(input)).toBeUndefined();
    },
  );
});

describe("VMwareVCenterAddress.getEndpointKey", () => {
  test("is host:port, the same for every spelling of one address", () => {
    expect(
      VMwareVCenterAddress.getEndpointKey("https://vcsa.example.com"),
    ).toBe("vcsa.example.com:443");
    expect(VMwareVCenterAddress.getEndpointKey("VCSA.example.com:443/ui")).toBe(
      "vcsa.example.com:443",
    );
    expect(
      VMwareVCenterAddress.getEndpointKey("https://vcsa.example.com:8443"),
    ).toBe("vcsa.example.com:8443");
  });

  test("is null for no address, or one that is not valid", () => {
    expect(VMwareVCenterAddress.getEndpointKey(null)).toBeNull();
    expect(VMwareVCenterAddress.getEndpointKey("http://vcsa")).toBeNull();
  });
});

describe("VMwareVCenterAddress.getDefaultName", () => {
  test("names a vCenter after its host", () => {
    expect(
      VMwareVCenterAddress.getDefaultName("https://vcsa.example.com:8443/ui"),
    ).toBe("vcsa.example.com");
    expect(VMwareVCenterAddress.getDefaultName("not valid at all")).toBeNull();
  });
});
