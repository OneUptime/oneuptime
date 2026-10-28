import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  NETWORK_ADDRESS_NAME_SOURCES,
  NetworkAddressNameSource,
} from "Common/Types/NetFlow/NetworkAddressName";
import { TRANSLATED_LANGUAGES, readPage } from "./DocsContentSupport";

/*
 * NAMES INSTEAD OF ADDRESSES (issue #5340), as the Network Traffic page
 * tells them, held to the code that does it:
 *
 *   - where a name comes from, in the order NetworkAddressName picks it;
 *   - how the probe looks DNS names up - how many a minute, how many at
 *     once, how long each answer is kept - as FlowAddressNamer's defaults
 *     say, and its three settings as Probe/Config.ts reads them;
 *   - the labels the page quotes, as the Dashboard draws them in English;
 *   - every translation has the section, its three parts and the settings.
 *
 * The probe's sources are read as text: an App test imports nothing from
 * another package but Common.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const PAGE: string = "monitor/network-traffic";
const NAMER: string = "Probe/Utils/NetFlow/FlowAddressNamer.ts";
const PROBE_CONFIG: string = "Probe/Config.ts";
const DASHBOARD_EN: string = "App/FeatureSet/Dashboard/src/Locales/en.json";

const SECTION_HEADING: string = "## Names instead of addresses";

// A row of the order table: its first cell is the order, a whole number.
const ORDER_CELL: RegExp = /^\d+$/;

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

// The body of an H2 section, up to the next H2.
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

// The cells of every table row of a text, the header and divider left out.
function tableRows(text: string): Array<Array<string>> {
  const rows: Array<Array<string>> = [];
  let inTable: boolean = false;
  let seenDivider: boolean = false;

  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) {
      inTable = false;
      seenDivider = false;
      continue;
    }

    const cells: Array<string> = line
      .split("|")
      .slice(1, -1)
      .map((cell: string): string => {
        return cell.trim();
      });

    if (!inTable) {
      inTable = true;
      continue;
    }

    if (!seenDivider) {
      seenDivider = true;
      continue;
    }

    rows.push(cells);
  }

  return rows;
}

// A numeric constant's value in a source file: `export const NAME: number = 300;`.
function numberConstant(source: string, name: string): number {
  const start: number = source.indexOf(`export const ${name}: number = `);

  expect({ name, found: start >= 0 }).toEqual({ name, found: true });

  const expression: string = source
    .slice(start + `export const ${name}: number = `.length)
    .split(";")[0]!
    .trim();

  // Plain numbers and products of them, as the namer writes its times.
  return expression.split("*").reduce((product: number, part: string) => {
    return product * Number(part.trim());
  }, 1);
}

const english: string = readPage("en", PAGE);
const section: string = sectionOf(english, SECTION_HEADING);
const namer: string = readSource(NAMER);

describe("Network Traffic docs: where a name comes from", () => {
  test("the table names the sources in the order a name is picked", () => {
    const sources: Array<string> = tableRows(section)
      .filter((row: Array<string>): boolean => {
        return ORDER_CELL.test(row[0] || "");
      })
      .map((row: Array<string>): string => {
        return row[1] || "";
      });

    const expected: Array<string> = [];
    const words: Record<NetworkAddressNameSource, string> = {
      [NetworkAddressNameSource.AddressName]: "**Address Names**",
      [NetworkAddressNameSource.NetworkDevice]: "Network devices",
      [NetworkAddressNameSource.Host]: "Hosts",
      [NetworkAddressNameSource.CloudResource]: "Cloud resources",
      // A node and then a pod: one row, as the page says.
      [NetworkAddressNameSource.KubernetesNode]: "Kubernetes",
      [NetworkAddressNameSource.KubernetesPod]: "Kubernetes",
      [NetworkAddressNameSource.Dns]: "DNS",
    };

    for (const source of NETWORK_ADDRESS_NAME_SOURCES) {
      const word: string = words[source];

      if (expected[expected.length - 1] !== word) {
        expected.push(word);
      }
    }

    expect(sources).toEqual(expected);
  });

  test("a node comes before a pod, as the order has them", () => {
    expect(
      NETWORK_ADDRESS_NAME_SOURCES.indexOf(
        NetworkAddressNameSource.KubernetesNode,
      ),
    ).toBeLessThan(
      NETWORK_ADDRESS_NAME_SOURCES.indexOf(
        NetworkAddressNameSource.KubernetesPod,
      ),
    );
    expect(section).toContain("A node that holds the address, then a pod");
  });
});

describe("Network Traffic docs: the probe's DNS lookups", () => {
  test("how many a minute and how many at once, as the namer's defaults", () => {
    const perMinute: number = numberConstant(
      namer,
      "DEFAULT_FLOW_NAME_LOOKUPS_PER_MINUTE",
    );
    const atOnce: number = numberConstant(
      namer,
      "DEFAULT_FLOW_NAME_LOOKUP_CONCURRENCY",
    );

    expect(perMinute).toBe(300);
    expect(atOnce).toBe(8);
    expect(section).toContain(
      `at most ${perMinute} a minute and eight at a time`,
    );
  });

  test("how long a name, no name and a failure are kept", () => {
    const minute: number = 60 * 1000;

    expect(numberConstant(namer, "DEFAULT_FLOW_NAME_POSITIVE_TTL_MS")).toBe(
      60 * minute,
    );
    expect(numberConstant(namer, "DEFAULT_FLOW_NAME_NEGATIVE_TTL_MS")).toBe(
      30 * minute,
    );
    expect(numberConstant(namer, "DEFAULT_FLOW_NAME_FAILURE_TTL_MS")).toBe(
      5 * minute,
    );
    expect(section).toContain(
      "a name is kept for an hour, an address with no name for 30 minutes, and a lookup that failed is asked again after 5 minutes",
    );
  });

  test("a name is kept only when it points back to the address", () => {
    expect(namer).toContain("forwardLookup");
    expect(section).toContain(
      "only when the name's own A or AAAA records point back to the address",
    );
  });

  test("the three settings, with the defaults Probe/Config.ts reads", () => {
    const config: string = readSource(PROBE_CONFIG);
    const rows: Array<Array<string>> = tableRows(section).filter(
      (row: Array<string>): boolean => {
        return (row[0] || "").startsWith("PROBE_");
      },
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] || "";
      }),
    ).toEqual([
      "PROBE_FLOW_NAME_LOOKUP_ENABLED",
      "PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE",
      "PROBE_FLOW_NAME_DNS_SERVERS",
    ]);

    for (const row of rows) {
      expect(config).toContain(`process.env["${row[0]}"]`);
    }

    // On unless set to false; the namer's rate by default; no servers named.
    expect(config).toContain(
      'process.env["PROBE_FLOW_NAME_LOOKUP_ENABLED"] !== "false"',
    );
    expect(rows[0]![2]).toBe("true");
    expect(config).toContain(
      "defaultValue: DEFAULT_FLOW_NAME_LOOKUPS_PER_MINUTE",
    );
    expect(rows[1]![2]).toBe("300");
    expect(rows[2]![2]).toBe("none");
  });

  test("the hosted global probes name public addresses only, as the namer decides", () => {
    expect(namer).toContain(
      "return !(data.isAutoRegisteredGlobalProbe && data.isBillingEnabled);",
    );
    expect(section).toContain(
      "The global probes of a hosted OneUptime, which every account shares, look up public addresses only",
    );
  });
});

describe("Network Traffic docs: the labels it quotes", () => {
  const dashboard: Record<string, string> = JSON.parse(
    readSource(DASHBOARD_EN),
  );

  test.each([
    "Find a name or an IP address",
    "Name this address",
    "Edit in Settings",
    "Open host",
    "Open device",
    "Open cloud resource",
    "Address Names",
    "Top conversations",
  ])("%s is a label the Dashboard draws", (label: string) => {
    expect(dashboard[label]).toBe(label);
    expect(english).toContain(`**${label}**`);
  });

  test("Find is no longer only for an address", () => {
    expect(english).not.toContain("**Find an IP address**");
  });

  // An Address Name is changed in one place, Address Names, never renamed on the card.
  test("a name someone gave is changed on Address Names, by Edit in Settings", () => {
    expect(section).toContain(
      "- **Edit in Settings**, when the name is an Address Name. It opens **Address Names**, where the name is changed.",
    );
    expect(english).not.toContain("**Rename**");
  });
});

describe("Network Traffic docs: every translation has the section", () => {
  test.each(TRANSLATED_LANGUAGES)("%s", (lang: string) => {
    const page: string = readPage(lang, PAGE);
    const headings: Array<string> = page
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("## ") || line.startsWith("### ");
      });
    const englishHeadings: Array<string> = english
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("## ") || line.startsWith("### ");
      });
    const sectionAt: number = englishHeadings.indexOf(SECTION_HEADING);

    // The same headings in the same places: the section and its three parts.
    expect(headings.length).toBe(englishHeadings.length);
    expect(headings[sectionAt]!.startsWith("## ")).toBe(true);
    for (let index: number = 1; index <= 3; index++) {
      expect(headings[sectionAt + index]!.startsWith("### ")).toBe(true);
    }

    // The settings, named as the probe reads them.
    for (const variable of [
      "PROBE_FLOW_NAME_LOOKUP_ENABLED",
      "PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE",
      "PROBE_FLOW_NAME_DNS_SERVERS",
    ]) {
      expect(page).toContain(variable);
    }

    // The section's examples, written as the English writes them.
    for (const example of [
      "10.18.167.0/24",
      "10.18.167.35/24",
      "mumbai-fs01",
    ]) {
      expect(page).toContain(example);
    }
  });
});
