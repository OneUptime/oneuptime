/*
 * The docs link is built from the dashboard's DOCS_URL, which reads the
 * browser's window; the node environment has none, so it is given here.
 */
jest.mock("Common/UI/Config", () => {
  const { default: URLType } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (url: string) => unknown };
  };

  return {
    __esModule: true,
    DOCS_URL: URLType.fromString("https://oneuptime.com/docs"),
  };
});

import { describe, expect, test } from "@jest/globals";
import {
  COLLECTOR_PORTS,
  NETWORK_TRAFFIC_DOCS_PATH,
  PROBE_ADDRESS_PLACEHOLDER,
  TrafficSetupGuide,
  TrafficSetupVendor,
  getConfigurationForProbe,
  getNetworkTrafficDocsUrl,
  getTrafficSetupGuides,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficSetup";
import {
  DEFAULT_IPFIX_COLLECTOR_PORT,
  DEFAULT_NETFLOW_COLLECTOR_PORT,
  DEFAULT_SFLOW_COLLECTOR_PORT,
} from "Common/Types/NetFlow/NetworkFlowCollectorPorts";
import fs from "fs";
import path from "path";

/*
 * What the Traffic pages show before the first flow arrives: the probe's
 * ports, and per vendor the lines to paste (or the clicks to make) to turn
 * flow export on. These pin that the guides send each format to a port the
 * probe really listens on, with the timeouts that keep the page current,
 * and that the docs page they link to exists.
 */

const PROBE_CONFIG: string = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "Probe", "Config.ts"),
  "utf8",
);

function guideFor(vendor: TrafficSetupVendor): TrafficSetupGuide {
  const guide: TrafficSetupGuide | undefined = getTrafficSetupGuides().find(
    (candidate: TrafficSetupGuide): boolean => {
      return candidate.vendor === vendor;
    },
  );

  if (!guide) {
    throw new Error(`No guide for ${vendor}`);
  }

  return guide;
}

describe("the probe's ports", () => {
  test("are the conventional ports of each format", () => {
    expect(COLLECTOR_PORTS).toEqual({
      netFlow: 2055,
      ipfix: 4739,
      sFlow: 6343,
    });
  });

  test("are the probe's own defaults, so the guide and the probe agree", () => {
    expect(COLLECTOR_PORTS.netFlow).toBe(DEFAULT_NETFLOW_COLLECTOR_PORT);
    expect(COLLECTOR_PORTS.ipfix).toBe(DEFAULT_IPFIX_COLLECTOR_PORT);
    expect(COLLECTOR_PORTS.sFlow).toBe(DEFAULT_SFLOW_COLLECTOR_PORT);
    for (const constant of [
      "DEFAULT_NETFLOW_COLLECTOR_PORT",
      "DEFAULT_IPFIX_COLLECTOR_PORT",
      "DEFAULT_SFLOW_COLLECTOR_PORT",
    ]) {
      expect(PROBE_CONFIG).toContain(constant);
    }
  });
});

