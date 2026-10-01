import { DatabaseBaseModelType } from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { Hcl, HclBodyItem, HclExpression, printHclDocument } from "./Hcl";
import { monitorStepsToHcl } from "./TerraformMonitorSteps";
import {
  getNameColumn,
  getTerraformAttributes,
  getTerraformTypeName,
  TerraformAttributeDescriptor,
  TerraformSecretKind,
  TerraformValueKind,
} from "./TerraformSchema";
import {
  isJSONObject,
  isSameJsonValue,
  jsonencodeWithSecretVariables,
  jsonToHcl,
  TerraformSecretVariable,
  TerraformVariableCollector,
  toTerraformIdentifier,
  unwrapApiNumber,
} from "./TerraformValues";
import {
  getExampleJsonValue,
  ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE,
  toSentenceCaseName,
} from "./ExampleValues";

/*
 * Terraform configuration for the dashboard's Developer > Terraform pages:
 * the provider setup, one real resource written out as code (with the
 * `import` block that adopts it), a starter block for creating a new one,
 * and `import` blocks for every existing resource of a type.
 *
 * Which attributes a resource's configuration carries is decided so that,
 * once imported, `terraform plan` has nothing to change:
 *
 *   - required attributes are always written;
 *   - an attribute with a default (the provider plans the default whenever
 *     an attribute is left out) is written when its value is not the default;
 *   - any other attribute is written when it has a value, it can be both
 *     created and updated, and it is configuration rather than state the
 *     server keeps moving (TerraformSchema's isServerManaged). Leaving one out
 *     is always safe: the provider keeps whatever the server has;
 *   - secrets are never written. One that must be written (required, or
 *     inside a value that is) is read from a sensitive variable; any other is
 *     left out, and the configuration says so in a comment.
 */

export const TERRAFORM_PROVIDER_SOURCE: string = "oneuptime/oneuptime";

// Version every development build reports; it says nothing about the provider to use.
const DEVELOPMENT_VERSION: string = "1.0.0";

const MAX_LOCAL_NAME_LENGTH: number = 40;

// Why an attribute with a value was left out of a resource's configuration.
export enum TerraformOmissionReason {
  Secret = "secret",
  Hashed = "hashed",
  ServerManaged = "server-managed",
  Unsupported = "unsupported",
  // Set only at creation, or only on update, and not configuration we can carry safely.
  NotUpdatable = "not-updatable",
}

export interface TerraformOmittedAttribute {
  attributeName: string;
  title: string;
  reason: TerraformOmissionReason;
}

export interface TerraformResourceConfig {
  // `oneuptime_workflow`.
  typeName: string;
  // `send_weekly_report`.
  localName: string;
  // `oneuptime_workflow.send_weekly_report`.
  address: string;
  // The resource block, preceded by the variables its secrets are read from.
  resourceHcl: string;
  // The `import` block that adopts the existing resource.
  importHcl: string;
  // Both, as one file.
  hcl: string;
  // `terraform import oneuptime_workflow.send_weekly_report <id>`.
  importCommand: string;
  // A data source that reads the resource without managing it.
  dataSourceHcl: string;
  variables: Array<TerraformSecretVariable>;
  omittedSecrets: Array<TerraformOmittedAttribute>;
}

/*
 * The provider version constraint for an installation: the newest published
 * provider that is not newer than the platform (provider versions follow
 * platform versions, and a newer provider may use API fields an older
 * platform lacks). Null when the version is unknown, in which case
 * Terraform picks the newest provider.
 */
export function getTerraformProviderVersionConstraint(
  platformVersion: string | null | undefined,
): string | null {
  const version: string = (platformVersion || "").trim();
  const match: RegExpMatchArray | null = version.match(/^(\d+)\.(\d+)\.(\d+)$/);

  if (!match || version === DEVELOPMENT_VERSION) {
    return null;
  }

  return `>= ${match[1]}.0, <= ${version}`;
}

/*
 * The provider's `oneuptime_url`: the instance's origin with no path. Null
 * when the dashboard does not know its own address.
 */
export function getTerraformProviderUrl(data: {
  host: string | null | undefined;
  isHttps: boolean;
}): string | null {
  const host: string = (data.host || "").trim().replace(/\/+$/, "");

  if (!host) {
    return null;
  }

  return `${data.isHttps ? "https" : "http"}://${host}`;
}

