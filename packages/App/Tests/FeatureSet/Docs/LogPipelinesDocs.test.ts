import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  MAX_KEY_VALUE_INPUT_LENGTH,
  MAX_KEY_VALUE_KEY_LENGTH,
  MAX_KEY_VALUE_PAIRS,
  MAX_KEY_VALUE_VALUE_LENGTH,
  parseKeyValuePairs,
} from "Common/Utils/Log/KeyValueParser";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Registration and drift checks for the "Log Pipelines" docs page.
 *
 * The page documents the Key=Value Parser with real Sophos XGS and
 * Fortinet lines and the attributes they produce, plus the parser's
 * ceilings. Those facts live in code (Common/Utils/Log/KeyValueParser),
 * so the examples are run through the real parser here and the numbers
 * are read from its constants: a docs example that no longer parses the
 * way the page says it does fails this test instead of misleading the
 * reader.
 */

const PAGE_URL: string = "/docs/telemetry/log-pipelines";

const PAGE_PATH: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en/telemetry/log-pipelines.md",
);

const PAGE: string = fs.readFileSync(PAGE_PATH, "utf8");

// Every ```text block on the page, in order.
function textBlocks(markdown: string): Array<string> {
  return Array.from(
    markdown.matchAll(/```text\n([\s\S]*?)\n```/g),
    (match: RegExpMatchArray): string => {
      return match[1]!.trim();
    },
  );
}

function blockContaining(needle: string): string {
  const block: string | undefined = textBlocks(PAGE).find(
    (candidate: string) => {
      return candidate.includes(needle);
    },
  );

  expect(block).toBeDefined();

  return block as string;
}

describe("Log Pipelines docs page", () => {
  it("is linked from the Telemetry nav group", () => {
    const telemetry: NavGroup | undefined = DocsNav.find((group: NavGroup) => {
      return group.title === "Telemetry";
    });

    expect(telemetry).toBeDefined();

    expect(
      telemetry!.links.find((link: NavLink) => {
        return link.url === PAGE_URL;
      })?.title,
    ).toBe("Log Pipelines");
  });

  it("documents every processor type the form offers", () => {
    for (const heading of [
      "## Key=Value Parser",
      "## Grok Parser",
      "## Severity Remapper",
      "## Attribute Remapper",
      "## Category Processor",
    ]) {
      expect(PAGE).toContain(heading);
    }
  });

  it("names the settings the way the processor form labels them", () => {
    for (const setting of [
      "Source Field",
      "Target Prefix",
      "Pair Delimiter",
      "Key-Value Delimiter",
      "Override on Conflict",
    ]) {
      expect(PAGE).toContain(`| ${setting}`);
    }
  });

  it("states the parser's ceilings as the code enforces them", () => {
    expect(PAGE).toContain(`${MAX_KEY_VALUE_INPUT_LENGTH / 1024} KiB`);
    expect(PAGE).toContain(`at most ${MAX_KEY_VALUE_PAIRS} pairs`);
    expect(PAGE).toContain(
      `longer than ${MAX_KEY_VALUE_KEY_LENGTH} characters`,
    );
    expect(PAGE).toContain(
      `longer than ${MAX_KEY_VALUE_VALUE_LENGTH.toLocaleString("en-US")} characters`,
    );
  });

  it("the Sophos IPsec example parses into the attributes the page lists", () => {
    const pairs: Record<string, string> = parseKeyValuePairs(
      blockContaining('log_component="IPSec"'),
    );

    for (const [key, value] of Object.entries({
      log_component: "IPSec",
      con_name: "HQ-Branch1",
      status: "Terminated",
      src_ip: "10.171.4.117",
    })) {
      expect(pairs[key]).toBe(value);
      expect(PAGE).toContain(`| \`sophos.${key}\``);
    }
  });

  it("the Sophos SD-WAN example parses into the values the page states", () => {
    const pairs: Record<string, string> = parseKeyValuePairs(
      blockContaining('log_type="SD-WAN"'),
    );

    for (const [key, value] of Object.entries({
      gw_name: "WAN2",
      latency: "11",
      packet_loss: "0",
      gw_status: "up",
      sla_status: "SLA met",
    })) {
      expect(pairs[key]).toBe(value);
      expect(PAGE).toContain(`\`sophos.${key} = ${value}\``);
    }
  });

  it("the Fortinet example parses into the values the page states", () => {
    const pairs: Record<string, string> = parseKeyValuePairs(
      blockContaining('devname="FG100"'),
    );

    for (const [key, value] of Object.entries({
      devname: "FG100",
      subtype: "vpn",
      action: "tunnel-down",
      vpntunnel: "HQ-to-Branch2",
      time: "10:00:00",
    })) {
      expect(pairs[key]).toBe(value);
      expect(PAGE).toContain(`\`fortigate.${key} = ${value}\``);
    }
  });
});