describe("the vendor guides", () => {
  test("cover Cisco IOS XE, Cisco IOS, Arista, Cisco Meraki MX / Z and everything else, in that order", () => {
    expect(
      getTrafficSetupGuides().map((guide: TrafficSetupGuide): string => {
        return guide.label;
      }),
    ).toEqual([
      "Cisco IOS XE",
      "Cisco IOS",
      "Arista EOS",
      "Cisco Meraki MX / Z",
      "Other devices",
    ]);
  });

  test("every guide has steps, and sends to one of the probe's ports", () => {
    const ports: Array<number> = Object.values(COLLECTOR_PORTS);

    for (const guide of getTrafficSetupGuides()) {
      expect(guide.steps.length).toBeGreaterThan(0);
      expect(ports).toContain(guide.port);
    }
  });

  test("Cisco IOS XE: Flexible NetFlow as IPFIX to 4739, with templates and caches on a 60-second clock", () => {
    const guide: TrafficSetupGuide = guideFor(TrafficSetupVendor.CiscoIosXe);
    const lines: Array<string> = guide.configuration!.split("\n");

    expect(guide.format).toBe("IPFIX");
    expect(guide.port).toBe(4739);
    expect(lines).toEqual(
      expect.arrayContaining([
        "flow exporter ONEUPTIME",
        ` destination ${PROBE_ADDRESS_PLACEHOLDER}`,
        " transport udp 4739",
        " export-protocol ipfix",
        " template data timeout 60",
        // Interface names and the sampler's rate, sent as options.
        " option interface-table",
        " option sampler-table",
        "flow monitor ONEUPTIME",
        " exporter ONEUPTIME",
        " cache timeout active 60",
        " record netflow ipv4 original-input",
        " ip flow monitor ONEUPTIME input",
      ]),
    );
  });

  test("Cisco IOS: NetFlow v9 to 2055, templates every minute, flows cut every minute", () => {
    const guide: TrafficSetupGuide = guideFor(TrafficSetupVendor.CiscoIos);
    const lines: Array<string> = guide.configuration!.split("\n");

    expect(guide.format).toBe("NetFlow v9");
    expect(guide.port).toBe(2055);
    expect(lines).toEqual(
      expect.arrayContaining([
        "ip flow-export version 9",
        `ip flow-export destination ${PROBE_ADDRESS_PLACEHOLDER} 2055`,
        // timeout-rate, in minutes; refresh-rate counts packets.
        "ip flow-export template timeout-rate 1",
        "ip flow-cache timeout active 1",
        " ip flow ingress",
      ]),
    );
  });

  test("Arista EOS: sFlow to 6343, sampled", () => {
    const guide: TrafficSetupGuide = guideFor(TrafficSetupVendor.Arista);

    expect(guide.format).toBe("sFlow");
    expect(guide.port).toBe(6343);
    expect(guide.configuration!.split("\n")).toEqual([
      "sflow sample 16384",
      `sflow destination ${PROBE_ADDRESS_PLACEHOLDER} 6343`,
      "sflow source-interface Loopback0",
      "sflow run",
    ]);
    // Sampling is explained: the pages scale the samples back up.
    expect(guide.steps.join(" ")).toContain("estimates");
  });

  test("Cisco Meraki MX / Z: clicks in the Meraki dashboard, NetFlow v9 to 2055, and what it cannot see", () => {
    const guide: TrafficSetupGuide = guideFor(TrafficSetupVendor.Meraki);
    const steps: string = guide.steps.join(" ");

    expect(guide.configuration).toBeNull();
    expect(guide.format).toBe("NetFlow v9");
    expect(guide.port).toBe(2055);
    expect(steps).toContain("Network-wide > General");
    expect(steps).toContain("Reporting");
    expect(steps).toContain("2055");
    // Traffic a switch keeps inside a VLAN never reaches the MX.
    expect(steps).toContain("never reaches them");
  });

  test("other devices: every format, every port, and where the rest of the commands are", () => {
    const guide: TrafficSetupGuide = guideFor(TrafficSetupVendor.Other);
    const steps: string = guide.steps.join(" ");

    expect(guide.configuration).toBeNull();
    for (const port of ["2055", "4739", "6343"]) {
      expect(steps).toContain(port);
    }
    expect(steps).toContain("Every port takes every format.");
    expect(steps).toContain("The docs have the commands");
  });
});

describe("getConfigurationForProbe", () => {
  test("puts the probe's address where the placeholder is, everywhere it is", () => {
    const guide: TrafficSetupGuide = guideFor(TrafficSetupVendor.CiscoIos);
    const configuration: string = getConfigurationForProbe(
      guide,
      "192.0.2.50",
    )!;

    expect(configuration).not.toContain(PROBE_ADDRESS_PLACEHOLDER);
    expect(configuration).toContain(
      "ip flow-export destination 192.0.2.50 2055",
    );
  });

  test("keeps the placeholder when the page does not know the address", () => {
    const guide: TrafficSetupGuide = guideFor(TrafficSetupVendor.Arista);

    expect(getConfigurationForProbe(guide, null)).toBe(guide.configuration);
  });

  test("a guide set up by clicks has nothing to paste", () => {
    expect(
      getConfigurationForProbe(guideFor(TrafficSetupVendor.Meraki), "10.0.0.1"),
    ).toBeNull();
  });
});

describe("the docs link", () => {
  test("is the network traffic page, which exists in every language", () => {
    expect(NETWORK_TRAFFIC_DOCS_PATH).toBe("/monitor/network-traffic");
    expect(getNetworkTrafficDocsUrl().toString()).toBe(
      "https://oneuptime.com/docs/monitor/network-traffic",
    );

    const content: string = path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "Docs",
      "Content",
    );

    for (const language of fs.readdirSync(content)) {
      if (!fs.statSync(path.join(content, language)).isDirectory()) {
        continue;
      }

      if (!fs.existsSync(path.join(content, language, "monitor"))) {
        continue;
      }

      expect({
        language,
        exists: fs.existsSync(
          path.join(content, language, "monitor", "network-traffic.md"),
        ),
      }).toEqual({ language, exists: true });
    }
  });
});
