import { execFileSync } from "child_process";
import path from "path";
import {
  SCRAPE_1_NOW_SECONDS,
  SCRAPE_2_NOW_SECONDS,
  readRecordedScrape,
} from "./XcpNgScrapeFixture";
import { describe, expect, test } from "@jest/globals";

/*
 * The recorded Xen Orchestra scrapes the Common tests read
 * (Fixtures/XcpNg/XenOrchestraScrape1.txt and 2.txt) are what the generator
 * the agent's behaviour test serves (Tests/Ops/Fixtures/XcpNg/
 * XenOrchestraScrape.js) writes for the same minute - byte for byte. A
 * change to the lab is made in the generator and the copies written again:
 *
 *   node Tests/Ops/Fixtures/XcpNg/XenOrchestraScrape.js 1 1795000000 \
 *     > packages/Common/Tests/Server/Utils/Telemetry/Fixtures/XcpNg/XenOrchestraScrape1.txt
 *   node Tests/Ops/Fixtures/XcpNg/XenOrchestraScrape.js 2 1795000060 \
 *     > packages/Common/Tests/Server/Utils/Telemetry/Fixtures/XcpNg/XenOrchestraScrape2.txt
 *
 * so the ingest is tested against exactly what the collector was run
 * against.
 */

const GENERATOR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "Tests",
  "Ops",
  "Fixtures",
  "XcpNg",
  "XenOrchestraScrape.js",
);

function generate(scrape: 1 | 2, nowSeconds: number): string {
  return execFileSync(
    process.execPath,
    [GENERATOR, String(scrape), String(nowSeconds)],
    { encoding: "utf8" },
  );
}

describe("XenOrchestraScrapeFixturesInStep", () => {
  test.each([
    [1, SCRAPE_1_NOW_SECONDS],
    [2, SCRAPE_2_NOW_SECONDS],
  ] as Array<[1 | 2, number]>)(
    "scrape %i is what the generator writes for its minute",
    (scrape: 1 | 2, nowSeconds: number) => {
      const recorded: string = readRecordedScrape(scrape);
      const generated: string = generate(scrape, nowSeconds);
      // Compared line by line first, so a drift names its line.
      expect(recorded.split("\n")).toEqual(generated.split("\n"));
      expect(recorded).toBe(generated);
    },
  );

  test("both end the way the plugin ends a scrape: # EOF, no newline after it", () => {
    for (const scrape of [1, 2] as Array<1 | 2>) {
      const recorded: string = readRecordedScrape(scrape);
      expect(recorded.endsWith("\n# EOF")).toBe(true);
      expect(recorded.endsWith("\n")).toBe(false);
    }
  });

  test("the two scrapes are a minute apart, and differ", () => {
    expect(SCRAPE_2_NOW_SECONDS - SCRAPE_1_NOW_SECONDS).toBe(60);
    expect(readRecordedScrape(1)).not.toBe(readRecordedScrape(2));
  });
});