// `terraform { required_providers { ... } }` and `provider "oneuptime" { ... }`.
export function getTerraformProviderHcl(data: {
  oneuptimeUrl: string | null;
  platformVersion: string | null | undefined;
}): string {
  const versionConstraint: string | null =
    getTerraformProviderVersionConstraint(data.platformVersion);

  const requirement: Array<{ key: string; value: HclExpression }> = [
    { key: "source", value: Hcl.string(TERRAFORM_PROVIDER_SOURCE) },
  ];

  if (versionConstraint) {
    requirement.push({ key: "version", value: Hcl.string(versionConstraint) });
  }

  const providerBody: Array<HclBodyItem> = [];

  if (data.oneuptimeUrl) {
    providerBody.push(
      Hcl.attribute("oneuptime_url", Hcl.string(data.oneuptimeUrl)),
    );
  }

  providerBody.push(
    Hcl.comment(
      `The API key is read from the ${ONEUPTIME_API_KEY_ENVIRONMENT_VARIABLE} environment variable.`,
    ),
  );

  return printHclDocument([
    Hcl.block(
      "terraform",
      [],
      [
        Hcl.block(
          "required_providers",
          [],
          [Hcl.attribute("oneuptime", Hcl.object(requirement))],
        ),
      ],
    ),
    Hcl.blank(),
    Hcl.block("provider", ["oneuptime"], providerBody),
  ]);
}

/*
 * A Terraform name for a record, made from its display name: "Send weekly
 * report!" -> send_weekly_report. Falls back to `fallback` when the name has
 * nothing usable in it.
 */
export function getTerraformLocalName(
  displayName: string | null | undefined,
  fallback: string,
): string {
  let name: string = toTerraformIdentifier(displayName || "");

  if (name.length > MAX_LOCAL_NAME_LENGTH) {
    const cut: string = name.slice(0, MAX_LOCAL_NAME_LENGTH);
    const lastSeparator: number = cut.lastIndexOf("_");
    name = (lastSeparator > 10 ? cut.slice(0, lastSeparator) : cut).replace(
      /_+$/,
      "",
    );
  }

  return name || toTerraformIdentifier(fallback) || "this";
}

// The resource's short name: `oneuptime_on_call_policy` -> on_call_policy.
export function getTerraformShortTypeName(typeName: string): string {
  return typeName.replace(/^oneuptime_/, "");
}

function apiString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (isJSONObject(value)) {
    if ("value" in value) {
      return apiString(value["value"]);
    }

    if (typeof value["_id"] === "string") {
      return apiString(value["_id"]);
    }
  }

  return null;
}

function apiId(value: unknown): string | null {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }

  if (isJSONObject(value)) {
    for (const key of ["_id", "id"]) {
      const id: unknown = value[key];

      if (typeof id === "string" && id.length > 0) {
        return id;
      }
    }

    if (typeof value["_type"] === "string") {
      return apiString(value["value"]);
    }
  }

  return null;
}

/*
 * A plain-JSON form of an API value, for comparing it with the attribute's
 * default: wrappers unwrapped, ids as strings.
 */
function plainValue(
  descriptor: TerraformAttributeDescriptor,
  value: unknown,
): unknown {
  switch (descriptor.kind) {
    case TerraformValueKind.Bool:
      return typeof value === "boolean" ? value : null;
    case TerraformValueKind.Number:
      return unwrapApiNumber(value);
    case TerraformValueKind.String:
    case TerraformValueKind.DateTime:
      return apiString(value);
    default:
      return value === undefined ? null : value;
  }
}

/*
 * The HCL value of an attribute, or null when it has no value to write (or a
 * value the provider could not read back the same way).
 */
