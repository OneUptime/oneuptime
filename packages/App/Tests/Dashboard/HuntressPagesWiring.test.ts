import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DocsNav, { NavGroup, NavLink } from "../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../FeatureSet/Docs/Utils/I18n";
import { WorkflowDocsPaths } from "Common/Types/Workflow/Documentation/DocumentationLinks";
import ComponentID from "Common/Types/Workflow/ComponentID";
import {
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  getWorkflowTemplatesByCategory,
} from "Common/Types/Workflow/Templates";

/*
 * Huntress is set up with a workflow now, like every other tool OneUptime
 * connects to: Incidents > Integrations > Huntress - a list page, a
 * connection page, a route pair, a breadcrumb pair, a side-menu section of
 * its own and a search entry - is gone, and every way in leads to Workflows
 * instead. Every one of those is a hand edit, and none of it is reachable
 * from a unit test of a page: a half-removed wiring fails nowhere until a
 * user clicks a menu entry that 404s.
 *
 * So the sources are read and matched (whitespace-squashed, comments
 * stripped, so prettier re-wrapping a line cannot fail them), the way
 * FormsWiring.test.ts pins the move of incident forms. The forwards are
 * visited for real in Common's MovedHuntressRedirects.test.tsx.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_UI: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
);

const DOCS_CONTENT: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readCode(...relativeParts: Array<string>): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
    ),
  );
}

describe("Incidents > Integrations > Huntress is gone", () => {
  test("no page key, route or breadcrumb of it is left", () => {
    for (const file of [
      ["Utils", "PageMap.ts"],
      ["Utils", "RouteMap.ts"],
      ["Utils", "Breadcrumbs", "IncidentBreadcrumbs.ts"],
    ]) {
      const source: string = readCode(...file);

      expect({
        file: file.join("/"),
        huntress: source.includes("HUNTRESS"),
      }).toEqual({ file: file.join("/"), huntress: false });
      expect(source).not.toContain("INCIDENTS_INTEGRATIONS");
    }
  });

  test("nor any page or component of it", () => {
    for (const relativePath of [
      "Pages/Incidents/Integrations",
      "Components/Huntress",
    ]) {
      expect({
        relativePath,
        exists: fs.existsSync(path.join(DASHBOARD_SRC, relativePath)),
      }).toEqual({ relativePath, exists: false });
    }
  });

  test("the Incidents side menu has no Integrations section, and no Huntress item", () => {
    const source: string = readCode("Pages", "Incidents", "SideMenu.tsx");

    expect(source).not.toContain('title: "Integrations"');
    expect(source).not.toContain('title: "Huntress"');
  });

  test("the route group only forwards the old addresses, to Workflows", () => {
    const source: string = readCode("Routes", "IncidentsRoutes.tsx");

    expect(source).not.toMatch(/import \w*Huntress\w* from "\.\.\/Pages/);
    expect(source).toContain(
      "<PageRoute path={MOVED_HUNTRESS_PATHS.connections} element={<MovedPageRedirect pageMap={PageMap.WORKFLOWS} />} />",
    );
    expect(source).toContain(
      "<PageRoute path={MOVED_HUNTRESS_PATHS.connectionView} element={<MovedPageRedirect pageMap={PageMap.WORKFLOW_VIEW} />} />",
    );
  });
});

describe("every way in leads to Workflows", () => {
  test("searching for Huntress or integrations finds Workflows", () => {
    const source: string = readCode(
      "Components",
      "CommandPalette",
      "PageSearchIndex.ts",
    );

    expect(source).toContain(
      'page: PageMap.WORKFLOWS, title: "Workflows", icon: IconProp.Workflow, keywords: ["integrations", "huntress"],',
    );
    expect(source).not.toContain("INCIDENTS_INTEGRATIONS");
  });

  test("Create Workflow offers a Huntress category, holding the Huntress template", () => {
    expect(WorkflowTemplateCategories).toContain(
      WorkflowTemplateCategory.Huntress,
    );
    expect(
      getWorkflowTemplatesByCategory(WorkflowTemplateCategory.Huntress).map(
        (template: { name: string }): string => {
          return template.name;
        },
      ),
    ).toEqual(["Open an incident for each Huntress incident report"]);
  });

  test("the Builder opens the Huntress trigger on its panel: URL, signing secret and what Huntress last sent", () => {
    const panel: string = squash(
      stripComments(
        fs.readFileSync(
          path.join(
            COMMON_UI,
            "Components",
            "Workflow",
            "ComponentPrimaryPanel.tsx",
          ),
          "utf8",
        ),
      ),
    );

    expect(ComponentID.HuntressIncidentReport).toBe("huntress-incident-report");
    expect(panel).toContain("case ComponentID.HuntressIncidentReport: {");
    expect(panel).toContain(
      "<HuntressTriggerPanel workflowId={context.workflowId}",
    );
    expect(panel).toContain(
      "getHuntressTriggerUrl({ workflowServiceUrl: WORKFLOW_URL.toString(), secretKey: secretKey, })",
    );
  });

  test("the trigger's help links the Huntress guide, which every docs language has", () => {
    expect(WorkflowDocsPaths.huntress).toBe("/integrations/huntress");

    const links: Array<NavLink> = DocsNav.flatMap(
      (group: NavGroup): Array<NavLink> => {
        return group.links;
      },
    );

    expect(
      links.some((link: NavLink): boolean => {
        return link.url === `/docs${WorkflowDocsPaths.huntress}`;
      }),
    ).toBe(true);

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      expect({
        language,
        exists: fs.existsSync(
          path.join(DOCS_CONTENT, language, `${WorkflowDocsPaths.huntress}.md`),
        ),
      }).toEqual({ language, exists: true });
    }
  });
});
