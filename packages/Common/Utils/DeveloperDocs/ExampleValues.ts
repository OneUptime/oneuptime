import { JSONValue } from "../../Types/JSON";
import {
  TerraformAttributeDescriptor,
  TerraformValueKind,
} from "./TerraformSchema";

/*
 * What the Developer pages' examples share: where the API key comes from,
 * and the example values a new resource is started from.
 */

/*
 * The environment variable every example reads the API key from. It is the
 * one the Terraform provider reads, so a single `export` serves the
 * Terraform, API and AI pages alike, and no key is ever written into a
 * command or a configuration.
 */
export const ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE: string =
  "ONEUPTIME_API_KEY";

// `export ONEUPTIME_API_KEY="your-api-key"`.
export function getApiKeyExportCommand(): string {
  return `export ${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE}="your-api-key"`;
}

/*
 * An example value for a field a new resource must have: "My workflow" for
 * its name, the field's default or documented example when it has one, and
 * a placeholder to replace otherwise ("<incident severity id>").
 */
export function getExampleJsonValue(data: {
  descriptor: TerraformAttributeDescriptor;
  singularName: string;
  isNameColumn: boolean;
}): JSONValue {
  const { descriptor } = data;

  if (data.isNameColumn) {
    return `My ${data.singularName.toLowerCase()}`;
  }

  if (descriptor.defaultValue !== undefined) {
    return descriptor.defaultValue;
  }

  switch (descriptor.kind) {
    case TerraformValueKind.Number:
      return typeof descriptor.example === "number" ? descriptor.example : 1;
    case TerraformValueKind.Bool:
      return true;
    case TerraformValueKind.DateTime:
      return "2030-01-01T00:00:00.000Z";
    case TerraformValueKind.IdSet:
    case TerraformValueKind.StringSet:
      return [];
    case TerraformValueKind.Json:
      return {};
    default:
      break;
  }

  if (descriptor.columnName.endsWith("Id")) {
    return `<${descriptor.title.replace(/\s*ID$/i, "").toLowerCase()} id>`;
  }

  if (typeof descriptor.example === "string" && descriptor.example.length > 0) {
    return descriptor.example;
  }

  return `<${descriptor.title.toLowerCase()}>`;
}
