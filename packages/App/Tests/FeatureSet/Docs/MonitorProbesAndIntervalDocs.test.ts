import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A monitor's probes, its interval and how many of its probes must agree are
 * one page now, Configuration → Probes & Interval, as Create Monitor asks
 * for them on one step. There used to be an Interval page, a Probes page and
 * a "Probe Agreement Settings" card on Settings.
 *
 * The custom probe guide is where a reader goes to make a probe they just
 * deployed check something, so it says where that is. Markdown is not
 * compiled, so nothing else notices a doc that sends readers to a page that
 * is gone.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const ENGLISH_DIR: string = path.join(CONTENT_DIR, "en");

function readDoc(page: string): string {
  return fs.readFileSync(path.join(ENGLISH_DIR, `${page}.md`), "utf8");
}

function listMarkdown(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...listMarkdown(full));
    } else if (entry.name.endsWith(".md")) {
      found.push(full);
    }
  }

  return found;
}

describe("the custom probe guide", () => {
  const guide: string = readDoc("probe/custom-probe");

  const section: string = guide.slice(
    guide.indexOf("### Check a monitor from the probe"),
    guide.indexOf("### Diagnosing a Disconnected Probe"),
  );

  it("says how to make a deployed probe check a monitor, after it is verified", () => {
    expect(guide).toContain("### Check a monitor from the probe");
    expect(guide.indexOf("### Verify")).toBeLessThan(
      guide.indexOf("### Check a monitor from the probe"),
    );
    expect(section).toContain(
      "A probe checks only the monitors it is added to.",
    );
  });

  it("sends readers to the one page, where Create Monitor's step has them", () => {
    expect(section).toContain("**Configuration → Probes & Interval**");
    expect(section).toContain(
      "**Probes & Interval** step of **Create Monitor**",
    );
  });

  it("names the page's three cards, in the order they are on the page", () => {
    const interval: number = section.indexOf("**Monitoring Interval**");
    const probes: number = section.indexOf("**Probes**");
    const agreement: number = section.indexOf("**Probe Agreement**");

    expect(interval).toBeGreaterThan(-1);
    expect(probes).toBeGreaterThan(interval);
    expect(agreement).toBeGreaterThan(probes);
    expect(section).toContain("**Add Probe**");
  });

  it("says what the cards do as the page does: saved at once, empty is all probes", () => {
    expect(section).toContain("Pick an interval and it is saved at once.");
    expect(section).toContain(
      "Synthetic, Custom Code and SSL Certificate monitors are offered every 5 minutes or longer",
    );
    expect(section).toContain("Leave the box empty for all of them.");
    expect(section).toContain(
      "Only probes that are turned on and connected take part",
    );
  });

  it("says which monitors have no such page", () => {
    expect(section).toContain(
      "Monitors that probes do not check (Manual, Incoming Request, Incoming Email, Server, Network Device and the telemetry monitors) have no Probes & Interval page.",
    );
  });
});

describe("the English docs", () => {
  it("never send readers to a monitor's Interval page or a Probe Agreement card on Settings", () => {
    const stale: Array<string> = listMarkdown(ENGLISH_DIR).filter(
      (file: string): boolean => {
        const text: string = fs.readFileSync(file, "utf8");

        return (
          text.includes("Probe Agreement Settings") ||
          text.includes("**Interval** page") ||
          text.includes("Settings → Probe Agreement")
        );
      },
    );

    expect(stale).toEqual([]);
  });
});
