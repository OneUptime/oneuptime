import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_EVENT_CONNECTION_OPTION_TEXTS,
  SECURITY_EVENT_DESTINATION_FIELD_TEXTS,
  SECURITY_EVENT_DESTINATION_SCOPE_TEXTS,
  SECURITY_EVENT_DESTINATION_TEXTS,
  SECURITY_LOG_FORMAT_TEXTS,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityConnectionsCopy";
import {
  SECURITY_EVENT_DESTINATION_HEALTH_TEXTS,
  SECURITY_EVENT_DESTINATION_TEST_ROUTE,
  SecurityEventDestinationHealth,
  destinationConfigFieldName,
  destinationSecretFieldName,
  destinationTestDisabledReason,
  getSecurityEventDestinationHealth,
  getSecurityEventDestinationHealthColor,
  readSecurityEventDestinationForm,
  securityEventDestinationTestBody,
  securityEventDestinationUpdatePayload,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDestinationUtil";
import SecurityEventDestination from "Common/Models/DatabaseModels/SecurityEventDestination";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ConnectorField,
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  SecurityEventDestinationCatalog,
  SecurityEventDestinationDefinition,
} from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import SecurityEventDestinationProvider from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import SecurityEventDestinationScope, {
  SECURITY_EVENT_DESTINATION_SCOPES,
} from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import {
  SECURITY_LOG_FORMATS,
  SecurityLogFormatDefinition,
} from "Common/Types/SecurityEvent/SecurityLogFormat";

/*
 * The "Send to your SIEM" form without React: what its values mean, what
 * is posted to test them and to save them, how a destination's health is
 * read - and the words the Connections page marks for translation, held to
 * the Common definitions they repeat.
 */

const GOOGLE: string = SecurityEventDestinationProvider.GoogleSecOps;
const INSTANCE: string = "projects/acme/locations/europe/instances/chronicle";
const KEY: string =
  '{\n  "client_email": "x@acme.example",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\nabc\\n"\n}\n';
const DESTINATION_ID: string = "66666666-6666-4666-8666-666666666666";

function values(overrides: JSONObject = {}): JSONObject {
  return {
    provider: GOOGLE,
    name: "Production SecOps",
    sendScope: SecurityEventDestinationScope.AllEvents,
    [destinationConfigFieldName(GOOGLE, "region")]: {
      label: "europe",
      value: "europe",
    },
    [destinationConfigFieldName(GOOGLE, "instanceResourceName")]:
      `  ${INSTANCE}  `,
    [destinationSecretFieldName(GOOGLE, "serviceAccountJson")]: KEY,
    ...overrides,
  };
}

function saved(): SecurityEventDestination {
  const destination: SecurityEventDestination = new SecurityEventDestination();
  destination.id = new ObjectID(DESTINATION_ID);
  destination.provider = SecurityEventDestinationProvider.GoogleSecOps;
  destination.config = { region: "europe", instanceResourceName: INSTANCE };
  return destination;
}

describe("reading the form", () => {
  test("unwraps a dropdown, trims text and keeps a pasted key byte for byte", () => {
    expect(readSecurityEventDestinationForm(values())).toEqual({
      provider: GOOGLE,
      name: "Production SecOps",
      config: { region: "europe", instanceResourceName: INSTANCE },
      secrets: { serviceAccountJson: KEY },
      sendScope: SecurityEventDestinationScope.AllEvents,
      isEnabled: true,
    });
  });

  test("a masked secret arrives as HashedString and is read as its text", () => {
    expect(
      readSecurityEventDestinationForm(
        values({
          [destinationSecretFieldName(GOOGLE, "serviceAccountJson")]:
            new HashedString(KEY) as unknown as string,
        }),
      ).secrets,
    ).toEqual({ serviceAccountJson: KEY });
  });

  test("a blank key is left out, a blank name is the SIEM's, an unknown choice is detections only", () => {
    expect(
      readSecurityEventDestinationForm(
        values({
          name: "  ",
          sendScope: "everything",
          [destinationSecretFieldName(GOOGLE, "serviceAccountJson")]: " \n ",
        }),
      ),
    ).toEqual({
      provider: GOOGLE,
      name: "Google SecOps",
      config: { region: "europe", instanceResourceName: INSTANCE },
      secrets: {},
      sendScope: SecurityEventDestinationScope.Detections,
      isEnabled: true,
    });
  });

  test("turned off reads as off; anything else is on", () => {
    expect(
      readSecurityEventDestinationForm(values({ isEnabled: false })).isEnabled,
    ).toBe(false);
    expect(
      readSecurityEventDestinationForm(
        values({ isEnabled: undefined as never }),
      ).isEnabled,
    ).toBe(true);
  });

  test("another SIEM's fields of the same key are never read", () => {
    expect(
      readSecurityEventDestinationForm(
        values({ ["splunk__config__region"]: "us" }),
      ).config,
    ).toEqual({ region: "europe", instanceResourceName: INSTANCE });
  });

  test("a form without a SIEM it knows is refused", () => {
    expect(() => {
      return readSecurityEventDestinationForm(values({ provider: "qradar" }));
    }).toThrow("Choose where to send security events before saving.");
  });
});