function attributeValueToHcl(data: {
  descriptor: TerraformAttributeDescriptor;
  value: unknown;
  variables: TerraformVariableCollector;
  localName: string;
  resourceLabel: string;
}): HclExpression | null {
  const { descriptor, value } = data;

  switch (descriptor.kind) {
    case TerraformValueKind.String:
    case TerraformValueKind.DateTime: {
      const text: string | null = apiString(value);
      return text === null ? null : Hcl.string(text);
    }
    case TerraformValueKind.Number: {
      const number: number | null = unwrapApiNumber(value);
      return number === null ? null : Hcl.number(number);
    }
    case TerraformValueKind.Bool:
      return typeof value === "boolean" ? Hcl.bool(value) : null;
    case TerraformValueKind.IdSet: {
      if (!Array.isArray(value)) {
        return null;
      }

      const ids: Array<string> = value
        .map(apiId)
        .filter((id: string | null): id is string => {
          return id !== null;
        });

      return ids.length > 0
        ? Hcl.tuple(
            ids.map((id: string): HclExpression => {
              return Hcl.string(id);
            }),
          )
        : null;
    }
    case TerraformValueKind.StringSet: {
      if (!Array.isArray(value)) {
        return null;
      }

      const strings: Array<string> = value
        .map(apiString)
        .filter((item: string | null): item is string => {
          return item !== null;
        });

      return strings.length > 0
        ? Hcl.tuple(
            strings.map((item: string): HclExpression => {
              return Hcl.string(item);
            }),
          )
        : null;
    }
    case TerraformValueKind.Json: {
      /*
       * The provider reads a JSON attribute back from an object only, and
       * reads an object that has its own `_id`, `value` or `_type` as the
       * wrapper it looks like. Anything else would not come back the way it
       * was written, so it is left to the server.
       */
      if (
        !isJSONObject(value) ||
        Object.keys(value).length === 0 ||
        "_id" in value ||
        "value" in value ||
        "_type" in value
      ) {
        return null;
      }

      return jsonencodeWithSecretVariables({
        value,
        variables: data.variables,
        variablePrefix: `${data.localName}_${descriptor.attributeName}`,
        describe: (key: string): string => {
          return `The ${key} in the ${descriptor.title} of ${data.resourceLabel}.`;
        },
      });
    }
    case TerraformValueKind.MonitorSteps:
      return monitorStepsToHcl(value, {
        variables: data.variables,
        variablePrefix: data.localName,
        monitorLabel: data.resourceLabel,
      });
    default:
      return null;
  }
}

function hasValue(
  descriptor: TerraformAttributeDescriptor,
  value: unknown,
): boolean {
  const plain: unknown = plainValue(descriptor, value);

  if (plain === null || plain === undefined) {
    return false;
  }

  if (Array.isArray(plain)) {
    return plain.length > 0;
  }

  if (isJSONObject(plain)) {
    return Object.keys(plain).length > 0;
  }

  return true;
}

function isDefaultValue(
  descriptor: TerraformAttributeDescriptor,
  value: unknown,
): boolean {
  if (descriptor.defaultValue === undefined) {
    return false;
  }

  return isSameJsonValue(
    plainValue(descriptor, value),
    descriptor.defaultValue,
  );
}

function variableBlock(variable: TerraformSecretVariable): HclBodyItem {
  return Hcl.block(
    "variable",
    [variable.name],
    [
      Hcl.attribute("description", Hcl.string(variable.description)),
      Hcl.attribute("type", Hcl.raw("string")),
      Hcl.attribute("sensitive", Hcl.bool(true)),
    ],
  );
}

/*
 * Orders a resource's attributes for reading: its name first, then whatever
 * else must be set, then the rest in the order the model declares them.
 */
function orderAttributes(
  attributes: Array<TerraformAttributeDescriptor>,
  nameColumn: string | null,
): Array<TerraformAttributeDescriptor> {
  const rank: (descriptor: TerraformAttributeDescriptor) => number = (
    descriptor: TerraformAttributeDescriptor,
  ): number => {
    if (descriptor.columnName === nameColumn) {
      return 0;
    }

    return descriptor.isRequired ? 1 : 2;
  };

  return attributes
    .map((descriptor: TerraformAttributeDescriptor, index: number) => {
      return { descriptor, index };
    })
    .sort(
      (
        a: { descriptor: TerraformAttributeDescriptor; index: number },
        b: { descriptor: TerraformAttributeDescriptor; index: number },
      ): number => {
        return rank(a.descriptor) - rank(b.descriptor) || a.index - b.index;
      },
    )
    .map((item: { descriptor: TerraformAttributeDescriptor }) => {
      return item.descriptor;
    });
}

/*
 * One existing resource as Terraform configuration, from its API JSON
 * (BaseModel.toJSON). Null when the model has no Terraform resource.
 */
