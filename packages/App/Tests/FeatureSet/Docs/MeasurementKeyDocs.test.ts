import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getMeasurementKeyFromName } from "Common/Types/Measurement/MeasurementKey";

/*
 * A measurement's key used to be something everybody typed: "Each
 * definition has a name, a permanent key, a starting point and an ending
 * point." It is now made from the name - on the form as the name is typed,
 * and by the server when an API client or Terraform leaves it out - and
 * only someone who wants a key of their own sets one.
 *
 * English and Persian document measurements (the other languages' incident
 * docs predate them). Both must say the key is made from the name, how to
 * pick another, and what the API does without one; neither may list the key
 * among the things a definition needs.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

// The section's heading in each language.
const MEASUREMENTS_HEADING: Record<string, string> = {
  en: "## Measurements",
  fa: "## اندازه‌گیری‌ها",
};

function measurementsSection(language: string): string {
  const page: string = fs.readFileSync(
    path.join(CONTENT_DIR, language, "incidents", "settings.md"),
    "utf8",
  );

  const start: number = page.indexOf(MEASUREMENTS_HEADING[language]!);
  expect(start).toBeGreaterThan(-1);

  const end: number = page.indexOf("\n## ", start + 1);

  return page.slice(start, end === -1 ? undefined : end);
}

describe.each(["en", "fa"])("the %s measurements docs", (language: string) => {
  const section: string = measurementsSection(language);

  it("show the key the docs' own example name makes", () => {
    expect(getMeasurementKeyFromName("Time to Detect")).toBe("time-to-detect");
    expect(section).toContain("Time to Detect");
    expect(section).toContain("`time-to-detect`");
  });

  it("send someone who wants their own key to Edit, before the measurement is created", () => {
    expect(section).toContain("**Edit**");
  });

  it("say a create over the API can leave the key out, and how a clash is numbered", () => {
    expect(section).toContain("Terraform");
    expect(section).toContain("`-2`");
    expect(section).toContain("`-3`");
  });

  it("still say the key never changes once the measurement exists", () => {
    expect(section).toMatch(/permanent|دائمی/);
  });
});

describe("the English measurements docs", () => {
  const section: string = measurementsSection("en");

  it("no longer list the key among what a definition needs", () => {
    expect(section).not.toContain("a permanent **key**, a **starting point**");
    expect(section).toContain(
      "Each definition has a **name**, a **starting point** and an **ending point**.",
    );
    expect(section).toContain("so there is nothing to fill in");
  });

  it("describe a key someone sends as the server checks it", () => {
    expect(section).toContain(
      "lowercase letters, numbers and hyphens, starting with a letter or a number, at most 50 characters",
    );
  });
});

describe("the Persian measurements docs", () => {
  const section: string = measurementsSection("fa");

  it("no longer list the key among what a definition needs", () => {
    expect(section).not.toContain("**کلیدی** دائمی");
    expect(section).toContain(
      "هر تعریفی **نام**، **نقطه آغاز** و **نقطه پایان** دارد.",
    );
  });
});
