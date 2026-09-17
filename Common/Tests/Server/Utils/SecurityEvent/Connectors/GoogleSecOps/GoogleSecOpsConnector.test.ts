import { afterEach, describe, expect, jest, test } from "@jest/globals";
import GoogleSecOpsClient, {
  FetchInitLike,
  FetchResponseLike,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsConnector, {
  GOOGLE_SECOPS_ALERTS_VIEW_REQUEST_BUDGET,
  GOOGLE_SECOPS_CURATED_REQUEST_BUDGET,
  GOOGLE_SECOPS_FETCH_DURATION_MS,
  GOOGLE_SECOPS_SEARCH_PAGE_BUDGET,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnector";
import SecurityEventConnectorRegistry from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import { SecurityEventConnector } from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../../Types/JSON";
import {
  ConnectorField,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  INSTANCE,
  PRIVATE_KEY,
  SERVICE_ACCOUNT_EMAIL,
  TOKEN_URI,
  secOpsSettings,
} from "./GoogleSecOpsConnectorFixtures";

/*
 * The Google SecOps connector as the registry, the service and the tester
 * see it: registered under "google-secops", with a fetch budget that keeps
 * the retired poller's split budgets, and a validateSettings that runs every
 * GoogleSecOpsClient constructor rule at save time without contacting
 * anything, each rejection opening with the catalog title of the field to
 * fix.
 */

const definition: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.GoogleSecOps,
  )!;

function serviceAccount(fields: JSONObject): string {
  return JSON.stringify(fields);
}

function messageOf(action: () => void): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected validateSettings to throw.");
}

describe("GoogleSecOpsConnector registration", () => {
  test("is registered under the google-secops provider", () => {
    const connector: SecurityEventConnector =
      SecurityEventConnectorRegistry.getConnector("google-secops");

    expect(connector).toBeInstanceOf(GoogleSecOpsConnector);
    expect(connector.provider).toBe(
      SecurityEventConnectorProvider.GoogleSecOps,
    );
    expect(new GoogleSecOpsConnector().provider).toBe("google-secops");
    expect(SecurityEventConnectorRegistry.getRegisteredProviders()).toContain(
      SecurityEventConnectorProvider.GoogleSecOps,
    );
  });

  test("its catalog entry keeps the retired poller's dedupe scope and service name byte for byte", () => {
    expect(definition.vendorName).toBe("Google");
    expect(definition.productName).toBe("Google SecOps");
    expect(definition.title).toBe("Google SecOps");
  });

  /*
   * The poller's single-list defaults (20 requests, 10000 records) would
   * collapse the two budgets into one and let the alerts view starve the
   * searches, which is why the retired poller split them.
   */
  test("declares every pass budget together, a record bound that never binds, and a four minute wall clock", () => {
    expect(GOOGLE_SECOPS_SEARCH_PAGE_BUDGET).toBe(20);
    expect(GOOGLE_SECOPS_CURATED_REQUEST_BUDGET).toBe(200);
    expect(GOOGLE_SECOPS_ALERTS_VIEW_REQUEST_BUDGET).toBe(16);
    expect(GOOGLE_SECOPS_FETCH_DURATION_MS).toBe(4 * 60 * 1000);
    expect(new GoogleSecOpsConnector().fetchBudget).toEqual({
      maxRequests: 236,
      maxEvents: 20 * 1000 + 200 * 1000 + 16 * 1000,
      maxDurationMs: 4 * 60 * 1000,
    });
  });
});

