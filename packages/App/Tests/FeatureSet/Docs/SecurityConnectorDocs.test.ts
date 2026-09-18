import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  ConnectorField,
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Security Event Connection docs against the catalog they describe.
 *
 * Markdown is not compiled, so nothing else notices when a provider gains
 * a config field the guide never explains, a secret is renamed without
 * the page following, a docs path in the catalog points at a page that was
 * moved, or the Security Events overview stops linking a connector. Each
 * test reads the catalog - the one source of truth the form, the server
 * validator and the connector share - and checks the shipped pages still
 * tell the same story.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Docs/Content/en",
);
const SECURITY_EVENTS_PAGE: string = path.join(
  CONTENT_DIR,
  "telemetry/security-events.md",
);
const MARKDOWN_HEADING: RegExp = /^#\s/;

/*
 * The OCSF class each connector's imported records land in, from the
 * framework design: a reader deciding which connector to set up needs to
 * know what kind of event they will get, so every guide names it.
 */
const OCSF_CLASSES_BY_PROVIDER: Record<
  SecurityEventConnectorProvider,
  Array<string>
> = {
  [SecurityEventConnectorProvider.MicrosoftSentinel]: ["Incident Finding"],
  [SecurityEventConnectorProvider.MicrosoftDefenderXdr]: ["Detection Finding"],
  [SecurityEventConnectorProvider.CrowdStrikeFalcon]: ["Detection Finding"],
  [SecurityEventConnectorProvider.SplunkEnterpriseSecurity]: [
    "Detection Finding",
  ],
  [SecurityEventConnectorProvider.ElasticSecurity]: ["Detection Finding"],
  [SecurityEventConnectorProvider.AwsSecurityHub]: [
    "Detection Finding",
    "Compliance Finding",
  ],
  [SecurityEventConnectorProvider.OktaSystemLog]: [
    "Authentication",
    "Account Change",
    "Detection Finding",
  ],
  [SecurityEventConnectorProvider.GoogleSecOps]: ["Detection Finding"],
};

const DEFINITION_CASES: Array<[string, SecurityEventConnectorDefinition]> =
  SecurityEventConnectorCatalog.map(
    (
      definition: SecurityEventConnectorDefinition,
    ): [string, SecurityEventConnectorDefinition] => {
      return [definition.title, definition];
    },
  );

function pageFileFor(docsPath: string): string {
  // "/docs/integrations/okta" -> "<content>/integrations/okta.md"
  return path.join(CONTENT_DIR, `${docsPath.replace(/^\/docs\//, "")}.md`);
}

function readPage(docsPath: string): string {
  const file: string = pageFileFor(docsPath);

  expect({ docsPath, exists: fs.existsSync(file) }).toEqual({
    docsPath,
    exists: true,
  });

  return fs.readFileSync(file, "utf8");
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
 * A field is "named" when its exact title appears in bold or as a table
 * cell - the two ways the guides present the connection form - so a
 * passing mention in prose does not count.
 */
function namesField(markdown: string, field: ConnectorField): boolean {
  const title: string = escapeForRegExp(field.title);
  const bold: RegExp = new RegExp(`\\*\\*${title}\\*\\*`);
  const tableCell: RegExp = new RegExp(`\\|\\s*${title}\\s*\\|`);

  return bold.test(markdown) || tableCell.test(markdown);
}

function integrationsGroup(): NavGroup {
  const group: NavGroup | undefined = DocsNav.find(
    (candidate: NavGroup): boolean => {
      return candidate.title === "Integrations";
    },
  );

  expect(group).toBeDefined();

  return group!;
}

describe("Security connector docs - the overview links every connector", () => {
  test("the Security Events page exists", () => {
    expect(fs.existsSync(SECURITY_EVENTS_PAGE)).toBe(true);
  });

  test.each(DEFINITION_CASES)(
    "telemetry/security-events.md links the %s guide",
    (_title: string, definition: SecurityEventConnectorDefinition) => {
      const overview: string = fs.readFileSync(SECURITY_EVENTS_PAGE, "utf8");

      expect({
        docsPath: definition.docsPath,
        linked: overview.includes(`](${definition.docsPath})`),
      }).toEqual({ docsPath: definition.docsPath, linked: true });
    },
  );
});

describe.each(DEFINITION_CASES)(
  "Security connector docs - %s",
  (_title: string, definition: SecurityEventConnectorDefinition) => {
    test("has an English docs page at the catalog's docsPath", () => {
      expect(definition.docsPath).toMatch(/^\/docs\/integrations\/[a-z0-9-]+$/);
      expect(readPage(definition.docsPath).trim()).not.toBe("");
    });

    test("is listed in the docs navigation under Integrations", () => {
      const links: Array<NavLink> = integrationsGroup().links;
      const link: NavLink | undefined = links.find(
        (candidate: NavLink): boolean => {
          return candidate.url === definition.docsPath;
        },
      );

      expect({
        docsPath: definition.docsPath,
        listed: link !== undefined,
      }).toEqual({ docsPath: definition.docsPath, listed: true });
      expect(link!.title.trim()).not.toBe("");
    });

    test("is titled after the provider", () => {
      const page: string = readPage(definition.docsPath);
      const heading: string | undefined = page
        .split("\n")
        .find((line: string): boolean => {
          return MARKDOWN_HEADING.test(line);
        });

      expect(heading).toBeDefined();
      expect(page).toContain(definition.title);
    });

    test("names every configuration field in bold or a table", () => {
      const page: string = readPage(definition.docsPath);
      const missing: Array<string> = definition.configFields
        .filter((field: ConnectorField): boolean => {
          return !namesField(page, field);
        })
        .map((field: ConnectorField): string => {
          return field.title;
        });

      expect(missing).toEqual([]);
    });

    test("names every credential field in bold or a table", () => {
      const page: string = readPage(definition.docsPath);
      const missing: Array<string> = definition.secretFields
        .filter((field: ConnectorField): boolean => {
          return !namesField(page, field);
        })
        .map((field: ConnectorField): string => {
          return field.title;
        });

      expect(missing).toEqual([]);
    });

    test("names the OCSF class its records are imported as", () => {
      const page: string = readPage(definition.docsPath);
      const expectedClasses: Array<string> =
        OCSF_CLASSES_BY_PROVIDER[definition.provider] || [];

      expect(expectedClasses.length).toBeGreaterThan(0);

      const missing: Array<string> = expectedClasses.filter(
        (className: string): boolean => {
          return !page.includes(className);
        },
      );

      expect(missing).toEqual([]);
    });

    test("never prints a credential placeholder that looks like a real secret", () => {
      /*
       * Guides show where to find a secret, not what one looks like. A
       * page carrying an AKIA... key or a JWT-shaped token invites copy
       * and paste of the example into the form.
       */
      const page: string = readPage(definition.docsPath);

      expect(page).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(page).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    });
  },
);
