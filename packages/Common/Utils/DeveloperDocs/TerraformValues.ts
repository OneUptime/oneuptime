import { JSONObject } from "../../Types/JSON";
import { Hcl, HclExpression, HclObjectAttribute } from "./Hcl";

/*
 * Turning API values into HCL values, and keeping secrets out of them.
 *
 * Everything here works on the API's JSON (what `BaseModel.toJSON` produces,
 * and what the Terraform provider itself reads): wrapper objects such as
 * `{_type: "Color", value: "#ff0000"}`, ids as strings, nested JSON.
 */

/*
 * Key names that hold credentials inside JSON values: a database monitor's
 * password, an integration's token. Only non-empty string values under them
 * are treated as secrets; `isSecret: true` is not one.
 */
const SECRET_KEY_NAME: RegExp =
  /(secret|password|passphrase|token|apikey|api_key|api-key|privatekey|private_key|authkey|privkey|communitystring|credential)/i;

// HTTP headers whose value is a credential.
const SECRET_HEADER_NAME: RegExp =
  /(authorization|cookie|token|secret|password|api[-_]?key|auth)/i;

/*
 * A reference to a monitor secret ({{monitorSecrets.name}}) is not itself a
 * secret: the value is stored in OneUptime and only the reference is in the
 * monitor. It is kept as it is.
 */
const MONITOR_SECRET_REFERENCE: RegExp = /\{\{\s*monitorSecrets\./;

export function isSecretKeyName(key: string): boolean {
  return SECRET_KEY_NAME.test(key);
}

export function isSecretHeaderName(name: string): boolean {
  return SECRET_HEADER_NAME.test(name);
}

export function isMonitorSecretReference(value: string): boolean {
  return MONITOR_SECRET_REFERENCE.test(value);
}

export function isJSONObject(value: unknown): value is JSONObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/*
 * A variable the configuration reads a secret from, instead of carrying the
 * secret itself: `var.<name>`, declared with `sensitive = true`.
 */
export interface TerraformSecretVariable {
  name: string;
  description: string;
}

/*
 * Hands out variable names for the secrets one configuration needs, each
 * unique within it.
 */
export class TerraformVariableCollector {
  private readonly names: Set<string> = new Set<string>();
  public readonly variables: Array<TerraformSecretVariable> = [];

  public add(baseName: string, description: string): HclExpression {
    const base: string = toTerraformIdentifier(baseName) || "secret";
    let name: string = base;
    let suffix: number = 2;

    while (this.names.has(name)) {
      name = `${base}_${suffix}`;
      suffix++;
    }

    this.names.add(name);
    this.variables.push({ name, description });

    return Hcl.raw(`var.${name}`);
  }
}

/*
 * A Terraform identifier (resource local name, variable name) made from free
 * text: lowercase letters, digits and underscores, starting with a letter or
 * an underscore. Empty when the text has nothing usable in it.
 */
export function toTerraformIdentifier(text: string): string {
  const identifier: string = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!identifier) {
    return "";
  }

  return /^[0-9]/.test(identifier) ? `_${identifier}` : identifier;
}

/*
 * The string a wrapper object stands for: `{_type: "URL", value: "..."}` and
 * friends give their value, a related object its `_id`. Plain strings come
 * back as they are. Empty strings count as no value, as they do for the
 * provider (absent-or-empty always means "unset").
 */
export function unwrapApiString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }

  if (isJSONObject(value)) {
    const inner: unknown = value["value"];

    if (typeof inner === "string") {
      return inner.length > 0 ? inner : null;
    }

    const id: unknown = value["_id"];

    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }

  return null;
}

// A number, from a plain number or a wrapper such as `{_type: "Port", value: 443}`.
export function unwrapApiNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (isJSONObject(value)) {
    return unwrapApiNumber(value["value"]);
  }

  return null;
}

/*
 * A JSON value as an HCL value, for writing inside jsonencode(). Object keys
 * are kept exactly (quoted where they are not plain identifiers), so the JSON
 * Terraform encodes is the JSON that came in.
 *
 * `redact` is asked about every string under an object key: returning an
 * expression puts it in place of the string (a `var.` reference for a
 * secret).
 */
export type JsonRedactFunction = (
  key: string,
  value: string,
  path: Array<string>,
) => HclExpression | null;

export function jsonToHcl(
  value: unknown,
  redact?: JsonRedactFunction,
  path: Array<string> = [],
): HclExpression {
  if (value === null || value === undefined) {
    return Hcl.null();
  }

  if (typeof value === "string") {
    return Hcl.string(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? Hcl.number(value) : Hcl.null();
  }

  if (typeof value === "boolean") {
    return Hcl.bool(value);
  }

  if (Array.isArray(value)) {
    return Hcl.tuple(
      value.map((item: unknown, index: number): HclExpression => {
        return jsonToHcl(item, redact, [...path, String(index)]);
      }),
    );
  }

  if (value instanceof Date) {
    return Hcl.string(value.toISOString());
  }

  if (isJSONObject(value)) {
    const attributes: Array<HclObjectAttribute> = Object.keys(value)
      .filter((key: string): boolean => {
        return value[key] !== undefined;
      })
      .map((key: string): HclObjectAttribute => {
        const child: unknown = value[key];

        if (redact && typeof child === "string" && child.length > 0) {
          const replacement: HclExpression | null = redact(key, child, [
            ...path,
            key,
          ]);

          if (replacement) {
            return { key, value: replacement };
          }
        }

        return { key, value: jsonToHcl(child, redact, [...path, key]) };
      });

    return Hcl.object(attributes);
  }

  return Hcl.string(String(value));
}

// Whether any non-empty string in a JSON value sits under a secret-looking key.
export function hasSecretValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item: unknown): boolean => {
      return hasSecretValue(item);
    });
  }

  if (isJSONObject(value)) {
    return Object.keys(value).some((key: string): boolean => {
      const child: unknown = value[key];

      if (typeof child === "string" && child.length > 0) {
        return isSecretKeyName(key) && !isMonitorSecretReference(child);
      }

      return hasSecretValue(child);
    });
  }

  return false;
}

/*
 * jsonencode(<value>), with every secret under a secret-looking key read from
 * a variable instead. `describe` names a variable for the key it replaces.
 */
export function jsonencodeWithSecretVariables(data: {
  value: unknown;
  variables: TerraformVariableCollector;
  variablePrefix: string;
  describe: (key: string) => string;
}): HclExpression {
  return Hcl.call("jsonencode", [
    jsonToHcl(
      data.value,
      (key: string, text: string): HclExpression | null => {
        if (!isSecretKeyName(key) || isMonitorSecretReference(text)) {
          return null;
        }

        return data.variables.add(
          `${data.variablePrefix}_${key}`,
          data.describe(key),
        );
      },
    ),
  ]);
}

/*
 * JSON as Go's encoding/json writes it for a map: keys sorted, no spaces,
 * and <, > and & escaped. That is how the provider stores a JSON attribute it
 * reads back, and what Terraform's jsonencode() produces from the same
 * object, so two values compare equal exactly when these strings do.
 */
export function toCanonicalJson(value: unknown): string {
  return (JSON.stringify(sortJsonKeys(value)) ?? "null")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown): unknown => {
      return sortJsonKeys(item);
    });
  }

  if (isJSONObject(value)) {
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        sorted[key] = sortJsonKeys(value[key]);
      }
    }

    return sorted;
  }

  return value;
}

// Whether two JSON values are the same value (key order aside).
export function isSameJsonValue(left: unknown, right: unknown): boolean {
  return toCanonicalJson(left) === toCanonicalJson(right);
}