export function getTerraformResourceConfig(data: {
  modelType: DatabaseBaseModelType;
  // The record's API JSON. Must include `_id`.
  json: Record<string, unknown>;
  // The record's display name; read from the JSON's name column when left out.
  displayName?: string | null | undefined;
}): TerraformResourceConfig | null {
  const typeName: string | null = getTerraformTypeName(data.modelType);
  const attributes: Array<TerraformAttributeDescriptor> =
    getTerraformAttributes(data.modelType);
  const id: string | null = apiId(data.json["_id"]);

  if (!typeName || attributes.length === 0 || !id) {
    return null;
  }

  const nameColumn: string | null = getNameColumn(data.modelType);
  const displayName: string | null =
    data.displayName ?? (nameColumn ? apiString(data.json[nameColumn]) : null);
  const shortTypeName: string = getTerraformShortTypeName(typeName);
  const localName: string = getTerraformLocalName(displayName, shortTypeName);
  const address: string = `${typeName}.${localName}`;
  const noun: string = toSentenceCaseName(
    new data.modelType().singularName || shortTypeName.replace(/_/g, " "),
  );
  const resourceLabel: string = displayName
    ? `${noun} "${displayName}"`
    : `this ${noun}`;

  const variables: TerraformVariableCollector =
    new TerraformVariableCollector();
  const body: Array<HclBodyItem> = [];
  const omittedSecrets: Array<TerraformOmittedAttribute> = [];

  for (const descriptor of orderAttributes(attributes, nameColumn)) {
    const value: unknown = data.json[descriptor.columnName];
    const valuePresent: boolean = hasValue(descriptor, value);

    if (descriptor.kind === TerraformValueKind.Unsupported) {
      continue;
    }

    if (descriptor.secretKind) {
      /*
       * A secret is never read from the API for this page, so its value is
       * unknown here. A required one is read from a variable, so the block
       * still applies; any other is left to the server.
       */
      if (descriptor.isRequired) {
        body.push(
          Hcl.attribute(
            descriptor.attributeName,
            variables.add(
              `${localName}_${descriptor.attributeName}`,
              `The ${descriptor.title} of ${resourceLabel}.`,
            ),
          ),
        );
      } else {
        omittedSecrets.push({
          attributeName: descriptor.attributeName,
          title: descriptor.title,
          reason:
            descriptor.secretKind === TerraformSecretKind.Hashed
              ? TerraformOmissionReason.Hashed
              : TerraformOmissionReason.Secret,
        });
      }

      continue;
    }

    if (!valuePresent) {
      continue;
    }

    const hasDefault: boolean = descriptor.defaultValue !== undefined;

    if (hasDefault && isDefaultValue(descriptor, value)) {
      continue;
    }

    if (!descriptor.isRequired && descriptor.isServerManaged) {
      continue;
    }

    /*
     * Without a default, an attribute that cannot be both created and
     * updated is left to the server: written into configuration, a
     * create-only value the server later moves on would make Terraform
     * replace the whole resource.
     */
    const isWritableBothWays: boolean =
      descriptor.inCreateSchema && descriptor.inUpdateSchema;

    if (!descriptor.isRequired && !hasDefault && !isWritableBothWays) {
      continue;
    }

    const hclValue: HclExpression | null = attributeValueToHcl({
      descriptor,
      value,
      variables,
      localName,
      resourceLabel,
    });

    if (hclValue) {
      body.push(Hcl.attribute(descriptor.attributeName, hclValue));
    }
  }

  if (omittedSecrets.length > 0) {
    body.push(Hcl.blank());
    body.push(
      Hcl.comment(
        `Secrets are not shown here: ${omittedSecrets
          .map((omitted: TerraformOmittedAttribute): string => {
            return omitted.attributeName;
          })
          .join(", ")}.\nTerraform leaves them as they are in OneUptime.`,
      ),
    );
  }

  const resourceItems: Array<HclBodyItem> = [];

  for (const variable of variables.variables) {
    resourceItems.push(variableBlock(variable), Hcl.blank());
  }

  resourceItems.push(Hcl.block("resource", [typeName, localName], body));

  const importItems: Array<HclBodyItem> = [
    Hcl.block(
      "import",
      [],
      [
        Hcl.attribute("to", Hcl.raw(address)),
        Hcl.attribute("id", Hcl.string(id)),
      ],
    ),
  ];

  return {
    typeName,
    localName,
    address,
    resourceHcl: printHclDocument(resourceItems),
    importHcl: printHclDocument(importItems),
    hcl: printHclDocument([...resourceItems, Hcl.blank(), ...importItems]),
    importCommand: `terraform import ${address} ${id}`,
    dataSourceHcl: printHclDocument([
      Hcl.block(
        "data",
        [typeName, localName],
        [Hcl.attribute("id", Hcl.string(id))],
      ),
    ]),
    variables: variables.variables,
    omittedSecrets,
  };
}

// An example value for a required attribute in a starter block.
function getExampleValue(data: {
  descriptor: TerraformAttributeDescriptor;
  singularName: string;
  isNameColumn: boolean;
}): HclExpression {
  const value: unknown = getExampleJsonValue(data);

  if (data.descriptor.kind === TerraformValueKind.Json) {
    return Hcl.call("jsonencode", [jsonToHcl(value)]);
  }

  return jsonToHcl(value);
}

