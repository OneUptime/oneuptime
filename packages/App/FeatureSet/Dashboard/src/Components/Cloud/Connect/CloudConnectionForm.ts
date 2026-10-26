import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import HashedString from "Common/Types/HashedString";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  CloudConnectionAuthMethod,
  CloudConnectionDefinition,
  CloudConnectionField,
  READ_SCOPE_FIELD_KEY,
  getCloudConnectionAuthMethod,
  getCloudConnectionFieldsForMethod,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionSetupScope } from "Common/Types/CloudConnection/CloudConnectionSetupCommands";
import {
  CloudConnectionPasteResult,
  readCloudConnectionPaste,
} from "Common/Types/CloudConnection/CloudConnectionPaste";

/*
 * The connection form's values, read the way the API stores them - kept
 * apart from the form itself (CloudConnectionFormModal) so they can be
 * tested without React, and read by App's tests.
 *
 * Field names in the form: a config setting is `config__<key>`, a secret
 * `secret__<key>`, the sign-in method `authMethod`, what was pasted
 * `pasted`.
 */

export const ACCESS_STEP_ID: string = "access";
export const CREDENTIALS_STEP_ID: string = "credentials";
export const TEST_STEP_ID: string = "test";

export const AUTH_METHOD_FIELD: string = "authMethod";
export const PASTED_FIELD: string = "pasted";

export function configFieldName(key: string): string {
  return `config__${key}`;
}

export function secretFieldName(key: string): string {
  return `secret__${key}`;
}

export function readFormText(value: JSONValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  // BasicForm wraps Password values in HashedString before submit.
  if (value instanceof HashedString) {
    return value.toString();
  }

  if (typeof value === "object" && "value" in (value as JSONObject)) {
    // A dropdown value that has not been unwrapped yet ({ label, value }).
    return readFormText((value as JSONObject)["value"]);
  }

  return String(value);
}

// The sign-in method the form holds, or the cloud's default.
export function readFormAuthMethod(
  definition: CloudConnectionDefinition,
  values: JSONObject,
  fallback?: CloudConnectionAuthMethod | undefined,
): CloudConnectionAuthMethod {
  const value: string = readFormText(
    values[AUTH_METHOD_FIELD] as JSONValue | undefined,
  );

  return getCloudConnectionAuthMethod(definition, value || fallback);
}

/*
 * The "What to read" setting of a sign-in method: undefined for a method
 * that reads one account only (an AWS access key: its user cannot sign in
 * to the other accounts' roles).
 */
export function getReadScopeField(
  definition: CloudConnectionDefinition,
  method: CloudConnectionAuthMethod,
): CloudConnectionField | undefined {
  return getCloudConnectionFieldsForMethod(
    definition.configFields,
    method,
  ).find((field: CloudConnectionField): boolean => {
    return field.key === READ_SCOPE_FIELD_KEY;
  });
}

/*
 * What the form says to read, which decides the command it shows: every
 * account of the organization only when that is picked and the method
 * can; otherwise the one account.
 */
export function readFormScope(
  definition: CloudConnectionDefinition,
  values: JSONObject,
  fallbackMethod?: CloudConnectionAuthMethod | undefined,
): CloudConnectionSetupScope {
  const method: CloudConnectionAuthMethod = readFormAuthMethod(
    definition,
    values,
    fallbackMethod,
  );

  if (!getReadScopeField(definition, method)) {
    return CloudConnectionSetupScope.Account;
  }

  return readFormText(
    values[configFieldName(READ_SCOPE_FIELD_KEY)] as JSONValue | undefined,
  ) === CloudConnectionSetupScope.Organization
    ? CloudConnectionSetupScope.Organization
    : CloudConnectionSetupScope.Account;
}

/*
 * Whether a setting is one of the values the Credentials step asks for -
 * pasted, or typed in the fold under the paste. Not the scope (chosen on
 * the first step), not a value only a paste fills in (an Azure secret's
 * expiry, kept with the rest), not one of the settings under More fields.
 */
export function isCredentialValueField(field: CloudConnectionField): boolean {
  return (
    field.key !== READ_SCOPE_FIELD_KEY && !field.isHidden && !field.isAdvanced
  );
}

export interface CloudConnectionFormSubmission {
  name: string;
  config: JSONObject;
  // Only what was typed: a blank secret keeps the stored one on edit.
  secrets: JSONObject;
}

