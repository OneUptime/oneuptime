import { describe, expect, test } from "@jest/globals";
import OpenStackAuthUrl, {
  OpenStackAddress,
  OpenStackAddressResult,
} from "../../../Utils/OpenStack/OpenStackAuthUrl";

/*
 * The address a person pastes, and the addresses a catalog names, read the one way the
 * server, the dashboard and the probe agree on. What is at stake is where a credential is
 * sent, so everything that would make an address mean something other than "this Keystone"
 * is refused, with a sentence that says what to type.
 */

function address(input: string): OpenStackAddress {
  const result: OpenStackAddressResult = OpenStackAuthUrl.normalize(input);

  if (!result.address) {
    throw new Error(`${input} was refused: ${result.error}`);
  }

  return result.address;
}

function refusal(input: string | null | undefined): string {
  const result: OpenStackAddressResult = OpenStackAuthUrl.normalize(input);

  if (result.address) {
    throw new Error(`${input} was accepted as ${result.address.url}.`);
  }

  return result.error;
}

describe("what people paste from clouds.yaml and openrc", () => {
  test.each([
    [
      "https://keystone.example.com:5000/v3",
      "https://keystone.example.com:5000",
    ],
    [
      "https://keystone.example.com:5000/v3/",
      "https://keystone.example.com:5000",
    ],
    [
      "https://keystone.example.com:5000/v3.0",
      "https://keystone.example.com:5000",
    ],
    [
      "https://keystone.example.com:5000/v2.0",
      "https://keystone.example.com:5000",
    ],
    ["https://keystone.example.com:5000", "https://keystone.example.com:5000"],
    ["https://keystone.example.com:5000/", "https://keystone.example.com:5000"],
    [
      "https://cloud.example.com/identity/v3",
      "https://cloud.example.com/identity",
    ],
    [
      "https://cloud.example.com/identity/v3/",
      "https://cloud.example.com/identity",
    ],
    [
      "https://cloud.example.com/identity",
      "https://cloud.example.com/identity",
    ],
    ["https://cloud.example.com/a/b/v3", "https://cloud.example.com/a/b"],
    ["keystone.example.com:5000/v3", "https://keystone.example.com:5000"],
    ["//keystone.example.com:5000/v3", "https://keystone.example.com:5000"],
    [
      "HTTPS://KEYSTONE.Example.COM:5000/V3",
      "https://keystone.example.com:5000",
    ],
    [
      "  https://keystone.example.com:5000/v3  ",
      "https://keystone.example.com:5000",
    ],
    ["https://keystone.example.com./v3", "https://keystone.example.com"],
    ["https://keystone.example.com:443/v3", "https://keystone.example.com"],
    ["https://10.0.0.5:5000/v3", "https://10.0.0.5:5000"],
    ["https://[2001:db8::1]:5000/v3", "https://[2001:db8::1]:5000"],
  ])("%s becomes %s", (input: string, url: string) => {
    expect(address(input).url).toBe(url);
  });

  test("the parts of it are all there", () => {
    expect(address("https://cloud.example.com:8443/identity/v3")).toEqual({
      url: "https://cloud.example.com:8443/identity",
      host: "cloud.example.com",
      port: 8443,
      path: "/identity",
      isIpAddress: false,
    });
  });

  test("an address with no port is on 443", () => {
    expect(address("https://cloud.example.com").port).toBe(443);
  });

  test("an address that is an address says so", () => {
    expect(address("https://10.0.0.5").isIpAddress).toBe(true);
    expect(address("https://[2001:db8::1]")).toMatchObject({
      host: "2001:db8::1",
      isIpAddress: true,
    });
  });

  test("a path that only looks like a version stays", () => {
    expect(address("https://cloud.example.com/v3x").path).toBe("/v3x");
    expect(address("https://cloud.example.com/keystone-v3").path).toBe(
      "/keystone-v3",
    );
  });

  test("what comes out reads the same when it goes back in", () => {
    for (const input of [
      "https://keystone.example.com:5000/v3",
      "https://cloud.example.com/identity/v3",
      "https://[2001:db8::1]:5000",
    ]) {
      const once: string = address(input).url;

      expect(address(once).url).toBe(once);
    }
  });
});

