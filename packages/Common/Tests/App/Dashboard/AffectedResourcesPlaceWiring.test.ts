import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { AFFECTED_RESOURCES_PLACE_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationDecisionLines";

/*
 * The Remediation step of an incident or alert linked to nothing says "add
 * what it is about under Affected Resources", with a button that takes the
 * reader there (#5293). The button looks the place up by its id, so each
 * page that draws the AI card - whose second step is Remediation (block 43)
 * - must give its Affected Resources card that id, or the button would do
 * nothing, quietly. Read through the TypeScript AST: the cardProps of the
 * CardModelDetail named "Affected Resources" carry
 * `id: AFFECTED_RESOURCES_PLACE_ID`.
 */

const DASHBOARD_PAGES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Pages",
);

const PAGES_WITH_THE_REMEDIATION_CARD: Array<string> = [
  "Incidents/View/Index.tsx",
  "Alerts/View/Index.tsx",
];

// The props of each JSX element named `name`, by its attributes' text.
function attributesOf(
  source: string,
  fileName: string,
  tagName: string,
): Array<Record<string, string>> {
  const file: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: Array<Record<string, string>> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(file) === tagName
    ) {
      const attributes: Record<string, string> = {};

      for (const property of node.attributes.properties) {
        if (ts.isJsxAttribute(property) && property.initializer) {
          attributes[property.name.getText(file)] =
            property.initializer.getText(file);
        }
      }

      found.push(attributes);
    }

    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

describe("every page with the AI card's Remediation step gives its Affected Resources card the place id", () => {
  test.each(PAGES_WITH_THE_REMEDIATION_CARD)("%s", (page: string) => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_PAGES, page),
      "utf8",
    );

    // The page draws the AI card, whose Remediation step the line is on.
    expect(source).toContain("<InvestigationPanel");
    // The step lives only inside the card now, never as a card of its own.
    expect(source).not.toContain("<RemediationStep");
    expect(source).not.toContain("RemediationSuggestionCard");

    const affectedResources: Array<Record<string, string>> = attributesOf(
      source,
      path.basename(page),
      "CardModelDetail",
    ).filter((attributes: Record<string, string>): boolean => {
      return attributes["name"] === '"Affected Resources"';
    });

    expect(affectedResources).toHaveLength(1);
    expect(affectedResources[0]!["cardProps"]).toContain(
      "id: AFFECTED_RESOURCES_PLACE_ID",
    );
  });

  test("the scan knows every page that draws the AI card and its Remediation step", () => {
    const drawing: Array<string> = [];

    const walk: (directory: string) => void = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full: string = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          walk(full);
        } else if (
          entry.name.endsWith(".tsx") &&
          (fs.readFileSync(full, "utf8").includes("<InvestigationPanel") ||
            fs.readFileSync(full, "utf8").includes("<RemediationStep"))
        ) {
          drawing.push(path.relative(DASHBOARD_PAGES, full));
        }
      }
    };

    walk(DASHBOARD_PAGES);

    expect(drawing.sort()).toEqual([...PAGES_WITH_THE_REMEDIATION_CARD].sort());
  });

  test("the id is a plain page-place name", () => {
    expect(AFFECTED_RESOURCES_PLACE_ID).toBe("affected-resources");
  });
});
