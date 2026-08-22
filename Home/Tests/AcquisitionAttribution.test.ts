import fs from "fs";
import path from "path";

const script: string = fs.readFileSync(
  path.join(__dirname, "..", "Static", "js", "acquisition-attribution.js"),
  "utf8",
);
const head: string = fs.readFileSync(
  path.join(__dirname, "..", "Views", "head-basic.ejs"),
  "utf8",
);
const api: string = fs.readFileSync(
  path.join(__dirname, "..", "API", "AcquisitionAttributionAPI.ts"),
  "utf8",
);

describe("first-party acquisition attribution", () => {
  test("keeps cookie and legacy localStorage compatibility", () => {
    expect(script).toContain('COOKIE_NAME = "ou_acquisition"');
    expect(script).toContain('STORAGE_KEY = "acquisitionAttribution"');
    expect(script).toContain('readStorage("firstTouch")');
    expect(script).toContain('readStorage("clickIds")');
    expect(script).toContain("SameSite=Lax");
  });

  test("records direct first touch and preserves latest paid touch", () => {
    expect(script).toContain('"direct"');
    expect(script).toContain("if (!attribution.firstTouch)");
    expect(script).toContain("attribution.latestTouch = touch");
    expect(script).toContain("attribution.latestPaidTouch = touch");
  });

  test("posts idempotent durable visits into the existing conversion abstraction", () => {
    expect(script).toContain('fetch("/api/acquisition/touchpoint"');
    expect(script).toContain("var eventId = [attribution.anonymousVisitorId");
    expect(api).toContain("sourceEventId: eventId");
    expect(api).toContain("MarketingConversionType.Touchpoint");
  });

  test("gates third-party analytics on explicit consent", () => {
    expect(head).toContain("oneuptimeHasMarketingConsent");
    expect(head).toContain("oneuptime:consent-change");
    expect(head).toContain("opt_out_capturing");
  });
});
