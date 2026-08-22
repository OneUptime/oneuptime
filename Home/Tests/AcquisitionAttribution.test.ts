import fs from "fs";
import path from "path";

const script: string = fs.readFileSync(
  path.join(__dirname, "..", "Static", "js", "acquisition-attribution.js"),
  "utf8",
);
const demo: string = fs.readFileSync(
  path.join(__dirname, "..", "Views", "demo.ejs"),
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

  test("posts bounded idempotent durable visits", () => {
    expect(script).toContain('fetch("/api/acquisition/touchpoint"');
    expect(script).toContain("var eventId = [attribution.anonymousVisitorId");
    expect(script).toContain('send("visit")');
  });

  test("does not persist opaque Cal attendee data", () => {
    expect(demo).not.toContain("'data': data");
    expect(demo).toContain("OneUptimeAttribution");
    expect(demo).toContain("demo_booked");
  });
});
