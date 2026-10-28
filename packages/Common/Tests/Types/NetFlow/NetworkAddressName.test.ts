import {
  MAX_NAMED_ADDRESSES_PER_PAGE,
  MAX_NETWORK_ADDRESS_NAME_LENGTH,
  NETWORK_ADDRESS_NAME_SOURCES,
  NetworkAddressNameCandidate,
  NetworkAddressNameSource,
  NetworkAddressNameUtil,
} from "../../../Types/NetFlow/NetworkAddressName";
import { describe, expect, test } from "@jest/globals";

/*
 * What an address is called on the Traffic pages (issue #5340): the order
 * the sources are read in, how one name is picked when several name an
 * address, and what a name may hold before a page draws it on one line.
 */

describe("NETWORK_ADDRESS_NAME_SOURCES", () => {
  test("a name someone gave first, then the inventory, a pod last of it, DNS last of all", () => {
    expect(NETWORK_ADDRESS_NAME_SOURCES).toEqual([
      NetworkAddressNameSource.AddressName,
      NetworkAddressNameSource.NetworkDevice,
      NetworkAddressNameSource.Host,
      NetworkAddressNameSource.CloudResource,
      NetworkAddressNameSource.KubernetesNode,
      NetworkAddressNameSource.KubernetesPod,
      NetworkAddressNameSource.Dns,
    ]);
  });

  test("every source is in the order, once", () => {
    const sources: Array<string> = Object.values(NetworkAddressNameSource);

    expect([...NETWORK_ADDRESS_NAME_SOURCES].sort()).toEqual(
      [...sources].sort(),
    );
    expect(new Set(NETWORK_ADDRESS_NAME_SOURCES).size).toBe(sources.length);
  });

  test("the sources travel as these words (the API, the page and the fixtures read them)", () => {
    expect(Object.values(NetworkAddressNameSource)).toEqual([
      "address-name",
      "network-device",
      "host",
      "cloud-resource",
      "kubernetes-node",
      "kubernetes-pod",
      "dns",
    ]);
  });

  test("a page names at most a few hundred addresses", () => {
    expect(MAX_NAMED_ADDRESSES_PER_PAGE).toBe(200);
    expect(MAX_NETWORK_ADDRESS_NAME_LENGTH).toBe(100);
  });
});

describe("NetworkAddressNameUtil.pick", () => {
  const candidate: (
    source: NetworkAddressNameSource,
    name: string,
  ) => NetworkAddressNameCandidate = (
    source: NetworkAddressNameSource,
    name: string,
  ): NetworkAddressNameCandidate => {
    return { source: source, name: name };
  };

  test("the first source in the order wins, whatever order the candidates come in", () => {
    const all: Array<NetworkAddressNameCandidate> = [
      candidate(NetworkAddressNameSource.Dns, "fs01.corp.example"),
      candidate(NetworkAddressNameSource.KubernetesPod, "web-7f9c"),
      candidate(NetworkAddressNameSource.Host, "mumbai-fs01"),
      candidate(NetworkAddressNameSource.AddressName, "File server"),
      candidate(NetworkAddressNameSource.NetworkDevice, "core-sw-01"),
    ];

    expect(NetworkAddressNameUtil.pick(all)?.name).toBe("File server");
    expect(NetworkAddressNameUtil.pick([...all].reverse())?.name).toBe(
      "File server",
    );
    expect(NetworkAddressNameUtil.pick(all.slice(0, 3))?.name).toBe(
      "mumbai-fs01",
    );
    expect(NetworkAddressNameUtil.pick(all.slice(0, 2))?.name).toBe("web-7f9c");
    expect(NetworkAddressNameUtil.pick(all.slice(0, 1))?.name).toBe(
      "fs01.corp.example",
    );
  });

  test("each source outranks every source after it", () => {
    for (
      let index: number = 0;
      index < NETWORK_ADDRESS_NAME_SOURCES.length;
      index++
    ) {
      for (
        let later: number = index + 1;
        later < NETWORK_ADDRESS_NAME_SOURCES.length;
        later++
      ) {
        const picked: NetworkAddressNameCandidate | null =
          NetworkAddressNameUtil.pick([
            candidate(NETWORK_ADDRESS_NAME_SOURCES[later]!, "aaa-later"),
            candidate(NETWORK_ADDRESS_NAME_SOURCES[index]!, "zzz-earlier"),
          ]);

        expect(picked?.source).toBe(NETWORK_ADDRESS_NAME_SOURCES[index]);
      }
    }
  });

  test("two of one source (two hosts report the address): the name that sorts first, every time", () => {
    const both: Array<NetworkAddressNameCandidate> = [
      candidate(NetworkAddressNameSource.Host, "web-02"),
      candidate(NetworkAddressNameSource.Host, "Web-01"),
    ];

    expect(NetworkAddressNameUtil.pick(both)?.name).toBe("Web-01");
    expect(NetworkAddressNameUtil.pick([...both].reverse())?.name).toBe(
      "Web-01",
    );
  });

  test("an empty name names nothing; no candidates is null", () => {
    expect(NetworkAddressNameUtil.pick([])).toBeNull();
    expect(
      NetworkAddressNameUtil.pick([
        candidate(NetworkAddressNameSource.AddressName, ""),
        candidate(NetworkAddressNameSource.Dns, "fs01.corp.example"),
      ])?.name,
    ).toBe("fs01.corp.example");
    expect(
      NetworkAddressNameUtil.pick([
        candidate(NetworkAddressNameSource.AddressName, ""),
      ]),
    ).toBeNull();
  });

  test("the record the name is travels with it", () => {
    expect(
      NetworkAddressNameUtil.pick([
        {
          source: NetworkAddressNameSource.Host,
          name: "mumbai-fs01",
          resourceId: "60000000-0000-4000-8000-000000000001",
        },
      ])?.resourceId,
    ).toBe("60000000-0000-4000-8000-000000000001");
  });
});

