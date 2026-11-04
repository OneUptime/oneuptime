import IconProp from "../../../../Types/Icon/IconProp";
import {
  ConnectorField,
  ENTRA_BACKGROUND_SIGN_INS_KEY,
  MICROSOFT_365_AUDIT_KEY,
  SecurityEventConnectorCatalog,
  SecurityEventConnectorCategories,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
  getSecurityEventConnectorTitle,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { VideoCallProviderCatalog } from "../../../../Types/VideoCall/VideoCallProviderCatalog";
import SecurityEventConnectorProvider, {
  AllSecurityEventConnectorProviders,
  isSecurityEventConnectorProvider,
} from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "../../../../Utils/RegExpEscape";

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
  "json",
];

// One or more lowercase words: the record name sits mid-sentence.
const LOWERCASE_WORDS: RegExp = /^[a-z]+(?: [a-z]+)*$/;

/*
 * Endings whose plural is not the word and an "s": activity, process, box,
 * search, flash, quiz. A vowel before a y is fine: key, keys.
 */
const IRREGULAR_PLURAL_ENDING: RegExp = /(?:[^aeiou]y|s|x|ch|sh|z)$/;

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

  /*
   * The icon is a product's only mark beside its name in the Add connection
   * picker and the Connections empty state. Three providers used to share
   * one shield, which read as a mistake in a list of eight.
   */
  test("icons are unique so no two providers look alike in the picker or the empty state", () => {
    const icons: Array<IconProp> = SecurityEventConnectorCatalog.map(
      (definition: SecurityEventConnectorDefinition): IconProp => {
        return definition.icon;
      },
    );

    expect(new Set(icons).size).toBe(icons.length);
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

    /*
     * The Diagnostics button and the poller's run name the records by
     * adding an "s" to this name: Preview audit events, Read alerts from
     * CrowdStrike Falcon. A name whose plural is not that, such as
     * "activity", would read Preview activitys.
     */
    test("names one imported record so that an added s makes its plural", () => {
      expect(definition.importedRecordName).toMatch(LOWERCASE_WORDS);
      expect(definition.importedRecordName).not.toMatch(
        IRREGULAR_PLURAL_ENDING,
      );
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

    test("secret fields are passwords or JSON documents, and no config field is either", () => {
      /*
       * "json" is a secret too: a service-account key pasted into a code
       * editor. A config field of either type would be readable back from
       * the API, which is the one thing a credential must never be.
       */
      for (const field of definition.secretFields) {
        expect({ key: field.key, secretType: ["password", "json"] }).toEqual({
          key: field.key,
          secretType: expect.arrayContaining([field.type]),
        });
      }

      for (const field of definition.configFields) {
        expect({ key: field.key, type: field.type }).not.toEqual({
          key: field.key,
          type: "password",
        });
        expect({ key: field.key, type: field.type }).not.toEqual({
          key: field.key,
          type: "json",
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

        /*
         * A required dropdown may leave the choice to the person on purpose
         * (Google SecOps's region: a preselected "us" would silently save
         * the wrong regional endpoint for a tenant elsewhere). It must then
         * say so with a placeholder. Every other dropdown defaults to one
         * of its own options.
         */
        if (field.defaultValue === undefined && field.required) {
          expect({ key: field.key, placeholder: field.placeholder }).toEqual({
            key: field.key,
            placeholder: expect.stringMatching(/\S/),
          });
          continue;
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
        `url:\\s*["']${escapeRegExp(definition.docsPath)}["']`,
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

  test.each([undefined, "", "not-a-provider", "OKTA"])(
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

/*
 * The connection form's Credentials step says once, above the credentials,
 * that they are encrypted at rest and never returned by the API; a field
 * that said it again made each credential read the sentence twice.
 */
describe("SecurityEventConnectorCatalog - what the Credentials step says once", () => {
  test.each(DEFINITION_CASES)(
    "%s: no field says it is encrypted",
    (_provider: string, definition: SecurityEventConnectorDefinition) => {
      for (const field of allFields(definition)) {
        expect([
          field.key,
          /encrypted at rest/i.test(field.description),
        ]).toEqual([field.key, false]);
        expect([field.key, /never returned/i.test(field.description)]).toEqual([
          field.key,
          false,
        ]);
      }
    },
  );

  test("nor does a video call provider's credential, read by the same kind of step", () => {
    const descriptions: Array<string> =
      JSON.stringify(VideoCallProviderCatalog).match(
        /"description":"[^"]*"/g,
      ) || [];

    expect(descriptions.length).toBeGreaterThan(0);
    expect(
      descriptions.filter((description: string): boolean => {
        return /encrypted at rest/i.test(description);
      }),
    ).toEqual([]);
  });
});

/*
 * Microsoft Sentinel, Microsoft Defender XDR and Microsoft Entra ID read a
 * tenant in the Azure public cloud unless told otherwise: the cloud is a
 * setting most people leave as it is, so the form folds it under More
 * fields, with the public cloud picked.
 */
describe("SecurityEventConnectorCatalog - a Microsoft connection's Cloud", () => {
  const MICROSOFT: Array<SecurityEventConnectorProvider> = [
    SecurityEventConnectorProvider.MicrosoftSentinel,
    SecurityEventConnectorProvider.MicrosoftDefenderXdr,
    SecurityEventConnectorProvider.MicrosoftEntraId,
  ];

  function cloudOf(provider: SecurityEventConnectorProvider): ConnectorField {
    const field: ConnectorField | undefined =
      getSecurityEventConnectorDefinition(provider)?.configFields.find(
        (candidate: ConnectorField): boolean => {
          return candidate.key === "cloud";
        },
      );

    expect(field).toBeDefined();

    return field!;
  }

  test.each(MICROSOFT)(
    "%s folds Cloud under More fields: optional, the public cloud unless set, and last of its settings",
    (provider: SecurityEventConnectorProvider) => {
      const cloud: ConnectorField = cloudOf(provider);
      const settings: Array<ConnectorField> =
        getSecurityEventConnectorDefinition(provider)!.configFields.filter(
          (field: ConnectorField): boolean => {
            return !field.isOption;
          },
        );

      expect({
        type: cloud.type,
        required: cloud.required,
        isAdvanced: cloud.isAdvanced,
        defaultValue: cloud.defaultValue,
      }).toEqual({
        type: "dropdown",
        required: false,
        isAdvanced: true,
        defaultValue: "public",
      });
      expect(settings[settings.length - 1]!.key).toBe("cloud");
      // The only setting folded away: every other one is asked of everybody.
      expect(
        settings
          .filter((field: ConnectorField): boolean => {
            return Boolean(field.isAdvanced);
          })
          .map((field: ConnectorField): string => {
            return field.key;
          }),
      ).toEqual(["cloud"]);
    },
  );

  test("Entra ID offers every cloud Microsoft 365 runs in, named by its plan", () => {
    expect(
      cloudOf(SecurityEventConnectorProvider.MicrosoftEntraId).options,
    ).toEqual([
      { label: "Azure public cloud", value: "public" },
      { label: "Azure public cloud, Microsoft 365 GCC", value: "gcc" },
      { label: "Azure Government (US), GCC High", value: "usgov" },
      { label: "Azure Government (US), DoD", value: "dod" },
    ]);
  });

  test("Sentinel and Defender XDR offer the public cloud and Azure Government", () => {
    for (const provider of [
      SecurityEventConnectorProvider.MicrosoftSentinel,
      SecurityEventConnectorProvider.MicrosoftDefenderXdr,
    ]) {
      expect(
        (cloudOf(provider).options || []).map(
          (option: { value: string }): string => {
            return option.value;
          },
        ),
      ).toEqual(["public", "usgov"]);
    }
  });
});

describe("SecurityEventConnectorCatalog - what Entra ID reads", () => {
  const entra: SecurityEventConnectorDefinition =
    getSecurityEventConnectorDefinition(
      SecurityEventConnectorProvider.MicrosoftEntraId,
    )!;

  test("background and app sign-ins are an option of the connection, off unless turned on", () => {
    const option: ConnectorField | undefined = entra.configFields.find(
      (field: ConnectorField): boolean => {
        return field.key === ENTRA_BACKGROUND_SIGN_INS_KEY;
      },
    );

    expect(option).toMatchObject({
      title: "Background and app sign-ins",
      type: "toggle",
      required: false,
      defaultValue: false,
      isOption: true,
    });
    // Asked before the Microsoft 365 audit log, the bigger of the two.
    expect(
      entra.configFields
        .filter((field: ConnectorField): boolean => {
          return Boolean(field.isOption);
        })
        .map((field: ConnectorField): string => {
          return field.key;
        }),
    ).toEqual([ENTRA_BACKGROUND_SIGN_INS_KEY, MICROSOFT_365_AUDIT_KEY]);
  });

  test("the app registration's permissions name what risk detections need", () => {
    const clientId: ConnectorField | undefined = entra.configFields.find(
      (field: ConnectorField): boolean => {
        return field.key === "clientId";
      },
    );

    expect(clientId?.description).toContain("AuditLog.Read.All");
    expect(clientId?.description).toContain("IdentityRiskEvent.Read.All");
  });
});
