import { describe, expect, test } from "@jest/globals";
import {
  TRAFFIC_ADDRESS_SOURCE_LABELS,
  TrafficAddressLabel,
  getFilteredAddress,
  getTrafficAddressLabel,
  getTrafficAddressShortText,
  getTrafficAddressText,
  hasRecordPage,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficAddressNames";
import {
  NETWORK_ADDRESS_NAME_SOURCES,
  NetworkAddressNameSource,
  NetworkTrafficAddressNames,
} from "Common/Types/NetFlow/NetworkAddressName";

/*
 * HOW A TRAFFIC PAGE WRITES AN ADDRESS (issue #5340): its name first with
 * the address beside it, or the address alone when the project knows no
 * name - the same way in every list, chip, card, sentence and title. The
 * components that draw it are rendered in Common/Tests/App/Dashboard; this
 * pins the plain rules they share.
 */

const HOST_ID: string = "60000000-0000-4000-8000-000000000001";

const NAMES: NetworkTrafficAddressNames = {
  "10.18.167.35": {
    name: "mumbai-fs01",
    source: NetworkAddressNameSource.Host,
    resourceId: HOST_ID,
    subnetName: "Mumbai office",
    subnet: "10.18.167.0/24",
  },
  "10.18.167.36": {
    subnetName: "Mumbai office",
    subnet: "10.18.167.0/24",
  },
  "10.18.167.31": {
    name: "mum-print-02.corp.example",
    source: NetworkAddressNameSource.Dns,
  },
};

describe("getTrafficAddressLabel", () => {
  test("a named address: its name, where it comes from, its record and its subnet", () => {
    expect(getTrafficAddressLabel("10.18.167.35", NAMES)).toEqual({
      address: "10.18.167.35",
      name: "mumbai-fs01",
      source: NetworkAddressNameSource.Host,
      resourceId: HOST_ID,
      subnetName: "Mumbai office",
      subnet: "10.18.167.0/24",
    });
  });

  test("an address only a subnet's name says anything about: no name, the subnet", () => {
    expect(getTrafficAddressLabel("10.18.167.36", NAMES)).toEqual({
      address: "10.18.167.36",
      name: null,
      source: null,
      resourceId: null,
      subnetName: "Mumbai office",
      subnet: "10.18.167.0/24",
    });
  });

  test("an address the project knows nothing about is itself, and so is any address on a page with no names", () => {
    const bare: TrafficAddressLabel = {
      address: "198.51.100.20",
      name: null,
      source: null,
      resourceId: null,
      subnetName: null,
      subnet: null,
    };

    expect(getTrafficAddressLabel("198.51.100.20", NAMES)).toEqual(bare);
    expect(getTrafficAddressLabel("198.51.100.20", undefined)).toEqual(bare);
    expect(getTrafficAddressLabel("198.51.100.20", null)).toEqual(bare);
    expect(getTrafficAddressLabel("198.51.100.20", {})).toEqual(bare);
  });

  test("a name is looked up by the page's own address only - never the object's own keys", () => {
    for (const address of ["constructor", "toString", "__proto__"]) {
      expect(getTrafficAddressLabel(address, NAMES).name).toBeNull();
    }
  });

  test("a source or record without a name is no source or record", () => {
    expect(
      getTrafficAddressLabel("10.0.0.9", {
        "10.0.0.9": {
          source: NetworkAddressNameSource.Host,
          resourceId: HOST_ID,
          subnet: "10.0.0.0/24",
        },
      }),
    ).toEqual({
      address: "10.0.0.9",
      name: null,
      source: null,
      resourceId: null,
      subnetName: null,
      subnet: null,
    });
  });
});

describe("the address as one line of text", () => {
  test("the name with the address in brackets, or the address alone", () => {
    expect(
      getTrafficAddressText(getTrafficAddressLabel("10.18.167.35", NAMES)),
    ).toBe("mumbai-fs01 (10.18.167.35)");
    expect(
      getTrafficAddressText(getTrafficAddressLabel("10.18.167.36", NAMES)),
    ).toBe("10.18.167.36");
  });

  test("a narrow place writes the name alone, or the address", () => {
    expect(
      getTrafficAddressShortText(getTrafficAddressLabel("10.18.167.35", NAMES)),
    ).toBe("mumbai-fs01");
    expect(
      getTrafficAddressShortText(getTrafficAddressLabel("10.18.167.36", NAMES)),
    ).toBe("10.18.167.36");
  });
});

describe("where a name comes from, in words", () => {
  test("every source has its words, and they are keys the page translates", () => {
    expect(Object.keys(TRAFFIC_ADDRESS_SOURCE_LABELS).sort()).toEqual(
      [...NETWORK_ADDRESS_NAME_SOURCES].sort(),
    );
    expect(TRAFFIC_ADDRESS_SOURCE_LABELS).toEqual({
      [NetworkAddressNameSource.AddressName]: "Address name",
      [NetworkAddressNameSource.NetworkDevice]: "Network device",
      [NetworkAddressNameSource.Host]: "Host",
      [NetworkAddressNameSource.CloudResource]: "Cloud resource",
      [NetworkAddressNameSource.KubernetesNode]: "Kubernetes node",
      [NetworkAddressNameSource.KubernetesPod]: "Kubernetes pod",
      [NetworkAddressNameSource.Dns]: "DNS name",
    });
  });
});

describe("hasRecordPage", () => {
  test("a device's, a host's or a cloud resource's name opens its record", () => {
    for (const source of [
      NetworkAddressNameSource.NetworkDevice,
      NetworkAddressNameSource.Host,
      NetworkAddressNameSource.CloudResource,
    ]) {
      expect(
        hasRecordPage(
          getTrafficAddressLabel("10.0.0.1", {
            "10.0.0.1": { name: "a", source: source, resourceId: HOST_ID },
          }),
        ),
      ).toBe(true);
    }
  });

  test("DNS, Kubernetes and Address Names have no record page of their own; nothing does without an id", () => {
    for (const source of [
      NetworkAddressNameSource.Dns,
      NetworkAddressNameSource.KubernetesNode,
      NetworkAddressNameSource.KubernetesPod,
      NetworkAddressNameSource.AddressName,
    ]) {
      expect(
        hasRecordPage(
          getTrafficAddressLabel("10.0.0.1", {
            "10.0.0.1": { name: "a", source: source, resourceId: HOST_ID },
          }),
        ),
      ).toBe(false);
    }

    expect(
      hasRecordPage(
        getTrafficAddressLabel("10.0.0.1", {
          "10.0.0.1": { name: "a", source: NetworkAddressNameSource.Host },
        }),
      ),
    ).toBe(false);
  });
});

describe("getFilteredAddress: the one address a page is narrowed to", () => {
  test("to or from an address", () => {
    expect(getFilteredAddress({ hostIp: "10.0.0.1" })).toBe("10.0.0.1");
    expect(
      getFilteredAddress({ hostIp: "10.0.0.1", sourceIp: "10.0.0.2" }),
    ).toBe("10.0.0.1");
  });

  test("from one address alone, or to one alone", () => {
    expect(getFilteredAddress({ sourceIp: "10.0.0.2" })).toBe("10.0.0.2");
    expect(getFilteredAddress({ destinationIp: "10.0.0.3" })).toBe("10.0.0.3");
  });

  test("a conversation is two addresses, and no filter is none", () => {
    expect(
      getFilteredAddress({ sourceIp: "10.0.0.2", destinationIp: "10.0.0.3" }),
    ).toBeNull();
    expect(getFilteredAddress({})).toBeNull();
  });
});