describe("NetworkAddressNameUtil.cleanName", () => {
  test("one line, trimmed, runs of white space as one space", () => {
    expect(NetworkAddressNameUtil.cleanName("  Payroll   SaaS ")).toBe(
      "Payroll SaaS",
    );
    expect(NetworkAddressNameUtil.cleanName("Mumbai\noffice\r\n\tB")).toBe(
      "Mumbai office B",
    );
    expect(NetworkAddressNameUtil.cleanName("a\u00a0b")).toBe("a b");
  });

  test("control characters and the marks that turn text around are dropped", () => {
    expect(NetworkAddressNameUtil.cleanName("web\u0000-01\u0007")).toBe(
      "web-01",
    );
    expect(NetworkAddressNameUtil.cleanName("evil\u202Etxt.exe")).toBe(
      "eviltxt.exe",
    );
    expect(
      NetworkAddressNameUtil.cleanName("\u2066fs01\u2069\u200B\uFEFF"),
    ).toBe("fs01");
    expect(NetworkAddressNameUtil.cleanName("a\u0085b\u009fc")).toBe("abc");
  });

  test("letters of any script are kept as they are", () => {
    expect(NetworkAddressNameUtil.cleanName("حقوق و دستمزد")).toBe(
      "حقوق و دستمزد",
    );
    expect(NetworkAddressNameUtil.cleanName("東京オフィス")).toBe(
      "東京オフィス",
    );
    expect(NetworkAddressNameUtil.cleanName("Büro München")).toBe(
      "Büro München",
    );
  });

  test("cut to the longest name a page shows, by characters, never mid-character", () => {
    const long: string = "x".repeat(MAX_NETWORK_ADDRESS_NAME_LENGTH + 40);

    expect(NetworkAddressNameUtil.cleanName(long)).toBe(
      "x".repeat(MAX_NETWORK_ADDRESS_NAME_LENGTH),
    );

    // Emoji outside the first plane are one character each, never halved.
    const emoji: string = "😀".repeat(MAX_NETWORK_ADDRESS_NAME_LENGTH + 5);
    const cut: string | null = NetworkAddressNameUtil.cleanName(emoji);

    expect(Array.from(cut || "")).toHaveLength(MAX_NETWORK_ADDRESS_NAME_LENGTH);
    expect(cut).toBe("😀".repeat(MAX_NETWORK_ADDRESS_NAME_LENGTH));
  });

  test("a cut that ends on a space does not end in one", () => {
    const text: string = `${"a".repeat(MAX_NETWORK_ADDRESS_NAME_LENGTH - 1)} tail`;

    expect(NetworkAddressNameUtil.cleanName(text)).toBe(
      "a".repeat(MAX_NETWORK_ADDRESS_NAME_LENGTH - 1),
    );
  });

  test("nothing left, or not text: null (the address is shown instead)", () => {
    for (const value of [
      "",
      "   ",
      "\u0000\u200B",
      undefined,
      null,
      5,
      {},
      [],
    ]) {
      expect(NetworkAddressNameUtil.cleanName(value)).toBeNull();
    }
  });
});

describe("NetworkAddressNameUtil.isKnown", () => {
  test("a name or a subnet's name says something; nothing else does", () => {
    expect(NetworkAddressNameUtil.isKnown({ name: "fs01" })).toBe(true);
    expect(
      NetworkAddressNameUtil.isKnown({ subnetName: "Mumbai office" }),
    ).toBe(true);
    expect(NetworkAddressNameUtil.isKnown({})).toBe(false);
    expect(NetworkAddressNameUtil.isKnown({ name: "" })).toBe(false);
    expect(NetworkAddressNameUtil.isKnown(undefined)).toBe(false);
    expect(NetworkAddressNameUtil.isKnown(null)).toBe(false);
  });
});