describe("what it refuses, and what it says instead", () => {
  test.each([[null], [undefined], [""], ["   "]])(
    "nothing at all (%s)",
    (input: string | null | undefined) => {
      expect(refusal(input)).toContain("Enter Keystone's address");
    },
  );

  test("plain HTTP, and it says what to do with a cloud that only speaks that", () => {
    const error: string = refusal("http://keystone.example.com:5000/v3");

    expect(error).toContain("Use https://");
    expect(error).toContain("never sends a credential or a token unencrypted");
    expect(error).toContain("needs the OpenStack agent");
  });

  test.each([
    ["ftp://keystone.example.com"],
    ["ws://keystone.example.com"],
    ["javascript://keystone.example.com"],
    ["file://keystone.example.com"],
  ])("another scheme (%s)", (input: string) => {
    expect(refusal(input)).toContain(
      "as your clouds.yaml or openrc file has it",
    );
  });

  test.each([
    ["https://admin:secret@keystone.example.com/v3"],
    ["https://admin@keystone.example.com/v3"],
    ["admin:secret@keystone.example.com"],
  ])(
    "a user in the address (%s): an address is shown to everyone",
    (input: string) => {
      expect(refusal(input)).toContain("Leave the user name and password out");
    },
  );

  test.each([
    ["https://keystone.example.com/v3?x=1"],
    ["https://keystone.example.com/v3#fragment"],
    ["https://key stone.example.com/v3"],
    ["https://keystone.example.com/v3\n"],
    ["https://"],
    ["https://:5000"],
    ["https://keystone.example.com:99999"],
  ])("what would make it mean something else (%j)", (input: string) => {
    // A trailing newline trims away, and that one is simply an address.
    if (input.endsWith("\n")) {
      expect(address(input).host).toBe("keystone.example.com");
      return;
    }

    expect(refusal(input)).toContain(
      "as your clouds.yaml or openrc file has it",
    );
  });

  test.each([
    ["https://localhost:5000"],
    ["https://LOCALHOST:5000"],
    ["https://foo.localhost:5000"],
    ["https://127.0.0.1:5000"],
    ["https://127.1.2.3:5000"],
    ["https://0.0.0.0:5000"],
    ["https://[::1]:5000"],
    ["https://[::]:5000"],
    ["https://169.254.169.254"],
    ["https://169.254.1.1"],
    ["https://[fe80::1]"],
    ["https://metadata.google.internal"],
  ])("an address no probe ever connects to (%s)", (input: string) => {
    expect(refusal(input)).toContain(
      "Loopback, link-local and cloud metadata addresses are never used",
    );
  });

  test.each([
    ["https://10.0.0.5:5000"],
    ["https://172.16.0.1:5000"],
    ["https://192.168.1.10:5000"],
    ["https://[fd00::1]:5000"],
  ])("a private address is where a cloud usually is (%s)", (input: string) => {
    expect(OpenStackAuthUrl.normalize(input).address).toBeDefined();
  });
});

describe("the key a saved credential is bound to", () => {
  test("is the host, the port and the path", () => {
    expect(
      OpenStackAuthUrl.getEndpointKey(
        "https://cloud.example.com:5000/identity/v3",
      ),
    ).toBe("cloud.example.com:5000/identity");
  });

  test.each([
    [
      "https://keystone.example.com:5000/v3",
      "https://KEYSTONE.example.com:5000/",
    ],
    ["https://keystone.example.com/v3", "https://keystone.example.com:443"],
    ["keystone.example.com:5000", "https://keystone.example.com:5000/v3/"],
  ])("%s and %s are the same Keystone", (first: string, second: string) => {
    expect(OpenStackAuthUrl.getEndpointKey(first)).toBe(
      OpenStackAuthUrl.getEndpointKey(second),
    );
  });

  test.each([
    ["another host", "https://evil.example.com:5000"],
    ["another port", "https://keystone.example.com:5001"],
    ["another path", "https://keystone.example.com:5000/other"],
  ])(
    "%s is another Keystone, and a credential does not go there",
    (_name: string, url: string) => {
      expect(OpenStackAuthUrl.getEndpointKey(url)).not.toBe(
        OpenStackAuthUrl.getEndpointKey("https://keystone.example.com:5000"),
      );
    },
  );

  test.each([[null], [undefined], [""], ["http://keystone.example.com"]])(
    "what is not an address has none (%s)",
    (url: string | null | undefined) => {
      expect(OpenStackAuthUrl.getEndpointKey(url)).toBeNull();
    },
  );
});

describe("the name a cloud nobody named gets", () => {
  test("is its host", () => {
    expect(
      OpenStackAuthUrl.getDefaultName(
        "https://cloud.example.com:5000/identity",
      ),
    ).toBe("cloud.example.com");
  });

  test("and none when there is no address", () => {
    expect(OpenStackAuthUrl.getDefaultName("not a url at all")).toBeNull();
  });
});

describe("what a catalog names, which is only as trustworthy as the Keystone that wrote it", () => {
  test.each([
    ["https://nova.example.com:8774/v2.1"],
    ["https://cloud.example.com/compute/v2.1/project-id"],
    ["https://10.0.0.5:8774"],
  ])("%s may be spoken to", (url: string) => {
    expect(OpenStackAuthUrl.getCatalogUrlRefusal(url)).toBeNull();
  });

  test.each([
    ["http://nova.example.com:8774/v2.1", "insecure", "plain HTTP"],
    ["https://127.0.0.1:8774", "forbidden", "no probe connects to"],
    ["https://localhost:8774", "forbidden", "no probe connects to"],
    ["https://169.254.169.254/latest", "forbidden", "no probe connects to"],
    ["https://[::1]:8774", "forbidden", "no probe connects to"],
    ["https://me:pw@nova.example.com", "invalid", "a user name"],
    ["ftp://nova.example.com", "invalid", "not an HTTPS URL"],
    ["not a url", "invalid", "not a URL"],
    ["", "invalid", "not a URL"],
  ])("%s is %s", (url: string, code: string, words: string) => {
    const result: ReturnType<typeof OpenStackAuthUrl.getCatalogUrlRefusal> =
      OpenStackAuthUrl.getCatalogUrlRefusal(url);

    expect(result?.code).toBe(code);
    expect(result?.message).toContain(words);
  });

  test("a user's password in a catalog's URL is never repeated", () => {
    expect(
      OpenStackAuthUrl.getCatalogUrlRefusal(
        "https://me:hunter2@nova.example.com",
      )?.message,
    ).not.toContain("hunter2");
  });
});
