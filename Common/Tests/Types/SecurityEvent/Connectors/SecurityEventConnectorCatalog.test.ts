import IconProp from "../../../../Types/Icon/IconProp";
import {
  ConnectorField,
  SecurityEventConnectorCatalog,
  SecurityEventConnectorCategories,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
  getSecurityEventConnectorTitle,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider, {
  AllSecurityEventConnectorProviders,
  isSecurityEventConnectorProvider,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The catalog is the one place the dashboard form, the server validator
 * and the docs agree on what a provider is called and which keys it
 * stores. Nothing compiles against most of it (field keys are strings,
 * docs paths are strings), so the invariants are pinned here: one
 * definition per provider, unique keys, dropdown defaults that exist, a
 * docs path for every provider that is actually reachable from the nav.
 * (That the page itself exists, and names every field, is asserted by
 * App/Tests/FeatureSet/Docs/SecurityConnectorDocs.test.ts, which reads the
 * catalog too.)
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const DOCS_NAV_PATH: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Docs/Utils/Nav.ts",
);

const KNOWN_FIELD_TYPES: Array<string> = [
  "text",
  "url",
  "password",
  "number",
  "toggle",
  "dropdown",
];

const DEFINITION_CASES: Array<[string, SecurityEventConnectorDefinition]> =
  SecurityEventConnectorCatalog.map(
    (
      definition: SecurityEventConnectorDefinition,
    ): [string, SecurityEventConnectorDefinition] => {
      return [definition.provider, definition];
    },
  );

function allFields(
  definition: SecurityEventConnectorDefinition,
): Array<ConnectorField> {
  return [...definition.configFields, ...definition.secretFields];
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("SecurityEventConnectorCatalog - one definition per provider", () => {
  test("every provider in the enum has exactly one definition", () => {
    for (const provider of AllSecurityEventConnectorProviders) {
      const matches: Array<SecurityEventConnectorDefinition> =
        SecurityEventConnectorCatalog.filter(
          (definition: SecurityEventConnectorDefinition): boolean => {
            return definition.provider === provider;
          },
        );

      expect({ provider, count: matches.length }).toEqual({
        provider,
        count: 1,
      });
    }
  });

  test("every definition names a provider that exists in the enum", () => {
    for (const definition of SecurityEventConnectorCatalog) {
      expect(isSecurityEventConnectorProvider(definition.provider)).toBe(true);
    }

    expect(SecurityEventConnectorCatalog).toHaveLength(
      AllSecurityEventConnectorProviders.length,
    );
  });

  test("the enum helper list matches the enum's own values", () => {
    expect([...AllSecurityEventConnectorProviders].sort()).toEqual(
      Object.values(SecurityEventConnectorProvider).sort(),
    );
  });

  test("titles are unique so the provider picker never shows two identical cards", () => {
    const titles: Array<string> = SecurityEventConnectorCatalog.map(
      (definition: SecurityEventConnectorDefinition): string => {
        return definition.title;
      },
    );

    expect(new Set(titles).size).toBe(titles.length);
  });

  test("vendor/product pairs are unique because they are the dedupe scope", () => {
    const scopes: Array<string> = SecurityEventConnectorCatalog.map(
      (definition: SecurityEventConnectorDefinition): string => {
        return `${definition.vendorName} ${definition.productName}`;
      },
    );

    expect(new Set(scopes).size).toBe(scopes.length);
  });

  test("docs paths are unique", () => {
    const paths: Array<string> = SecurityEventConnectorCatalog.map(
      (definition: SecurityEventConnectorDefinition): string => {
        return definition.docsPath;
      },
    );

    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe.each(DEFINITION_CASES)(
  "SecurityEventConnectorCatalog - %s",
  (_provider: string, definition: SecurityEventConnectorDefinition) => {
    test("carries the descriptive text the UI and the event rows need", () => {
      expect(definition.title.trim()).not.toBe("");
      expect(definition.vendorName.trim()).not.toBe("");
      expect(definition.productName.trim()).not.toBe("");
      expect(definition.description.trim()).not.toBe("");
      expect(definition.importedRecordName.trim()).not.toBe("");
      expect(SecurityEventConnectorCategories).toContain(definition.category);
      expect(typeof definition.supportsAlertingOnlyToggle).toBe("boolean");
    });

    test("uses a real IconProp value", () => {
      expect(Object.values(IconProp)).toContain(definition.icon);
    });

    test("default poll interval is a whole number of minutes the service accepts", () => {
      expect(Number.isInteger(definition.defaultPollIntervalInMinutes)).toBe(
        true,
      );
      expect(definition.defaultPollIntervalInMinutes).toBeGreaterThanOrEqual(1);
      expect(definition.defaultPollIntervalInMinutes).toBeLessThanOrEqual(1440);
    });

    test("field keys are unique across config and secret fields", () => {
      const keys: Array<string> = allFields(definition).map(
        (field: ConnectorField): string => {
          return field.key;
        },
      );

      expect(new Set(keys).size).toBe(keys.length);
    });

    test("field titles are unique so the docs can name each field unambiguously", () => {
      const titles: Array<string> = allFields(definition).map(
        (field: ConnectorField): string => {
          return field.title;
        },
      );

      expect(new Set(titles).size).toBe(titles.length);
    });

    test("every field has a key, title, description and a known type", () => {
      for (const field of allFields(definition)) {
        expect(field.key).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
        expect(field.title.trim()).not.toBe("");
        expect(field.description.trim()).not.toBe("");
        expect(KNOWN_FIELD_TYPES).toContain(field.type);
        expect(typeof field.required).toBe("boolean");
      }
    });

    test("secret fields are all passwords and no config field is a password", () => {
      for (const field of definition.secretFields) {
        expect({ key: field.key, type: field.type }).toEqual({
          key: field.key,
          type: "password",
        });
      }

      for (const field of definition.configFields) {
        expect({ key: field.key, type: field.type }).not.toEqual({
          key: field.key,
          type: "password",
        });
      }
    });

    test("has at least one secret field, otherwise the connection would store no credential", () => {
      /*
       * Splunk accepts either a token or a password, so neither is required
       * on its own and the connector's validateSettings enforces "one of".
       * Every other provider has one required credential.
       */
      expect(definition.secretFields.length).toBeGreaterThan(0);

      if (
        definition.provider ===
        SecurityEventConnectorProvider.SplunkEnterpriseSecurity
      ) {
        expect(definition.secretFields.length).toBeGreaterThanOrEqual(2);
        return;
      }

      expect(
        definition.secretFields.some((field: ConnectorField): boolean => {
          return field.required;
        }),
      ).toBe(true);
    });

    test("dropdown fields have options that include their default value", () => {
      for (const field of allFields(definition)) {
        if (field.type !== "dropdown") {
          expect(field.options).toBeUndefined();
          continue;
        }

        expect(field.options).toBeDefined();
        expect(field.options!.length).toBeGreaterThan(0);

        const values: Array<string> = field.options!.map(
          (option: { value: string }): string => {
            return option.value;
          },
        );

        expect(new Set(values).size).toBe(values.length);

        for (const option of field.options!) {
          expect(option.label.trim()).not.toBe("");
          expect(option.value.trim()).not.toBe("");
        }

        expect(typeof field.defaultValue).toBe("string");
        expect(values).toContain(field.defaultValue);
      }
    });

    test("default values match their field type", () => {
      for (const field of allFields(definition)) {
        if (field.defaultValue === undefined) {
          continue;
        }

        if (field.type === "toggle") {
          expect(typeof field.defaultValue).toBe("boolean");
        } else if (field.type === "number") {
          expect(typeof field.defaultValue).toBe("number");
        } else {
          expect(typeof field.defaultValue).toBe("string");
        }
      }
    });

    test("docsPath is an integrations page slug the docs server can serve", () => {
      expect(definition.docsPath).toMatch(/^\/docs\/integrations\/[a-z0-9-]+$/);
    });

    test("docsPath is linked from the docs navigation", () => {
      const navSource: string = fs.readFileSync(DOCS_NAV_PATH, "utf8");

      /*
       * Matched as a url property with either quote style, so prettier
       * cannot break the test and a mention in a comment cannot fake it.
       */
      const link: RegExp = new RegExp(
        `url:\\s*["']${escapeForRegExp(definition.docsPath)}["']`,
      );

      expect({
        docsPath: definition.docsPath,
        linked: link.test(navSource),
      }).toEqual({ docsPath: definition.docsPath, linked: true });
    });
  },
);

describe("getSecurityEventConnectorDefinition", () => {
  test("finds a definition by provider value", () => {
    expect(
      getSecurityEventConnectorDefinition(
        SecurityEventConnectorProvider.OktaSystemLog,
      )?.title,
    ).toBe("Okta System Log");
  });

  test.each([undefined, "", "google-secops", "OKTA"])(
    "returns undefined for %j",
    (provider: string | undefined) => {
      expect(getSecurityEventConnectorDefinition(provider)).toBeUndefined();
    },
  );

  test("the title helper falls back to the raw provider, then to an empty string", () => {
    expect(
      getSecurityEventConnectorTitle(
        SecurityEventConnectorProvider.CrowdStrikeFalcon,
      ),
    ).toBe("CrowdStrike Falcon");
    expect(getSecurityEventConnectorTitle("mystery")).toBe("mystery");
    expect(getSecurityEventConnectorTitle(undefined)).toBe("");
  });
});
