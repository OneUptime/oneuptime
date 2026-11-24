import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";

/*
 * PROBE_HOST_IP_ADDRESSES (#10633), as the probe's environment sets it: the
 * host's addresses, for a probe without host networking - a Kubernetes pod,
 * whose Downward API gives status.hostIPs as "10.0.0.4,fd00::4", or a
 * container on a Docker bridge network. Read when the probe starts, each
 * entry by the rules a check-in's addresses are kept by, and an entry that
 * is no address is left out with a warning that names it. Then the
 * heartbeat lists them beside the interfaces' addresses.
 */

const KEYS: Array<string> = ["PROBE_HOST_IP_ADDRESSES"];

interface HostAddressesConfig {
  PROBE_HOST_IP_ADDRESSES: Array<string>;
}

interface Loaded {
  config: HostAddressesConfig;
  warnings: Array<string>;
}

const original: Record<string, string | undefined> = {};

function load(values: Record<string, string>): Loaded {
  for (const key of KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }

  let config: HostAddressesConfig | null = null;
  const warnings: Array<string> = [];

  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    const logger: { warn: (message: unknown) => void } =
      require("Common/Server/Utils/Logger").default;
    jest.spyOn(logger, "warn").mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    config = require("../Config") as HostAddressesConfig;
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  });

  jest.restoreAllMocks();

  return { config: config!, warnings };
}

// The warnings that are about this setting.
function hostAddressWarnings(warnings: Array<string>): Array<string> {
  return warnings.filter((warning: string): boolean => {
    return warning.startsWith("PROBE_HOST_IP_ADDRESSES");
  });
}

describe("PROBE_HOST_IP_ADDRESSES", () => {
  beforeAll(() => {
    for (const key of [...KEYS, "ONEUPTIME_URL", "PROBE_KEY"]) {
      original[key] = process.env[key];
    }

    process.env["ONEUPTIME_URL"] = "http://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("unset: no host address, and nothing to warn of - a probe on host networking needs none", () => {
    const loaded: Loaded = load({});

    expect(loaded.config.PROBE_HOST_IP_ADDRESSES).toEqual([]);
    expect(hostAddressWarnings(loaded.warnings)).toEqual([]);
  });

  test("Kubernetes' status.hostIP", () => {
    expect(
      load({ PROBE_HOST_IP_ADDRESSES: "10.0.0.4" }).config
        .PROBE_HOST_IP_ADDRESSES,
    ).toEqual(["10.0.0.4"]);
  });

  test("Kubernetes' status.hostIPs on a dual-stack node: both, as the Downward API writes them", () => {
    const loaded: Loaded = load({
      PROBE_HOST_IP_ADDRESSES: "10.0.0.4,fd00::4",
    });

    expect(loaded.config.PROBE_HOST_IP_ADDRESSES).toEqual([
      "10.0.0.4",
      "fd00::4",
    ]);
    expect(hostAddressWarnings(loaded.warnings)).toEqual([]);
  });

  test("a Docker host's addresses, written by a person with spaces and capitals", () => {
    expect(
      load({ PROBE_HOST_IP_ADDRESSES: " 192.168.1.20 , 2001:DB8::20 " }).config
        .PROBE_HOST_IP_ADDRESSES,
    ).toEqual(["192.168.1.20", "2001:db8::20"]);
  });

  test("an entry that is no address is left out, and the warning names it", () => {
    const loaded: Loaded = load({
      PROBE_HOST_IP_ADDRESSES: "node-1.internal, 10.0.0.4, 127.0.0.1",
    });

    expect(loaded.config.PROBE_HOST_IP_ADDRESSES).toEqual(["10.0.0.4"]);

    const warnings: Array<string> = hostAddressWarnings(loaded.warnings);

    expect(warnings).toHaveLength(1);
    // Exactly the entries left out: never an address it kept.
    expect(warnings[0]).toContain("left out: node-1.internal, 127.0.0.1. ");
    // And how to write one.
    expect(warnings[0]).toContain("IPv4 or IPv6 address");
  });

  test("a value the Downward API never filled in is no address", () => {
    const loaded: Loaded = load({ PROBE_HOST_IP_ADDRESSES: "$(HOST_IP)" });

    expect(loaded.config.PROBE_HOST_IP_ADDRESSES).toEqual([]);
    expect(hostAddressWarnings(loaded.warnings)).toHaveLength(1);
  });

  test("the heartbeat lists what it kept beside the interfaces' addresses", () => {
    process.env["PROBE_HOST_IP_ADDRESSES"] = "10.0.0.4, not-an-address";

    let body: JSONObject | null = null;

    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      const logger: { warn: (message: unknown) => void } =
        require("Common/Server/Utils/Logger").default;
      jest.spyOn(logger, "warn").mockImplementation(() => {
        // The warning is the test above's.
      });
      const NetworkInterfaces: {
        listInterfaceAddresses: () => Array<string>;
      } = require("../Utils/PacketCapture/NetworkInterfaces");
      jest
        .spyOn(NetworkInterfaces, "listInterfaceAddresses")
        .mockReturnValue(["10.244.1.7/24"]);
      const alive: {
        readInterfaceAddressesForCheckIn: () => JSONObject;
      } = require("../Jobs/Alive");
      body = alive.readInterfaceAddressesForCheckIn();
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    });

    jest.restoreAllMocks();
    delete process.env["PROBE_HOST_IP_ADDRESSES"];

    expect(body).toEqual({
      probeInterfaceAddresses: ["10.0.0.4", "10.244.1.7"],
    });
  });
});
