import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The project colour feature marks the authenticated dashboard. Status pages
 * are public and tenant-facing, and their appearance is owned by the status
 * page's own branding settings — a colour chosen for internal navigation must
 * never leak onto one.
 *
 * Nothing enforces that at runtime, because the isolation is structural: the
 * stylesheet is not loaded there, the class is never set, and the component
 * that carries the bar is never rendered. These tests pin all three, so a
 * later change that quietly wires one of them up fails here instead of in
 * front of a customer.
 */

const APP_ROOT: string = path.join(__dirname, "../..");
const COMMON_ROOT: string = path.join(__dirname, "../../../Common");

const SOURCE_FILE_PATTERN: RegExp = /\.tsx?$/;

function listSourceFiles(absoluteDirectory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(absoluteDirectory, {
    withFileTypes: true,
  })) {
    const absolutePath: string = path.join(absoluteDirectory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        continue;
      }
      files.push(...listSourceFiles(absolutePath));
    } else if (SOURCE_FILE_PATTERN.test(entry.name)) {
      files.push(absolutePath);
    }
  }

  return files.sort();
}

function readFile(absolutePath: string): string {
  return fs.readFileSync(absolutePath, "utf8");
}

const PUBLIC_FEATURE_SETS: Array<string> = ["StatusPage", "PublicDashboard"];

describe("project colour does not reach public pages", () => {
  test.each(PUBLIC_FEATURE_SETS)(
    "%s never imports the dashboard theme stylesheet",
    (featureSet: string) => {
      const files: Array<string> = listSourceFiles(
        path.join(APP_ROOT, "FeatureSet", featureSet, "src"),
      );

      expect(files.length).toBeGreaterThan(0);

      const importing: Array<string> = files.filter((file: string) => {
        return readFile(file).includes("Common/UI/Styles/Theme.css");
      });

      expect(importing).toEqual([]);
    },
  );

  test.each(PUBLIC_FEATURE_SETS)(
    "%s never applies a project colour",
    (featureSet: string) => {
      const files: Array<string> = listSourceFiles(
        path.join(APP_ROOT, "FeatureSet", featureSet, "src"),
      );

      const using: Array<string> = files.filter((file: string) => {
        const code: string = readFile(file);
        return (
          code.includes("ProjectColorUtil") ||
          code.includes("ou-has-project-color")
        );
      });

      expect(using).toEqual([]);
    },
  );

  test("the status page renders no top section, so it has no bar to colour", () => {
    /*
     * MasterPage only renders TopSection when it is given a header or a
     * navbar. The status page supplies neither — it brings its own chrome
     * inside children — which is what keeps the bar off it.
     */
    const statusPageMaster: string = readFile(
      path.join(
        APP_ROOT,
        "FeatureSet/StatusPage/src/Components/MasterPage/MasterPage.tsx",
      ),
    );

    const masterPageOpeningTag: string = statusPageMaster.slice(
      statusPageMaster.indexOf("<MasterPage"),
      statusPageMaster.indexOf(">", statusPageMaster.indexOf("<MasterPage")),
    );

    expect(masterPageOpeningTag).not.toContain("header=");
    expect(masterPageOpeningTag).not.toContain("navBar=");

    const sharedMaster: string = readFile(
      path.join(COMMON_ROOT, "UI/Components/MasterPage/MasterPage.tsx"),
    );

    // The gate itself: no header and no navbar means no TopSection.
    expect(sharedMaster).toContain(
      "(!props.hideHeader && props.header) || props.navBar",
    );
  });

  test("every rule that paints the colour is gated on the dashboard class", () => {
    const theme: string = readFile(
      path.join(COMMON_ROOT, "UI/Styles/Theme.css"),
    );

    /*
     * Split into selector/body pairs. Any block that actually paints with the
     * colour must be behind the class only the dashboard sets; the remaining
     * blocks are geometry and a display:none, which paint nothing on their own.
     */
    const blocks: Array<{ selector: string; body: string }> = [];
    const blockPattern: RegExp = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null = blockPattern.exec(theme);

    while (match !== null) {
      blocks.push({
        selector: (match[1] || "").trim(),
        body: match[2] || "",
      });
      match = blockPattern.exec(theme);
    }

    const painting: Array<{ selector: string; body: string }> = blocks.filter(
      (block: { selector: string; body: string }) => {
        return block.body.includes("var(--ou-project-color)");
      },
    );

    // If this drops to zero the feature was removed, not made safe.
    expect(painting.length).toBeGreaterThan(0);

    for (const block of painting) {
      expect(block.selector).toContain("html.ou-has-project-color");
    }
  });
});