describe("what is posted", () => {
  test("the test route is the destination API's", () => {
    expect(SECURITY_EVENT_DESTINATION_TEST_ROUTE).toBe(
      "/security-event-destination/test",
    );
  });

  test("a new destination's test sends the settings as typed", () => {
    expect(securityEventDestinationTestBody({ values: values() })).toEqual({
      provider: GOOGLE,
      config: { region: "europe", instanceResourceName: INSTANCE },
      secrets: { serviceAccountJson: KEY },
    });
  });

  test("a saved destination's test sends its id with the edits; a blank key is the stored one", () => {
    expect(
      securityEventDestinationTestBody({
        values: values({
          provider: undefined as never,
          [destinationSecretFieldName(GOOGLE, "serviceAccountJson")]: "",
        }),
        destination: saved(),
      }),
    ).toEqual({
      destinationId: DESTINATION_ID,
      config: { region: "europe", instanceResourceName: INSTANCE },
      secrets: {},
    });
  });

  test("an edit leaves a blank key out, so the stored one stays", () => {
    expect(
      securityEventDestinationUpdatePayload(
        readSecurityEventDestinationForm(
          values({
            [destinationSecretFieldName(GOOGLE, "serviceAccountJson")]: "",
          }),
        ),
      ),
    ).toEqual({
      name: "Production SecOps",
      config: { region: "europe", instanceResourceName: INSTANCE },
      sendScope: SecurityEventDestinationScope.AllEvents,
      isEnabled: true,
    });
    expect(
      securityEventDestinationUpdatePayload(
        readSecurityEventDestinationForm(values()),
      )["secrets"],
    ).toBe(JSON.stringify({ serviceAccountJson: KEY }));
  });
});

describe("when the form's test can run", () => {
  test("not before a SIEM is chosen, its settings filled in and - for a new one - its key pasted", () => {
    expect(
      destinationTestDisabledReason({ values: values({ provider: "" }) }),
    ).toBe("Choose where to send security events first.");
    expect(
      destinationTestDisabledReason({
        values: values({
          [destinationConfigFieldName(GOOGLE, "instanceResourceName")]: "",
        }),
      }),
    ).toBe("Fill in the settings above to send a test event.");
    expect(
      destinationTestDisabledReason({
        values: values({
          [destinationSecretFieldName(GOOGLE, "serviceAccountJson")]: "",
        }),
      }),
    ).toBe("Paste the key above to send a test event.");
    expect(destinationTestDisabledReason({ values: values() })).toBeUndefined();
  });

  test("a saved destination is tested with its stored key", () => {
    expect(
      destinationTestDisabledReason({
        values: values({
          provider: "",
          [destinationSecretFieldName(GOOGLE, "serviceAccountJson")]: "",
        }),
        destination: saved(),
      }),
    ).toBeUndefined();
  });
});

describe("a destination's health", () => {
  test.each([
    [
      "turned off, whatever else",
      { isEnabled: false, lastError: "x", lastSentAt: new Date() },
      SecurityEventDestinationHealth.Paused,
      Yellow,
    ],
    [
      "the last send failed",
      { isEnabled: true, lastError: "HTTP 403", lastSentAt: new Date() },
      SecurityEventDestinationHealth.Failing,
      Red,
    ],
    [
      "events reached it",
      { isEnabled: true, lastSentAt: new Date(), lastAttemptAt: new Date() },
      SecurityEventDestinationHealth.Sending,
      Green,
    ],
    [
      "tried, nothing to send yet",
      { isEnabled: true, lastAttemptAt: new Date() },
      SecurityEventDestinationHealth.Waiting,
      Gray500,
    ],
    [
      "saved, not run yet",
      { isEnabled: true },
      SecurityEventDestinationHealth.Starting,
      Gray500,
    ],
  ])(
    "%s",
    (
      _label: string,
      destination: Partial<SecurityEventDestination>,
      health: SecurityEventDestinationHealth,
      color: unknown,
    ) => {
      expect(
        getSecurityEventDestinationHealth(
          destination as SecurityEventDestination,
        ),
      ).toBe(health);
      expect(getSecurityEventDestinationHealthColor(health)).toBe(color);
      expect(SECURITY_EVENT_DESTINATION_HEALTH_TEXTS[health].title).toBe(
        health,
      );
      expect(
        SECURITY_EVENT_DESTINATION_HEALTH_TEXTS[health].description.length,
      ).toBeGreaterThan(10);
    },
  );
});

