import SecurityEventDestination from "Common/Models/DatabaseModels/SecurityEventDestination";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import HashedString from "Common/Types/HashedString";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { ConnectorField } from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  SecurityEventDestinationDefinition,
  getSecurityEventDestinationDefinition,
} from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import SecurityEventDestinationScope, {
  DEFAULT_SECURITY_EVENT_DESTINATION_SCOPE,
  isSecurityEventDestinationScope,
} from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The "Send to your SIEM" form and table, without React: what the form's
 * values mean, what is sent to save and to test them, and how a
 * destination is doing. Pinned in App/Tests/Dashboard.
 */

export const SECURITY_EVENT_DESTINATION_TEST_ROUTE: string =
  "/security-event-destination/test";

/*
 * Each provider's fields are named apart in the one form, so a value never
 * carries over to another provider's field of the same key.
 */
export function destinationConfigFieldName(
  provider: string,
  key: string,
): string {
  return `${provider}__config__${key}`;
}

export function destinationSecretFieldName(
  provider: string,
  key: string,
): string {
  return `${provider}__secret__${key}`;
}

export interface SecurityEventDestinationFormSubmission {
  provider: string;
  name: string;
  config: JSONObject;
  // Only what was typed: a blank secret keeps the stored one.
  secrets: JSONObject;
  sendScope: SecurityEventDestinationScope;
  isEnabled: boolean;
}

function readText(value: JSONValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  // BasicForm wraps a password value in HashedString before submit.
  if (value instanceof HashedString) {
    return value.toString();
  }

  // A dropdown value that has not been unwrapped yet ({ label, value }).
  if (typeof value === "object" && !Array.isArray(value) && "value" in value) {
    return readText((value as JSONObject)["value"]);
  }

  return typeof value === "string" ? value.trim() : String(value).trim();
}

/*
 * A pasted service-account key is kept as it was pasted - never parsed or
 * trimmed, newlines included - so it reaches the server byte for byte.
 * Whitespace alone is blank.
 */
function readJsonText(value: JSONValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof HashedString) {
    return readJsonText(value.toString());
  }

  if (typeof value === "string") {
    return value.trim() === "" ? "" : value;
  }

  return JSON.stringify(value);
}

function readFieldValue(
  field: ConnectorField,
  value: JSONValue | undefined,
): string {
  return field.type === "json" ? readJsonText(value) : readText(value);
}

export function readSecurityEventDestinationForm(
  values: JSONObject,
  providerOverride?: string | undefined,
): SecurityEventDestinationFormSubmission {
  const provider: string = providerOverride || readText(values["provider"]);
  const definition: SecurityEventDestinationDefinition | undefined =
    getSecurityEventDestinationDefinition(provider);

  if (!definition) {
    throw new Error("Choose where to send security events before saving.");
  }

  const config: JSONObject = {};

  for (const field of definition.configFields) {
    const value: string = readFieldValue(
      field,
      values[destinationConfigFieldName(provider, field.key)] as
        | JSONValue
        | undefined,
    );

    if (value !== "") {
      config[field.key] = value;
    }
  }

  const secrets: JSONObject = {};

  for (const field of definition.secretFields) {
    const value: string = readFieldValue(
      field,
      values[destinationSecretFieldName(provider, field.key)] as
        | JSONValue
        | undefined,
    );

    if (value !== "") {
      secrets[field.key] = value;
    }
  }

  const scope: string = readText(values["sendScope"]);

  return {
    provider,
    name: readText(values["name"]) || definition.title,
    config,
    secrets,
    sendScope: isSecurityEventDestinationScope(scope)
      ? scope
      : DEFAULT_SECURITY_EVENT_DESTINATION_SCOPE,
    isEnabled: values["isEnabled"] !== false,
  };
}

/*
 * What the form tests: the settings as typed, never saved. On edit, the
 * saved destination's id with the edits over it - a blank key is tested
 * with the stored one, which the server reads and never returns.
 */
export function securityEventDestinationTestBody(data: {
  values: JSONObject;
  destination?: SecurityEventDestination | undefined;
}): JSONObject {
  const submission: SecurityEventDestinationFormSubmission =
    readSecurityEventDestinationForm(data.values, data.destination?.provider);

  if (data.destination?.id) {
    return {
      destinationId: data.destination.id.toString(),
      config: submission.config,
      secrets: submission.secrets,
    };
  }

  return {
    provider: submission.provider,
    config: submission.config,
    secrets: submission.secrets,
  };
}