// The form's values as the API stores them, for the method picked.
export function readCloudConnectionForm(
  definition: CloudConnectionDefinition,
  values: JSONObject,
  fallbackMethod?: CloudConnectionAuthMethod | undefined,
): CloudConnectionFormSubmission {
  const method: CloudConnectionAuthMethod = readFormAuthMethod(
    definition,
    values,
    fallbackMethod,
  );
  const config: JSONObject = { authMethod: method };

  for (const field of getCloudConnectionFieldsForMethod(
    definition.configFields,
    method,
  )) {
    const text: string = readFormText(
      values[configFieldName(field.key)] as JSONValue | undefined,
    ).trim();

    if (text) {
      config[field.key] = text;
    }
  }

  const secrets: JSONObject = {};

  for (const field of getCloudConnectionFieldsForMethod(
    definition.secretFields,
    method,
  )) {
    const raw: string = readFormText(
      values[secretFieldName(field.key)] as JSONValue | undefined,
    );

    // A pasted key file keeps its newlines; whitespace alone is blank.
    if (raw.trim()) {
      secrets[field.key] = field.type === "json" ? raw : raw.trim();
    }
  }

  return {
    name:
      readFormText(values["name"] as JSONValue | undefined).trim() ||
      definition.title,
    config,
    secrets,
  };
}

/*
 * The body for POST /cloud-connection/test: the unsaved settings on
 * create, or the connection and the form's edits on edit.
 */
export function cloudConnectionTestBody(data: {
  definition: CloudConnectionDefinition;
  values: JSONObject;
  connection?: CloudConnection | undefined;
  fallbackMethod?: CloudConnectionAuthMethod | undefined;
}): JSONObject {
  const submission: CloudConnectionFormSubmission = readCloudConnectionForm(
    data.definition,
    data.values,
    data.fallbackMethod,
  );

  if (data.connection?.id) {
    return {
      connectionId: data.connection.id.toString(),
      config: submission.config,
      secrets: submission.secrets,
    };
  }

  return {
    provider: data.definition.provider,
    config: submission.config,
    secrets: submission.secrets,
  };
}

/*
 * The required fields of the method still empty. On edit a secret is
 * never missing: the stored one is kept.
 */
export function getMissingCloudConnectionFields(data: {
  definition: CloudConnectionDefinition;
  values: JSONObject;
  isEditing: boolean;
  fallbackMethod?: CloudConnectionAuthMethod | undefined;
}): Array<CloudConnectionField> {
  const method: CloudConnectionAuthMethod = readFormAuthMethod(
    data.definition,
    data.values,
    data.fallbackMethod,
  );
  const secretFields: Array<CloudConnectionField> =
    getCloudConnectionFieldsForMethod(data.definition.secretFields, method);

  return [
    ...getCloudConnectionFieldsForMethod(data.definition.configFields, method),
    ...(data.isEditing ? [] : secretFields),
  ].filter((field: CloudConnectionField): boolean => {
    if (!field.required || field.defaultValue !== undefined) {
      return false;
    }

    const key: string = secretFields.includes(field)
      ? secretFieldName(field.key)
      : configFieldName(field.key);

    return !readFormText(data.values[key] as JSONValue | undefined).trim();
  });
}

/*
 * The form's values with what a paste filled in: every value the paste
 * names replaces the field's, the rest stay. Undefined when the paste
 * names nothing.
 */
export function applyCloudConnectionPaste(data: {
  definition: CloudConnectionDefinition;
  method: CloudConnectionAuthMethod;
  values: JSONObject;
  pasted: string;
}): JSONObject | undefined {
  const found: CloudConnectionPasteResult = readCloudConnectionPaste(
    data.definition.provider,
    data.method,
    data.pasted,
  );
  const keys: Array<string> = [
    ...Object.keys(found.config),
    ...Object.keys(found.secrets),
  ];

  if (keys.length === 0) {
    return undefined;
  }

  const next: JSONObject = { ...data.values, [PASTED_FIELD]: data.pasted };

  for (const key of Object.keys(found.config)) {
    next[configFieldName(key)] = found.config[key]!;
  }

  for (const key of Object.keys(found.secrets)) {
    next[secretFieldName(key)] = found.secrets[key]!;
  }

  return next;
}

// The titles of the fields a paste fills in, in the form's order.
export function getPastedFieldTitles(data: {
  definition: CloudConnectionDefinition;
  method: CloudConnectionAuthMethod;
  pasted: string;
}): Array<string> {
  const found: CloudConnectionPasteResult = readCloudConnectionPaste(
    data.definition.provider,
    data.method,
    data.pasted,
  );

  return [
    ...getCloudConnectionFieldsForMethod(
      data.definition.configFields,
      data.method,
    ).filter((field: CloudConnectionField): boolean => {
      return Boolean(found.config[field.key]);
    }),
    ...getCloudConnectionFieldsForMethod(
      data.definition.secretFields,
      data.method,
    ).filter((field: CloudConnectionField): boolean => {
      return Boolean(found.secrets[field.key]);
    }),
  ].map((field: CloudConnectionField): string => {
    return field.title;
  });
}