describe("GoogleSecOpsConnector.validateSettings", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("accepts a complete configuration", () => {
    expect(() => {
      new GoogleSecOpsConnector().validateSettings(secOpsSettings());
    }).not.toThrow();
  });

  test("accepts surrounding whitespace in every setting", () => {
    expect(() => {
      new GoogleSecOpsConnector().validateSettings(
        secOpsSettings({
          config: { region: " us ", instanceResourceName: ` ${INSTANCE}\n` },
          secrets: {
            serviceAccountJson: `\n  ${serviceAccount({
              client_email: SERVICE_ACCOUNT_EMAIL,
              private_key: PRIVATE_KEY,
            })}  \n`,
          },
        }),
      );
    }).not.toThrow();
  });

  test("accepts a key without token_uri, which defaults to Google's token endpoint", () => {
    expect(() => {
      new GoogleSecOpsConnector().validateSettings(
        secOpsSettings({
          secrets: {
            serviceAccountJson: serviceAccount({
              client_email: SERVICE_ACCOUNT_EMAIL,
              private_key: PRIVATE_KEY,
            }),
          },
        }),
      );
    }).not.toThrow();
  });

  test.each([
    ["europe", "projects/p/locations/eu/instances/i"],
    ["europe", "projects/p/locations/europe/instances/i"],
  ])(
    "treats eu and europe as one place: region %s with instance %s",
    (region: string, instanceResourceName: string) => {
      expect(() => {
        new GoogleSecOpsConnector().validateSettings(
          secOpsSettings({ config: { region, instanceResourceName } }),
        );
      }).not.toThrow();
    },
  );

  test("rejects settings meant for another provider", () => {
    expect(
      messageOf(() => {
        new GoogleSecOpsConnector().validateSettings(
          secOpsSettings({
            provider: SecurityEventConnectorProvider.OktaSystemLog,
          }),
        );
      }),
    ).toBe('Settings are for provider "okta", not Google SecOps.');
  });

  const missingFields: Array<
    [{ config?: JSONObject; secrets?: JSONObject }, string]
  > = [
    [{ config: { region: "" } }, "Region is required."],
    [{ config: { region: "   " } }, "Region is required."],
    [{ config: { region: null } }, "Region is required."],
    [
      { config: { instanceResourceName: "" } },
      "Instance resource name is required.",
    ],
    [
      { config: { instanceResourceName: null } },
      "Instance resource name is required.",
    ],
    [
      { secrets: { serviceAccountJson: "" } },
      "Service account JSON is required.",
    ],
    [
      { secrets: { serviceAccountJson: null } },
      "Service account JSON is required.",
    ],
  ];

  test.each(missingFields)(
    "names the missing field: %j",
    (
      overrides: { config?: JSONObject; secrets?: JSONObject },
      expected: string,
    ) => {
      expect(
        messageOf(() => {
          new GoogleSecOpsConnector().validateSettings(
            secOpsSettings(overrides),
          );
        }),
      ).toBe(expected);
    },
  );

  test("settings with no config or secrets objects at all name the first field", () => {
    expect(
      messageOf(() => {
        new GoogleSecOpsConnector().validateSettings({
          provider: SecurityEventConnectorProvider.GoogleSecOps,
          config: undefined as unknown as JSONObject,
          secrets: undefined as unknown as JSONObject,
          alertingOnly: true,
        });
      }),
    ).toBe("Region is required.");
  });

  test.each(["us-central1", "US", "us_", "us/../etc", "us east", "mars"])(
    "rejects region %s with Google's regional prefix guidance",
    (region: string) => {
      expect(
        messageOf(() => {
          new GoogleSecOpsConnector().validateSettings(
            secOpsSettings({ config: { region } }),
          );
        }),
      ).toBe(
        "Region must be a Google SecOps regional prefix like 'us' or 'europe'.",
      );
    },
  );

  test.each([
    "instances/abc",
    "projects/p/instances/i",
    "projects/p/locations/us/instances/i/extra",
    "projects/p#frag/locations/us/instances/i",
    "projects/p/locations/us/instances/i?x=1",
    "projects/p/locations/us/instances/i%2F",
    "projects/p/locations/us/instances/i&y",
  ])("rejects instance resource name %s", (instanceResourceName: string) => {
    expect(
      messageOf(() => {
        new GoogleSecOpsConnector().validateSettings(
          secOpsSettings({ config: { instanceResourceName } }),
        );
      }),
    ).toBe(
      "Instance resource name must look like projects/{project}/locations/{location}/instances/{instance}.",
    );
  });

  test("rejects a region that does not match the instance's location", () => {
    expect(
      messageOf(() => {
        new GoogleSecOpsConnector().validateSettings(
          secOpsSettings({
            config: {
              region: "europe",
              instanceResourceName: "projects/p/locations/us/instances/i",
            },
          }),
        );
      }),
    ).toBe(
      "Region must match the locations segment of the instance resource name.",
    );
  });

  test.each([
    ["not json", "Service account JSON is not valid JSON."],
    ["[]", "Service account JSON must be a JSON object."],
    ["null", "Service account JSON must be a JSON object."],
    ['"a string"', "Service account JSON must be a JSON object."],
    [
      serviceAccount({ client_email: SERVICE_ACCOUNT_EMAIL }),
      "Service account JSON must contain client_email and private_key as strings.",
    ],
    [
      serviceAccount({ client_email: {}, private_key: PRIVATE_KEY }),
      "Service account JSON must contain client_email and private_key as strings.",
    ],
    [
      serviceAccount({ client_email: "", private_key: PRIVATE_KEY }),
      "Service account JSON must contain client_email and private_key.",
    ],
    [
      serviceAccount({
        client_email: SERVICE_ACCOUNT_EMAIL,
        private_key: PRIVATE_KEY,
        token_uri: "not a url",
      }),
      "Service account JSON token_uri must be an absolute https URL.",
    ],
    [
      serviceAccount({
        client_email: SERVICE_ACCOUNT_EMAIL,
        private_key: PRIVATE_KEY,
        token_uri: "http://oauth2.googleapis.com/token",
      }),
      "Service account JSON token_uri must be an https URL on a Google host such as https://oauth2.googleapis.com/token.",
    ],
    [
      serviceAccount({
        client_email: SERVICE_ACCOUNT_EMAIL,
        private_key: PRIVATE_KEY,
        token_uri: "https://attacker.example.com/token",
      }),
      "Service account JSON token_uri must be an https URL on a Google host such as https://oauth2.googleapis.com/token.",
    ],
    [
      serviceAccount({
        client_email: SERVICE_ACCOUNT_EMAIL,
        private_key: PRIVATE_KEY,
        token_uri: "https://user@oauth2.googleapis.com/token",
      }),
      "Service account JSON token_uri must be an https URL on a Google host such as https://oauth2.googleapis.com/token.",
    ],
    [
      serviceAccount({
        client_email: SERVICE_ACCOUNT_EMAIL,
        private_key:
          "-----BEGIN PRIVATE KEY-----\\nnot-a-key\\n-----END PRIVATE KEY-----",
      }),
      "Service account JSON private_key is not a readable PEM private key. Check that newlines are real newlines and the key is not encrypted.",
    ],
  ])(
    "rejects an unusable service account key: %s",
    (serviceAccountJson: string, expected: string) => {
      expect(
        messageOf(() => {
          new GoogleSecOpsConnector().validateSettings(
            secOpsSettings({ secrets: { serviceAccountJson } }),
          );
        }),
      ).toBe(expected);
    },
  );

  /*
   * The key is stored as the pasted text. An object in that slot is a
   * storage bug (a parsed or HashedString value), named as such rather than
   * reported as "not valid JSON" for a value the person never typed.
   */
  test("rejects a service account key stored as anything but text", () => {
    expect(
      messageOf(() => {
        new GoogleSecOpsConnector().validateSettings(
          secOpsSettings({
            secrets: {
              serviceAccountJson: {
                client_email: SERVICE_ACCOUNT_EMAIL,
                private_key: PRIVATE_KEY,
              },
            },
          }),
        );
      }),
    ).toBe("Service account JSON must be the key file's JSON text.");
  });

  test("every rejection opens with the catalog title of the field to fix", () => {
    const titles: Array<string> = [
      ...definition.configFields,
      ...definition.secretFields,
    ].map((field: ConnectorField): string => {
      return field.title;
    });
    expect(titles).toEqual([
      "Region",
      "Instance resource name",
      "Service account JSON",
    ]);

    const cases: Array<{ config?: JSONObject; secrets?: JSONObject }> = [
      { config: { region: "" } },
      { config: { region: "mars" } },
      { config: { instanceResourceName: "" } },
      { config: { instanceResourceName: "instances/i" } },
      { config: { region: "europe" } },
      { secrets: { serviceAccountJson: "" } },
      { secrets: { serviceAccountJson: "{" } },
      {
        secrets: {
          serviceAccountJson: serviceAccount({
            client_email: SERVICE_ACCOUNT_EMAIL,
            private_key: PRIVATE_KEY,
            token_uri: "https://example.com/token",
          }),
        },
      },
      {
        secrets: {
          serviceAccountJson: serviceAccount({
            client_email: SERVICE_ACCOUNT_EMAIL,
            private_key: "garbage",
          }),
        },
      },
    ];

    for (const overrides of cases) {
      const message: string = messageOf(() => {
        new GoogleSecOpsConnector().validateSettings(secOpsSettings(overrides));
      });
      expect(
        titles.some((title: string): boolean => {
          return message.startsWith(`${title} `);
        }),
      ).toBe(true);
    }
  });

  test("a client rule whose message does not name its field is prefixed with the field title", () => {
    jest
      .spyOn(GoogleSecOpsClient, "validateRegion")
      .mockImplementation((): void => {
        throw new BadDataException("Unknown regional endpoint.");
      });

    expect(
      messageOf(() => {
        new GoogleSecOpsConnector().validateSettings(secOpsSettings());
      }),
    ).toBe("Region: Unknown regional endpoint.");
  });

  test("validation contacts nothing and builds no client", () => {
    const fetchCalls: Array<string> = [];
    const factoryCalls: Array<string> = [];
    const connector: GoogleSecOpsConnector = new GoogleSecOpsConnector(
      (url: string, _init: FetchInitLike): Promise<FetchResponseLike> => {
        fetchCalls.push(url);
        return Promise.reject(new Error("no network in validation"));
      },
      (): GoogleSecOpsClient => {
        factoryCalls.push("built");
        throw new Error("no client in validation");
      },
    );

    connector.validateSettings(secOpsSettings());
    expect(() => {
      connector.validateSettings(
        secOpsSettings({ config: { region: "mars" } }),
      );
    }).toThrow(BadDataException);

    expect(fetchCalls).toEqual([]);
    expect(factoryCalls).toEqual([]);
  });

  test("the alerting-only selection is not a setting validation cares about", () => {
    expect(() => {
      new GoogleSecOpsConnector().validateSettings(
        secOpsSettings({ alertingOnly: false }),
      );
    }).not.toThrow();
  });

  test("token_uri on any googleapis.com host or accounts.google.com is accepted", () => {
    for (const tokenUri of [
      TOKEN_URI,
      "https://accounts.google.com/o/oauth2/token",
      "https://sts.googleapis.com/v1/token",
    ]) {
      expect(() => {
        new GoogleSecOpsConnector().validateSettings(
          secOpsSettings({
            secrets: {
              serviceAccountJson: serviceAccount({
                client_email: SERVICE_ACCOUNT_EMAIL,
                private_key: PRIVATE_KEY,
                token_uri: tokenUri,
              }),
            },
          }),
        );
      }).not.toThrow();
    }
  });
});