// The edit: a blank key keeps the stored one, so it is left out.
export function securityEventDestinationUpdatePayload(
  submission: SecurityEventDestinationFormSubmission,
): JSONObject {
  return {
    name: submission.name,
    config: submission.config,
    sendScope: submission.sendScope,
    isEnabled: submission.isEnabled,
    ...(Object.keys(submission.secrets).length > 0
      ? { secrets: JSON.stringify(submission.secrets) }
      : {}),
  };
}

/*
 * Why the form's test cannot run yet: a new destination has no stored key
 * to fall back on, so the key has to be pasted first.
 */
export function destinationTestDisabledReason(data: {
  values: JSONObject;
  destination?: SecurityEventDestination | undefined;
}): string | undefined {
  const provider: string =
    data.destination?.provider || readText(data.values["provider"]);
  const definition: SecurityEventDestinationDefinition | undefined =
    getSecurityEventDestinationDefinition(provider);

  if (!definition) {
    return translationKey("Choose where to send security events first.");
  }

  const missingConfig: boolean = definition.configFields.some(
    (field: ConnectorField): boolean => {
      return (
        field.required &&
        readFieldValue(
          field,
          data.values[destinationConfigFieldName(provider, field.key)] as
            | JSONValue
            | undefined,
        ) === ""
      );
    },
  );

  if (missingConfig) {
    return translationKey("Fill in the settings above to send a test event.");
  }

  if (data.destination?.id) {
    return undefined;
  }

  const missingSecret: boolean = definition.secretFields.some(
    (field: ConnectorField): boolean => {
      return (
        field.required &&
        readFieldValue(
          field,
          data.values[destinationSecretFieldName(provider, field.key)] as
            | JSONValue
            | undefined,
        ) === ""
      );
    },
  );

  return missingSecret
    ? translationKey("Paste the key above to send a test event.")
    : undefined;
}

export enum SecurityEventDestinationHealth {
  Paused = "Paused",
  Failing = "Failing",
  Sending = "Sending",
  // Tried, nothing to send yet: no detection since it was set up.
  Waiting = "Waiting for events",
  // Saved, the first send not run yet.
  Starting = "Starting",
}

export const SECURITY_EVENT_DESTINATION_HEALTH_TEXTS: Record<
  SecurityEventDestinationHealth,
  { title: string; description: string }
> = {
  [SecurityEventDestinationHealth.Paused]: {
    title: translationKey("Paused"),
    description: translationKey(
      "Nothing is sent while it is turned off. Events that arrive meanwhile are not sent later.",
    ),
  },
  [SecurityEventDestinationHealth.Failing]: {
    title: translationKey("Failing"),
    description: translationKey(
      "The last send failed. Open View Error to see why, fix the settings, then send a test event.",
    ),
  },
  [SecurityEventDestinationHealth.Sending]: {
    title: translationKey("Sending"),
    description: translationKey(
      "Security events are reaching your SIEM. New ones are sent every minute.",
    ),
  },
  [SecurityEventDestinationHealth.Waiting]: {
    title: translationKey("Waiting for events"),
    description: translationKey(
      "Working, with nothing to send yet. Events are sent as soon as there are some.",
    ),
  },
  [SecurityEventDestinationHealth.Starting]: {
    title: translationKey("Starting"),
    description: translationKey("The first send runs within a minute."),
  },
};

export function getSecurityEventDestinationHealth(
  destination: Pick<
    SecurityEventDestination,
    "isEnabled" | "lastError" | "lastSentAt" | "lastAttemptAt"
  >,
): SecurityEventDestinationHealth {
  if (destination.isEnabled === false) {
    return SecurityEventDestinationHealth.Paused;
  }

  if (destination.lastError) {
    return SecurityEventDestinationHealth.Failing;
  }

  if (destination.lastSentAt) {
    return SecurityEventDestinationHealth.Sending;
  }

  if (destination.lastAttemptAt) {
    return SecurityEventDestinationHealth.Waiting;
  }

  return SecurityEventDestinationHealth.Starting;
}

export function getSecurityEventDestinationHealthColor(
  health: SecurityEventDestinationHealth,
): Color {
  switch (health) {
    case SecurityEventDestinationHealth.Failing:
      return Red;
    case SecurityEventDestinationHealth.Sending:
      return Green;
    case SecurityEventDestinationHealth.Paused:
      return Yellow;
    default:
      return Gray500;
  }
}