/*
 * A resource block to start a new resource from: its name, what else must be
 * set (with example values to replace), and its description when it has one.
 */
export function getTerraformStarterHcl(data: {
  modelType: DatabaseBaseModelType;
  singularName: string;
  // Example values for attributes, by column name, used instead of the generic ones.
  exampleValues?: Record<string, HclExpression> | undefined;
}): string | null {
  const typeName: string | null = getTerraformTypeName(data.modelType);
  const attributes: Array<TerraformAttributeDescriptor> =
    getTerraformAttributes(data.modelType);

  if (!typeName || attributes.length === 0) {
    return null;
  }

  const nameColumn: string | null = getNameColumn(data.modelType);
  const shortTypeName: string = getTerraformShortTypeName(typeName);
  const variables: TerraformVariableCollector =
    new TerraformVariableCollector();
  const localName: string = `my_${shortTypeName}`;

  const body: Array<HclBodyItem> = [];

  for (const descriptor of orderAttributes(attributes, nameColumn)) {
    const isNameColumn: boolean = descriptor.columnName === nameColumn;
    const isDescription: boolean = descriptor.columnName === "description";

    if (!descriptor.isRequired && !isNameColumn && !isDescription) {
      continue;
    }

    if (descriptor.kind === TerraformValueKind.Unsupported) {
      continue;
    }

    if (descriptor.secretKind) {
      body.push(
        Hcl.attribute(
          descriptor.attributeName,
          variables.add(
            `${localName}_${descriptor.attributeName}`,
            `The ${descriptor.title} of the new ${toSentenceCaseName(data.singularName)}.`,
          ),
        ),
      );
      continue;
    }

    const example: HclExpression | undefined =
      data.exampleValues?.[descriptor.columnName];

    if (isDescription && !example) {
      body.push(
        Hcl.attribute(
          descriptor.attributeName,
          Hcl.string(`Managed with Terraform`),
        ),
      );
      continue;
    }

    body.push(
      Hcl.attribute(
        descriptor.attributeName,
        example ||
          getExampleValue({
            descriptor,
            singularName: data.singularName,
            isNameColumn,
          }),
      ),
    );
  }

  const items: Array<HclBodyItem> = [];

  for (const variable of variables.variables) {
    items.push(variableBlock(variable), Hcl.blank());
  }

  items.push(Hcl.block("resource", [typeName, localName], body));

  return printHclDocument(items);
}

export interface TerraformImportTarget {
  id: string;
  displayName?: string | null | undefined;
}

/*
 * `import` blocks for existing resources, one each, every one with a unique
 * name. With these in a file, `terraform plan -generate-config-out=...`
 * writes the resource blocks itself.
 */
export function getTerraformImportBlocksHcl(data: {
  modelType: DatabaseBaseModelType;
  targets: Array<TerraformImportTarget>;
}): string | null {
  const typeName: string | null = getTerraformTypeName(data.modelType);

  if (!typeName || getTerraformAttributes(data.modelType).length === 0) {
    return null;
  }

  const shortTypeName: string = getTerraformShortTypeName(typeName);
  const usedNames: Set<string> = new Set<string>();
  const items: Array<HclBodyItem> = [];

  for (const target of data.targets) {
    const baseName: string = getTerraformLocalName(
      target.displayName,
      shortTypeName,
    );
    let localName: string = baseName;
    let suffix: number = 2;

    while (usedNames.has(localName)) {
      localName = `${baseName}_${suffix}`;
      suffix++;
    }

    usedNames.add(localName);

    if (items.length > 0) {
      items.push(Hcl.blank());
    }

    items.push(
      Hcl.block(
        "import",
        [],
        [
          Hcl.attribute("to", Hcl.raw(`${typeName}.${localName}`)),
          Hcl.attribute("id", Hcl.string(target.id)),
        ],
      ),
    );
  }

  return items.length > 0 ? printHclDocument(items) : null;
}

// A data source that looks a resource up by name.
export function getTerraformDataSourceByNameHcl(data: {
  modelType: DatabaseBaseModelType;
  exampleName: string;
}): string | null {
  const typeName: string | null = getTerraformTypeName(data.modelType);

  if (!typeName) {
    return null;
  }

  const shortTypeName: string = getTerraformShortTypeName(typeName);

  return printHclDocument([
    Hcl.block(
      "data",
      [typeName, getTerraformLocalName(data.exampleName, shortTypeName)],
      [Hcl.attribute("name", Hcl.string(data.exampleName))],
    ),
  ]);
}
