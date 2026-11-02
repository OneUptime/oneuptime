import { englishSection } from "./InventoryAndApiDocsSupport";
import { TRANSLATED_LANGUAGES, readPage } from "./DocsContentSupport";
import {
  MAX_UPLINK_HEALTH_WINDOWS_PER_READ,
  UPLINK_LAG_MS,
  UPLINK_WINDOW_MS,
} from "Common/Server/Utils/NetworkController/Meraki/MerakiTrafficReader";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the docs say about a Meraki page's uplinks (OneUptime issue #5377),
 * held to the code that makes it true, and to the Dashboard's own words in
 * every language it is written in.
 *
 *   - Network Traffic (Cisco Meraki without NetFlow, Reading the numbers and
 *     What is not included)
 */

const PAGE: string = "monitor/network-traffic";
const MINUTE_MS: number = 60 * 1000;

const LOCALES: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const meraki: string = englishSection(PAGE, "## Cisco Meraki without NetFlow");
const reading: string = englishSection(PAGE, "## Reading the numbers");
const notIncluded: string = englishSection(PAGE, "## What is not included");

function locale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

describe("the page's uplinks", () => {
  it("are read in the usage's own five-minute windows, a call each for the organization", () => {
    expect(UPLINK_WINDOW_MS).toBe(5 * MINUTE_MS);
    expect(meraki).toContain(
      "| **WAN uplinks** | The loss and latency of every MX appliance's uplinks, for the whole organization in one call | With the uplink usage, in five-minute windows |",
    );
    expect(meraki).toContain(
      "has its uplinks, and their loss and latency, read in one call a window each",
    );
  });

  it("a read reaches back far enough that the slowest read interval leaves no gap", () => {
    expect(
      MAX_UPLINK_HEALTH_WINDOWS_PER_READ * UPLINK_WINDOW_MS,
    ).toBeGreaterThan(60 * MINUTE_MS);
  });

  it("narrow the page by a click, and say what stays the network's", () => {
    expect(meraki).toContain(
      "A click on an uplink there, or on a row of **Uplinks**, narrows the whole page to it",
    );
    expect(meraki).toContain(
      "Applications, destinations, clients and flows stay the whole network's, because Meraki counts them per network.",
    );
  });
});

describe("what the Meraki side can and cannot say", () => {
  it("lists what each network reached, and says that is not a conversation", () => {
    expect(meraki).toContain(
      "**Who talks to whom** lists what each network reached",
    );
    expect(meraki).toContain(
      "it never says which client talked to what, and it counts no packets or errors on an uplink",
    );
  });

  it("sends the reader to NetFlow for the rest", () => {
    expect(meraki).toContain(
      "To see every conversation, address to address, with its packets, send NetFlow from the MX appliances as well",
    );
    expect(notIncluded).toContain(
      "**Conversations and packets from the Meraki dashboard API.**",
    );
  });
});

describe("Meraki's newest minutes", () => {
  it("reports what the reader sees: the reads end minutes before now", () => {
    expect(UPLINK_LAG_MS).toBe(5 * MINUTE_MS);
    expect(reading).toContain(
      "Meraki reports uplink usage a few minutes after it happens",
    );
    expect(reading).toContain(
      "minutes not reported yet do not count as silence",
    );
  });
});

describe("every language", () => {
  it.each(TRANSLATED_LANGUAGES as Array<string>)(
    "%s quotes the Dashboard's own words for the new card and list",
    (language: string) => {
      const page: string = readPage(language, PAGE);
      const words: Record<string, string> = locale(language);

      for (const label of ["WAN uplinks", "Who talks to whom"]) {
        expect(words[label]).toBeTruthy();
        expect(page).toContain(`**${words[label]}**`);
      }
    },
  );

  it.each(TRANSLATED_LANGUAGES as Array<string>)(
    "%s keeps the page's lines in step with the English",
    (language: string) => {
      expect(readPage(language, PAGE).split("\n")).toHaveLength(
        readPage("en", PAGE).split("\n").length,
      );
    },
  );

  it.each(TRANSLATED_LANGUAGES as Array<string>)(
    "%s has the new row, paragraph and bullet where the English has them",
    (language: string) => {
      const english: Array<string> = readPage("en", PAGE).split("\n");
      const lines: Array<string> = readPage(language, PAGE).split("\n");

      for (const marker of [
        "| **WAN uplinks** |",
        "**WAN uplinks** puts",
        "- **Meraki's newest minutes.**",
      ]) {
        const index: number = english.findIndex((line: string): boolean => {
          return line.startsWith(marker);
        });

        expect(index).toBeGreaterThan(0);
        expect(lines[index]!.length).toBeGreaterThan(0);
        expect(lines[index]).not.toBe(english[index]);
      }
    },
  );
});
