import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Network Device page used to say there was "no per-instance expansion"
 * and "no wildcard for OIDs today" - true until SNMP tables, and exactly the
 * sentences that would talk an operator out of the feature that answers
 * their question (one row per tunnel, per radio, per fabric neighbour). These
 * pin what the page now says, and that the old claims are gone.
 */

const PAGE: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en/monitor/network-device-monitor.md",
);

const markdown: string = fs.readFileSync(PAGE, "utf8");

describe("Network Device docs: SNMP tables", () => {
  test("no longer claim tables cannot be walked", () => {
    expect(markdown).not.toContain("There is no per-instance expansion");
    expect(markdown).not.toContain("There is no wildcard for OIDs today");
  });

  test("document SNMP tables and the Wi-Fi tab as sections of their own", () => {
    expect(markdown).toContain("### SNMP Tables");
    expect(markdown).toContain("### The Wi-Fi Tab");
    expect(markdown).toContain("oneuptime.monitor.snmp.table.value");
    expect(markdown).toContain("snmpTableRow");
  });

  test("list every new criteria in the filter table", () => {
    for (const checkOn of [
      "SNMP Table Value",
      "SNMP Table Row Is Unhealthy",
      "SNMP Table Row Count",
      "SNMP Trap Varbind Value",
    ]) {
      expect(markdown).toContain(`| ${checkOn}`);
    }
  });

  test("name the vendor templates for Sophos, Extreme and Cambium", () => {
    for (const template of [
      "Sophos Firewall (SFOS / XGS)",
      "Extreme Networks EXOS / Switch Engine",
      "Extreme Networks Fabric Engine / VOSS",
      "Cambium Networks Enterprise Wi-Fi",
      "Cambium Networks cnMatrix",
    ]) {
      expect(markdown).toContain(template);
    }
  });

  test("show how to tell apart events that share one trap OID", () => {
    expect(markdown).toContain("1.3.6.1.4.1.2604.5.1.8.1.1");
    expect(markdown).toContain("1.3.6.1.4.1.2604.5.1.8.1.2");
  });

  test("link only to anchors the page has", () => {
    const anchors: Set<string> = new Set(
      (markdown.match(/^#{2,3} .+$/gm) || []).map((heading: string): string => {
        return heading
          .replace(/^#+ /, "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9 -]/g, "")
          .replace(/ /g, "-");
      }),
    );

    for (const link of ["snmp-tables", "the-wi-fi-tab"]) {
      expect(anchors.has(link)).toBe(true);
    }
  });
});