describe("the words the Connections page marks for translation", () => {
  test("every log format's title and description, as Common defines them", () => {
    expect(
      SECURITY_LOG_FORMATS.map((format: SecurityLogFormatDefinition) => {
        return SECURITY_LOG_FORMAT_TEXTS[format.format];
      }),
    ).toEqual(
      SECURITY_LOG_FORMATS.map((format: SecurityLogFormatDefinition) => {
        return { title: format.title, description: format.description };
      }),
    );
    expect(Object.keys(SECURITY_LOG_FORMAT_TEXTS)).toHaveLength(
      SECURITY_LOG_FORMATS.length,
    );
  });

  test("what a SIEM can be sent, as Common defines it", () => {
    for (const option of SECURITY_EVENT_DESTINATION_SCOPES) {
      expect(SECURITY_EVENT_DESTINATION_SCOPE_TEXTS[option.scope]).toEqual({
        title: option.title,
        description: option.description,
      });
    }
  });

  /*
   * The picker draws each SIEM's catalog line under its name: a German
   * reader saw four English sentences there until these were keys.
   */
  test("every SIEM's line in the picker, as the catalog defines it", () => {
    expect(
      SecurityEventDestinationCatalog.map(
        (definition: SecurityEventDestinationDefinition) => {
          return [
            definition.provider,
            SECURITY_EVENT_DESTINATION_TEXTS[definition.provider],
          ];
        },
      ),
    ).toEqual(
      SecurityEventDestinationCatalog.map(
        (definition: SecurityEventDestinationDefinition) => {
          return [definition.provider, definition.description];
        },
      ),
    );
    expect(Object.keys(SECURITY_EVENT_DESTINATION_TEXTS)).toHaveLength(
      SecurityEventDestinationCatalog.length,
    );
  });

  /*
   * What is sent - detections, or every event - is the form's own last
   * question: no SIEM's line says it again, so the four lines tell the
   * SIEMs apart rather than repeat one sentence four times.
   */
  test("no SIEM's line repeats what the form asks on its last step", () => {
    for (const definition of SecurityEventDestinationCatalog) {
      expect([definition.provider, definition.description]).not.toEqual([
        definition.provider,
        expect.stringContaining("detections"),
      ]);
      expect(definition.description.length).toBeLessThanOrEqual(80);
    }
  });

  /*
   * A connection's own options (Close alerts when their case closes) sit on
   * the connection form's last step in the catalog's words: these keys put
   * the same words in the locale files.
   */
  test("every connection option, as the connector catalog defines it", () => {
    const options: Array<ConnectorField> =
      SecurityEventConnectorCatalog.flatMap(
        (definition: SecurityEventConnectorDefinition) => {
          return definition.configFields.filter(
            (field: ConnectorField): boolean => {
              return Boolean(field.isOption);
            },
          );
        },
      );

    expect(options.length).toBeGreaterThan(0);

    for (const field of options) {
      expect([
        field.key,
        SECURITY_EVENT_CONNECTION_OPTION_TEXTS[field.key],
      ]).toEqual([
        field.key,
        { title: field.title, description: field.description },
      ]);
    }

    expect(Object.keys(SECURITY_EVENT_CONNECTION_OPTION_TEXTS).sort()).toEqual(
      options
        .map((field: ConnectorField): string => {
          return field.key;
        })
        .sort(),
    );
  });

  test("every field of every SIEM's form, as the catalog defines it", () => {
    const fields: Array<ConnectorField> =
      SecurityEventDestinationCatalog.flatMap(
        (definition: SecurityEventDestinationDefinition) => {
          return [...definition.configFields, ...definition.secretFields];
        },
      );

    for (const field of fields) {
      expect([
        field.key,
        SECURITY_EVENT_DESTINATION_FIELD_TEXTS[field.key],
      ]).toEqual([
        field.key,
        { title: field.title, description: field.description },
      ]);
    }

    expect(Object.keys(SECURITY_EVENT_DESTINATION_FIELD_TEXTS).sort()).toEqual(
      fields
        .map((field: ConnectorField): string => {
          return field.key;
        })
        .sort(),
    );
  });
});
