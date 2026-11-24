import { DatabaseBaseModelType } from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dictionary from "../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../Types/JSON";
import MonitorType from "../../Types/Monitor/MonitorType";
import {
  HclAttributeItem,
  HclBlockItem,
  HclBodyItem,
  HclExpression,
  HclObjectAttribute,
  HclTupleItem,
} from "./Hcl";
import {
  CROSSPLANE_GROUP,
  CROSSPLANE_PROVIDER_CONFIG_API_VERSION,
  CROSSPLANE_RESOURCE_API_VERSION,
  getCrossplaneFieldName,
  getCrossplaneSecretRefFieldName,
  splitCamelCase,
} from "./CrossplaneNames";
import {
  CrossplaneReference,
  getCrossplaneConnectionSecretKeys,
  getCrossplaneKindOf,
  getCrossplaneReferences,
  getCrossplaneSecretFieldOf,
  getProviderAttributeName,
  isCrossplaneSecretField,
} from "./CrossplaneSchema";
import {
  DeveloperDocsExampleContext,
  DeveloperDocsFieldRow,
  DeveloperDocsTerraformBlock,
  getDeveloperDocsTerraformBlock,
  withNameAndDescription,
} from "./ExampleBuilder";
import {
  DeveloperDocsProfile,
  getDeveloperDocsProfile,
} from "./ResourceProfiles";
import {
  getTerraformRecordBody,
  TerraformIdDescriber,
  TerraformImportTarget,
  TerraformOmittedAttribute,
  TerraformRecordAttribute,
  TerraformRecordBody,
} from "./TerraformConfig";
import {
  getTerraformAttributes,
  TerraformAttributeDescriptor,
  TerraformValueKind,
} from "./TerraformSchema";
import { toCanonicalJson, TerraformVariableCollector } from "./TerraformValues";
import {
  printYaml,
  printYamlDocuments,
  Yaml,
  YamlCommentLine,
  YamlDocument,
  YamlListItem,
  YamlMapEntry,
  YamlMapNode,
  YamlNode,
} from "./Yaml";

/*
 * Kubernetes manifests for the dashboard's Developer > Crossplane pages:
 * the provider's package and the ProviderConfig that gives it the API key,
 * one real record written out as a managed resource - which takes the
 * record over by its ID, or only observes it - and the records of a type to
 * observe. A new resource is written from the resource's profile, as the
 * Terraform page's is (ExampleBuilder).
 *
 * A record's manifest sets the fields its Terraform configuration sets
 * (TerraformConfig's getTerraformRecordBody), so the provider - which runs
 * that Terraform provider - finds nothing to change once it has taken the
 * record over. Each is written as the Crossplane provider names it
 * (CrossplaneNames, CrossplaneSchema):
 *
 *   - under spec.forProvider, in lowerCamelCase;
 *   - a value a record starts with and OneUptime then moves on
 *     (ServerOwned.AfterCreate) under spec.initProvider, never forProvider:
 *     the provider creates a record with it and never puts it back (#9985);
 *   - a value only OneUptime writes (ServerOwned.Always) never: the kind
 *     has it in status.atProvider alone;
 *   - a value people set and OneUptime changes too (ServerOwned.Shared,
 *     #10052), such as the labels a label rule adds, is left to OneUptime
 *     in a record's manifest unless the record needs it, as its Terraform
 *     configuration leaves it, and a comment names what was left out. Where
 *     a manifest writes one - a field the record needs, or a new resource's
 *     example - a comment says OneUptime changes it too: the provider sends
 *     the manifest's value when it changes and keeps OneUptime's changes in
 *     between, and of a list it removes only the entries the manifest drops;
 *   - a secret never: one the record needs is read from a Secret of the
 *     namespace (`<field>SecretRef`), and any other is left to OneUptime. A
 *     field with a secret inside that no Secret can stand for (a request
 *     header of a monitor's steps) is left out whole, and the manifest says
 *     so, since writing the rest would drop the secret;
 *   - a value OneUptime makes, such as an ingestion key's secret, is written
 *     by the provider to the Secret spec.writeConnectionSecretToRef names.
 */

// The namespace every manifest is written for, and its ProviderConfig.
export const CROSSPLANE_NAMESPACE: string = "oneuptime";
export const CROSSPLANE_PROVIDER_CONFIG_NAME: string = "default";

// The Secret that holds the project API key, and its key.
export const CROSSPLANE_API_KEY_SECRET_NAME: string = "oneuptime-api-key";
export const CROSSPLANE_API_KEY_SECRET_KEY: string = "api-key";

/*
 * The package every release publishes (release.yml's
 * publish-crossplane-provider), and the Provider that installs it.
 */
export const CROSSPLANE_PACKAGE_REPOSITORY: string =
  "ghcr.io/oneuptime/provider-oneuptime";
export const CROSSPLANE_PROVIDER_NAME: string = "provider-oneuptime";

// The annotation that names the record a managed resource stands for.
export const CROSSPLANE_EXTERNAL_NAME_ANNOTATION: string =
  "crossplane.io/external-name";

// The version every development build reports; it names no release.
const DEVELOPMENT_VERSION: string = "1.0.0";

// Longest Kubernetes name written: a DNS label.
const MAX_OBJECT_NAME_LENGTH: number = 63;

/*
 * A monitor's secret keys, which OneUptime makes for one type of monitor
 * each: written to its connection Secret, so a monitor of another type
 * needs none.
 */
const MONITOR_SECRET_KEYS: Readonly<Record<string, string>> = {
  [MonitorType.Server]: "attribute.server_monitor_secret_key",
  [MonitorType.IncomingRequest]: "attribute.incoming_request_secret_key",
  [MonitorType.IncomingEmail]: "attribute.incoming_email_secret_key",
};

/*
 * The attributes of a monitor's steps the provider reads from a Secret: the
 * ones monitorsteps.go marks Sensitive (CrossplaneConfig.test.ts reads it).
 */
export const MONITOR_STEP_SECRET_ATTRIBUTES: ReadonlyArray<string> = [
  "tls_client_key",
  "tls_client_key_passphrase",
];

/*
 * The attributes of a monitor's steps that are a map of the reader's own
 * keys (a request's headers): written as they are, never in camelCase.
 */
const MONITOR_STEP_DATA_MAPS: ReadonlyArray<string> = ["request_headers"];

/*
 * The package's tag for an installation (release.yml publishes v<version>):
 * the release the server runs, or `v<version>` for a development build,
 * which no package is published for. The docs' Crossplane pages write the
 * same (App's Docs/Utils/Placeholders).
 */
export function getCrossplanePackageTag(
  platformVersion: string | null | undefined,
): string {
  const release: RegExpMatchArray | null = (platformVersion || "")
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)$/);

  if (release) {
    const plain: string = `${release[1]}.${release[2]}.${release[3]}`;

    if (plain !== DEVELOPMENT_VERSION) {
      return `v${plain}`;
    }
  }

  return "v<version>";
}

/*
 * A Kubernetes name for a record, made from its display name: "Checkout
 * API!" is checkout-api, "Café" cafe. Falls back to `fallback` when the name
 * has nothing usable in it (one written in another script).
 */
export function getCrossplaneObjectName(
  displayName: string | null | undefined,
  fallback: string,
): string {
  return (
    toObjectName(displayName || "") || toObjectName(fallback) || "resource"
  );
}

function toObjectName(text: string): string {
  let name: string = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (name.length > MAX_OBJECT_NAME_LENGTH) {
    const cut: string = name.slice(0, MAX_OBJECT_NAME_LENGTH);
    const lastHyphen: number = cut.lastIndexOf("-");
    name = (lastHyphen > 20 ? cut.slice(0, lastHyphen) : cut).replace(
      /-+$/,
      "",
    );
  }

  return name;
}

// A kind as a name: IncidentSeverity is incident-severity.
export function getKindObjectName(kind: string): string {
  return toObjectName(splitCamelCase(kind).join("-"));
}

// `kubectl -n oneuptime get monitor.crossplane.oneuptime.com checkout-api`.
export function getCrossplaneGetCommand(
  kind: string,
  objectName: string,
): string {
  return `kubectl -n ${CROSSPLANE_NAMESPACE} get ${kind.toLowerCase()}.${CROSSPLANE_GROUP} ${objectName}`;
}

// The Provider that installs the package: provider.yaml.
export function getCrossplaneProviderYaml(
  platformVersion: string | null | undefined,
): string {
  return printYaml(
    Yaml.map([
      Yaml.entry("apiVersion", Yaml.string("pkg.crossplane.io/v1")),
      Yaml.entry("kind", Yaml.string("Provider")),
      Yaml.entry(
        "metadata",
        Yaml.map([Yaml.entry("name", Yaml.string(CROSSPLANE_PROVIDER_NAME))]),
      ),
      Yaml.entry(
        "spec",
        Yaml.map([
          Yaml.entry(
            "package",
            Yaml.string(
              `${CROSSPLANE_PACKAGE_REPOSITORY}:${getCrossplanePackageTag(platformVersion)}`,
            ),
          ),
        ]),
      ),
    ]),
  );
}

/*
 * The namespace and the Secret that holds the API key, made with kubectl so
 * the key stays out of every file. It reads the key from the environment
 * variable the other Developer pages export it to.
 */
export function getCrossplaneApiKeySecretCommands(
  apiKeyVariable: string,
): string {
  return [
    `kubectl create namespace ${CROSSPLANE_NAMESPACE}`,
    `kubectl -n ${CROSSPLANE_NAMESPACE} create secret generic ${CROSSPLANE_API_KEY_SECRET_NAME} --from-literal=${CROSSPLANE_API_KEY_SECRET_KEY}="$${apiKeyVariable}"`,
  ].join("\n");
}

/*
 * The ProviderConfig that gives the namespace's resources the API key, and
 * the address of this OneUptime (the provider's url; null leaves it out,
 * and the provider manages OneUptime Cloud).
 */
export function getCrossplaneProviderConfigYaml(
  oneuptimeUrl: string | null,
): string {
  const spec: Array<YamlMapEntry> = [];

  if (oneuptimeUrl) {
    spec.push(Yaml.entry("url", Yaml.string(oneuptimeUrl.replace(/\/+$/, ""))));
  }

  spec.push(
    Yaml.entry(
      "credentials",
      Yaml.map([
        Yaml.entry(
          "secretRef",
          Yaml.map([
            Yaml.entry("name", Yaml.string(CROSSPLANE_API_KEY_SECRET_NAME)),
            Yaml.entry("key", Yaml.string(CROSSPLANE_API_KEY_SECRET_KEY)),
          ]),
        ),
      ]),
    ),
  );

  return printYaml(
    Yaml.map([
      Yaml.entry(
        "apiVersion",
        Yaml.string(CROSSPLANE_PROVIDER_CONFIG_API_VERSION),
      ),
      Yaml.entry("kind", Yaml.string("ProviderConfig")),
      Yaml.entry(
        "metadata",
        Yaml.map([
          Yaml.entry("name", Yaml.string(CROSSPLANE_PROVIDER_CONFIG_NAME)),
          Yaml.entry("namespace", Yaml.string(CROSSPLANE_NAMESPACE)),
        ]),
      ),
      Yaml.entry("spec", Yaml.map(spec)),
    ]),
  );
}

/*
 * The Secret a manifest reads its secrets from, one key per secret: the
 * provider attribute's name, or, for one inside a monitor's steps, the
 * step's ("tls_client_key", "tls_client_key_2" for the next step's).
 */
export interface CrossplaneManifestSecret {
  name: string;
  keys: Array<string>;
}

class SecretKeys {
  public readonly keys: Array<string> = [];

  public add(base: string): string {
    const name: string = base.replace(/[^-._a-zA-Z0-9]+/g, "_") || "secret";
    let key: string = name;
    let suffix: number = 2;

    while (this.keys.includes(key)) {
      key = `${name}_${suffix}`;
      suffix++;
    }

    this.keys.push(key);
    return key;
  }
}

/*
 * `kubectl create secret` for a manifest's Secret, with a placeholder for
 * each value: the secret goes into the cluster, never into a file.
 */
export function getCrossplaneSecretCommand(
  secret: CrossplaneManifestSecret,
): string {
  return [
    `kubectl -n ${CROSSPLANE_NAMESPACE} create secret generic ${secret.name}`,
    ...secret.keys.map((key: string): string => {
      return `  --from-literal=${key}="..."`;
    }),
  ].join(" \\\n");
}

/*
 * How to read a value OneUptime made from the connection Secret, by its key
 * (attribute.secret_key).
 */
export function getCrossplaneConnectionSecretReadCommand(
  secretName: string,
  key: string,
): string {
  return `kubectl -n ${CROSSPLANE_NAMESPACE} get secret ${secretName} -o jsonpath='{.data.${key.replace(/[\\.]/g, "\\$&")}}' | base64 -d`;
}

// What a conversion needs: where secrets go, and what to call them.
interface ConversionContext {
  secretName: string;
  secretKeys: SecretKeys;
  // A variable's name starts with it (the HCL's local name and `_`).
  variablePrefix: string;
}

// The variable a Terraform expression reads, when it is one: `var.x` is x.
function variableName(expression: HclExpression): string | null {
  if (expression.kind !== "raw" || !expression.code.startsWith("var.")) {
    return null;
  }

  return expression.code.slice("var.".length);
}

// A Secret's key for the secret a variable stands for.
function secretKeyFor(context: ConversionContext, variable: string): string {
  return context.secretKeys.add(
    variable.startsWith(context.variablePrefix)
      ? variable.slice(context.variablePrefix.length)
      : variable,
  );
}

// `<field>SecretRef: { name, key }`.
function secretReference(
  context: ConversionContext,
  field: string,
  key: string,
): YamlMapEntry {
  return Yaml.entry(
    field,
    Yaml.map([
      Yaml.entry("name", Yaml.string(context.secretName)),
      Yaml.entry("key", Yaml.string(key)),
    ]),
  );
}

/*
 * The JSON a jsonencode() call writes, or null when a secret is inside it
 * (a variable no manifest can read).
 */
function hclToJson(expression: HclExpression): JSONValue | undefined {
  switch (expression.kind) {
    case "string":
    case "number":
    case "bool":
      return expression.value;
    case "null":
      return null;
    case "tuple": {
      const items: Array<JSONValue> = [];

      for (const item of expression.items) {
        const value: JSONValue | undefined = hclToJson(item.value);

        if (value === undefined) {
          return undefined;
        }

        items.push(value);
      }

      return items;
    }
    case "object": {
      const object: JSONObject = {};

      for (const attribute of expression.attributes) {
        const value: JSONValue | undefined = hclToJson(attribute.value);

        if (value === undefined) {
          return undefined;
        }

        object[attribute.key] = value;
      }

      return object;
    }
    default:
      return undefined;
  }
}

/*
 * A JSON attribute as the kind takes it: a string, written as the provider
 * keeps it (toCanonicalJson, what jsonencode() writes), so it compares
 * equal. Null when a secret is inside.
 */
function jsonString(expression: HclExpression): YamlNode | null {
  if (expression.kind !== "call" || expression.name !== "jsonencode") {
    return null;
  }

  const value: JSONValue | undefined = expression.args[0]
    ? hclToJson(expression.args[0])
    : undefined;

  return value === undefined ? null : Yaml.string(toCanonicalJson(value));
}

/*
 * A list's items. A single item takes the comment Terraform writes after
 * the whole list (`labels = ["..."] # production`).
 */
function listItems(
  items: Array<HclTupleItem>,
  comment: string | undefined,
  convert: (expression: HclExpression) => YamlNode | null,
): Array<YamlListItem> | null {
  const converted: Array<YamlListItem> = [];

  for (const item of items) {
    const value: YamlNode | null = convert(item.value);

    if (!value) {
      return null;
    }

    converted.push({
      value,
      comment: item.comment || (items.length === 1 ? comment : undefined),
    });
  }

  return converted;
}

function scalarOf(expression: HclExpression): YamlNode | null {
  switch (expression.kind) {
    case "string":
    case "number":
    case "bool":
      return Yaml.scalar(expression.value);
    case "null":
      return Yaml.null();
    default:
      return null;
  }
}

/*
 * A monitor's steps (TerraformMonitorSteps' value), as the kind's
 * monitorSteps: each level's attributes in camelCase, a request's headers
 * as they are, a step's TLS key and its passphrase from the manifest's
 * Secret. Null when a secret is anywhere else in them, in a header or in a
 * type's settings, which no Secret can stand for.
 */
function stepValue(
  expression: HclExpression,
  context: ConversionContext,
): YamlNode | null {
  if (expression.kind === "tuple") {
    const items: Array<YamlListItem> | null = listItems(
      expression.items,
      undefined,
      (item: HclExpression): YamlNode | null => {
        return stepValue(item, context);
      },
    );

    return items ? Yaml.list(items) : null;
  }

  if (expression.kind === "call") {
    return jsonString(expression);
  }

  if (expression.kind !== "object") {
    return scalarOf(expression);
  }

  const entries: Array<YamlMapEntry> = [];

  for (const attribute of expression.attributes) {
    const entry: YamlMapEntry | null = stepAttribute(attribute, context);

    if (!entry) {
      return null;
    }

    entries.push(entry);
  }

  return Yaml.map(entries);
}

function stepAttribute(
  attribute: HclObjectAttribute,
  context: ConversionContext,
): YamlMapEntry | null {
  const variable: string | null = variableName(attribute.value);

  if (variable) {
    return MONITOR_STEP_SECRET_ATTRIBUTES.includes(attribute.key)
      ? secretReference(
          context,
          getCrossplaneSecretRefFieldName(attribute.key),
          secretKeyFor(context, variable),
        )
      : null;
  }

  if (
    MONITOR_STEP_DATA_MAPS.includes(attribute.key) &&
    attribute.value.kind === "object"
  ) {
    const headers: Array<YamlMapEntry> = [];

    for (const header of attribute.value.attributes) {
      if (header.value.kind !== "string") {
        return null;
      }

      headers.push(Yaml.entry(header.key, Yaml.string(header.value.value)));
    }

    return Yaml.entry(getCrossplaneFieldName(attribute.key), Yaml.map(headers));
  }

  const value: YamlNode | null = stepValue(attribute.value, context);

  return value
    ? Yaml.entry(
        getCrossplaneFieldName(attribute.key),
        value,
        attribute.comment,
      )
    : null;
}

/*
 * One attribute of a record or a new resource as the kind's field: its
 * value under its camelCase name, or a secret's Secret reference. Null when
 * it is left out for a secret no manifest can carry.
 */
function attributeEntry(data: {
  modelType: DatabaseBaseModelType;
  // The provider attribute, by the name the configuration writes it under.
  attributeName: string;
  descriptor?: TerraformAttributeDescriptor | undefined;
  value: HclExpression;
  comment?: string | undefined;
  context: ConversionContext;
}): YamlMapEntry | null {
  const { descriptor, value, context } = data;
  const attribute: string = getProviderAttributeName(data.attributeName);
  const field: string = getCrossplaneFieldName(attribute);
  const variable: string | null = variableName(value);

  if (variable) {
    // A secret the resource needs: read from the Secret, when the provider can.
    return descriptor && isCrossplaneSecretField(data.modelType, descriptor)
      ? secretReference(
          context,
          getCrossplaneSecretFieldOf(descriptor),
          secretKeyFor(context, variable),
        )
      : null;
  }

  if (value.kind === "call") {
    const json: YamlNode | null = jsonString(value);

    return json ? Yaml.entry(field, json) : null;
  }

  if (value.kind === "tuple") {
    const isSteps: boolean = data.attributeName === "monitor_steps";
    const items: Array<YamlListItem> | null = listItems(
      value.items,
      data.comment,
      (item: HclExpression): YamlNode | null => {
        return isSteps ? stepValue(item, context) : scalarOf(item);
      },
    );

    return items ? Yaml.entry(field, Yaml.list(items)) : null;
  }

  /*
   * A number the configuration gives as text ("5000"), which Terraform
   * reads as the number it is: the kind's field takes a number, and the API
   * server refuses a string.
   */
  if (
    descriptor?.kind === TerraformValueKind.Number &&
    value.kind === "string" &&
    value.value.trim() !== "" &&
    Number.isFinite(Number(value.value))
  ) {
    return Yaml.entry(field, Yaml.number(Number(value.value)), data.comment);
  }

  const scalar: YamlNode | null = scalarOf(value);

  return scalar ? Yaml.entry(field, scalar, data.comment) : null;
}

/*
 * What a manifest's spec says about the record, from its configuration's
 * attributes: forProvider, initProvider (what it starts with), the Secret
 * it reads, and what it leaves out for a secret.
 */
interface CrossplaneSpecFields {
  forProvider: Array<YamlMapEntry>;
  initProvider: Array<YamlMapEntry>;
  secret: CrossplaneManifestSecret | null;
  // Fields left out because a secret no Secret can stand for is in them.
  leftOutForSecrets: Array<string>;
  // The fields written that OneUptime changes too (ServerOwned.Shared).
  shared: Array<CrossplaneSharedField>;
}

// A field people set and OneUptime changes too (ServerOwned.Shared).
export interface CrossplaneSharedField {
  // As the kind names it: labels, alertSeverityId.
  field: string;
  /*
   * A list of IDs or names, which the provider holds to the entries the
   * manifest declares: one OneUptime adds stays.
   */
  isList: boolean;
}

function sharedFieldOf(
  descriptor: TerraformAttributeDescriptor,
): CrossplaneSharedField {
  return {
    field: getCrossplaneFieldName(
      getProviderAttributeName(descriptor.attributeName),
    ),
    isList:
      descriptor.kind === TerraformValueKind.IdSet ||
      descriptor.kind === TerraformValueKind.StringSet,
  };
}

function specFields(data: {
  modelType: DatabaseBaseModelType;
  objectName: string;
  variablePrefix: string;
  attributes: Array<{
    attributeName: string;
    descriptor?: TerraformAttributeDescriptor | undefined;
    value: HclExpression;
    comment?: string | undefined;
  }>;
}): CrossplaneSpecFields {
  const context: ConversionContext = {
    secretName: `${data.objectName}-secrets`,
    secretKeys: new SecretKeys(),
    variablePrefix: data.variablePrefix,
  };
  const fields: CrossplaneSpecFields = {
    forProvider: [],
    initProvider: [],
    secret: null,
    leftOutForSecrets: [],
    shared: [],
  };

  for (const attribute of data.attributes) {
    const entry: YamlMapEntry | null = attributeEntry({
      modelType: data.modelType,
      ...attribute,
      context,
    });

    if (!entry) {
      fields.leftOutForSecrets.push(
        getCrossplaneFieldName(
          getProviderAttributeName(attribute.attributeName),
        ),
      );
      continue;
    }

    // A value a record starts with: given to create it, never compared after.
    if (attribute.descriptor?.startsAtCreate) {
      fields.initProvider.push(entry);
    } else {
      fields.forProvider.push(entry);
    }

    if (attribute.descriptor?.isChangedByOneUptimeToo) {
      fields.shared.push(sharedFieldOf(attribute.descriptor));
    }
  }

  if (context.secretKeys.keys.length > 0) {
    fields.secret = { name: context.secretName, keys: context.secretKeys.keys };
  }

  return fields;
}

/*
 * The keys of a record's connection Secret: the values OneUptime makes for
 * it. A monitor's are its type's only.
 */
function connectionKeysFor(
  modelType: DatabaseBaseModelType,
  monitorType: string | null,
): Array<string> {
  const keys: Array<string> = getCrossplaneConnectionSecretKeys(modelType);

  if (
    keys.some((key: string): boolean => {
      return Object.values(MONITOR_SECRET_KEYS).includes(key);
    })
  ) {
    const key: string | undefined = monitorType
      ? MONITOR_SECRET_KEYS[monitorType]
      : undefined;

    return keys.filter((candidate: string): boolean => {
      return (
        !Object.values(MONITOR_SECRET_KEYS).includes(candidate) ||
        candidate === key
      );
    });
  }

  return keys;
}

// The connection Secret a manifest asks for, and the keys it will hold.
export interface CrossplaneConnectionSecret {
  name: string;
  keys: Array<string>;
}

function resourceDocument(data: {
  kind: string;
  objectName: string;
  externalName?: string | undefined;
  observeOnly?: boolean | undefined;
  connectionSecret?: CrossplaneConnectionSecret | null | undefined;
  initProvider?: Array<YamlMapEntry> | undefined;
  forProvider: Array<YamlMapEntry | YamlCommentLine>;
  comments?: Array<string> | undefined;
}): YamlDocument {
  const metadata: Array<YamlMapEntry> = [
    Yaml.entry("name", Yaml.string(data.objectName)),
    Yaml.entry("namespace", Yaml.string(CROSSPLANE_NAMESPACE)),
  ];

  if (data.externalName) {
    metadata.push(
      Yaml.entry(
        "annotations",
        Yaml.map([
          Yaml.entry(
            CROSSPLANE_EXTERNAL_NAME_ANNOTATION,
            Yaml.string(data.externalName),
          ),
        ]),
      ),
    );
  }

  const spec: Array<YamlMapEntry> = [];

  if (data.observeOnly) {
    spec.push(Yaml.entry("managementPolicies", Yaml.flowList(["Observe"])));
  }

  spec.push(
    Yaml.entry(
      "providerConfigRef",
      Yaml.map([
        Yaml.entry("kind", Yaml.string("ProviderConfig")),
        Yaml.entry("name", Yaml.string(CROSSPLANE_PROVIDER_CONFIG_NAME)),
      ]),
    ),
  );

  if (data.connectionSecret) {
    spec.push(
      Yaml.entry(
        "writeConnectionSecretToRef",
        Yaml.map([Yaml.entry("name", Yaml.string(data.connectionSecret.name))]),
      ),
    );
  }

  if (data.initProvider && data.initProvider.length > 0) {
    spec.push(Yaml.entry("initProvider", Yaml.map(data.initProvider)));
  }

  spec.push(Yaml.entry("forProvider", Yaml.map(data.forProvider)));

  return {
    comments: data.comments,
    body: Yaml.map([
      Yaml.entry("apiVersion", Yaml.string(CROSSPLANE_RESOURCE_API_VERSION)),
      Yaml.entry("kind", Yaml.string(data.kind)),
      Yaml.entry("metadata", Yaml.map(metadata)),
      Yaml.entry("spec", Yaml.map(spec)),
    ]),
  };
}

// The comment lines a manifest ends its forProvider with, about what it left out.
function leftOutComments(data: {
  omittedSecrets: Array<string>;
  leftOutForSecrets: Array<string>;
}): Array<YamlCommentLine> {
  const comments: Array<YamlCommentLine> = [];

  if (data.omittedSecrets.length > 0) {
    comments.push(
      Yaml.comment(
        `Secrets are not shown here: ${data.omittedSecrets.join(", ")}.\nThe provider leaves them as they are in OneUptime.`,
      ),
    );
  }

  if (data.leftOutForSecrets.length > 0) {
    comments.push(
      Yaml.comment(
        `Left out, because a secret is in them that only a value could carry: ${data.leftOutForSecrets.join(", ")}.\nThe provider leaves them as they are in OneUptime.`,
      ),
    );
  }

  return comments;
}

// "a", "a and b", "a, b and c".
function listOfNames(names: Array<string>): string {
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : names.join("");
}

/*
 * The comment lines about the fields OneUptime changes too
 * (ServerOwned.Shared): the ones the manifest writes, whose value the
 * provider sends when the manifest's changes and not otherwise, and the
 * ones it leaves to OneUptime.
 */
function sharedComments(data: {
  written: Array<CrossplaneSharedField>;
  leftOut: Array<string>;
}): Array<YamlCommentLine> {
  const comments: Array<YamlCommentLine> = [];
  const fieldsOf: (lists: boolean) => Array<string> = (
    lists: boolean,
  ): Array<string> => {
    return data.written
      .filter((shared: CrossplaneSharedField): boolean => {
        return shared.isList === lists;
      })
      .map((shared: CrossplaneSharedField): string => {
        return shared.field;
      });
  };
  const values: Array<string> = fieldsOf(false);
  const lists: Array<string> = fieldsOf(true);

  if (values.length === 1) {
    comments.push(
      Yaml.comment(
        `OneUptime changes ${values[0]} too. The provider sends it when you change it here,\nand keeps OneUptime's changes in between.`,
      ),
    );
  } else if (values.length > 1) {
    comments.push(
      Yaml.comment(
        `OneUptime changes these too: ${listOfNames(values)}.\nThe provider sends each when you change it here, and keeps OneUptime's changes in between.`,
      ),
    );
  }

  if (lists.length === 1) {
    comments.push(
      Yaml.comment(
        `OneUptime adds to ${lists[0]} too. The provider removes only the entries you take out here.`,
      ),
    );
  } else if (lists.length > 1) {
    comments.push(
      Yaml.comment(
        `OneUptime adds to these too: ${listOfNames(lists)}.\nThe provider removes only the entries you take out here.`,
      ),
    );
  }

  if (data.leftOut.length === 1) {
    comments.push(
      Yaml.comment(
        `Left to OneUptime, which changes it too: ${data.leftOut[0]}.\nThe provider leaves it as it is. Write it here to manage it from this manifest.`,
      ),
    );
  } else if (data.leftOut.length > 1) {
    comments.push(
      Yaml.comment(
        `Left to OneUptime, which changes them too: ${listOfNames(data.leftOut)}.\nThe provider leaves them as they are. Write one here to manage it from this manifest.`,
      ),
    );
  }

  return comments;
}

// A record's monitor type, for a monitor's connection Secret.
function monitorTypeOf(json: Dictionary<unknown>): string | null {
  const value: unknown = json["monitorType"];

  return typeof value === "string" ? value : null;
}

export interface CrossplaneRecordManifest {
  kind: string;
  // Its Kubernetes name: checkout-api.
  objectName: string;
  // The manifest that takes the record over, by its ID.
  yaml: string;
  // The one that only reads it, and never changes or deletes it.
  observeYaml: string;
  // The Secret the manifest reads its secrets from, to make before it.
  secret: CrossplaneManifestSecret | null;
  // Secrets left as they are in OneUptime, by their fields.
  omittedSecrets: Array<string>;
  // Fields left out because a secret is inside them.
  leftOutForSecrets: Array<string>;
  // The fields it writes that OneUptime changes too: the ones the record needs.
  sharedFields: Array<CrossplaneSharedField>;
  // The ones it leaves to OneUptime, which the record has a value of.
  leftOutShared: Array<string>;
  // The Secret the provider writes the values OneUptime made to.
  connectionSecret: CrossplaneConnectionSecret | null;
  // `kubectl -n oneuptime get monitor.crossplane.oneuptime.com checkout-api`.
  getCommand: string;
}

/*
 * One existing record as a managed resource, from its API JSON
 * (BaseModel.toJSON). Null when the provider has no kind for the model.
 */
export function getCrossplaneRecordManifest(data: {
  modelType: DatabaseBaseModelType;
  // The record's API JSON. Must include `_id`.
  json: Dictionary<unknown>;
  displayName?: string | null | undefined;
  // The names of the records its IDs point at, for a comment after each ID.
  describeId?: TerraformIdDescriber | undefined;
}): CrossplaneRecordManifest | null {
  const kind: string | null = getCrossplaneKindOf(data.modelType);
  const record: TerraformRecordBody | null = getTerraformRecordBody({
    modelType: data.modelType,
    json: data.json,
    displayName: data.displayName,
    describeId: data.describeId,
  });

  if (!kind || !record) {
    return null;
  }

  const objectName: string = getCrossplaneObjectName(
    record.displayName,
    `${getKindObjectName(kind)}-${record.id.slice(0, 8)}`,
  );
  const fields: CrossplaneSpecFields = specFields({
    modelType: data.modelType,
    objectName,
    variablePrefix: `${record.localName}_`,
    attributes: record.attributes.map((attribute: TerraformRecordAttribute) => {
      return {
        attributeName: attribute.descriptor.attributeName,
        descriptor: attribute.descriptor,
        value: attribute.value,
        comment: attribute.comment,
      };
    }),
  });
  const omittedSecrets: Array<string> = record.omittedSecrets.map(
    (omitted: TerraformOmittedAttribute): string => {
      return getCrossplaneFieldName(
        getProviderAttributeName(omitted.attributeName),
      );
    },
  );
  const leftOutShared: Array<string> = record.omittedShared.map(
    (descriptor: TerraformAttributeDescriptor): string => {
      return sharedFieldOf(descriptor).field;
    },
  );
  const connectionKeys: Array<string> = connectionKeysFor(
    data.modelType,
    monitorTypeOf(data.json),
  );
  const connectionSecret: CrossplaneConnectionSecret | null =
    connectionKeys.length > 0
      ? { name: `${objectName}-connection`, keys: connectionKeys }
      : null;

  return {
    kind,
    objectName,
    yaml: printYamlDocuments([
      resourceDocument({
        kind,
        objectName,
        externalName: record.id,
        connectionSecret,
        initProvider: fields.initProvider,
        forProvider: [
          ...fields.forProvider,
          ...sharedComments({ written: fields.shared, leftOut: [] }),
          ...leftOutComments({
            omittedSecrets,
            leftOutForSecrets: fields.leftOutForSecrets,
          }),
          ...sharedComments({ written: [], leftOut: leftOutShared }),
        ],
      }),
    ]),
    observeYaml: printYamlDocuments([
      resourceDocument({
        kind,
        objectName,
        externalName: record.id,
        observeOnly: true,
        forProvider: [],
      }),
    ]),
    secret: fields.secret,
    omittedSecrets,
    leftOutForSecrets: fields.leftOutForSecrets,
    sharedFields: fields.shared,
    leftOutShared,
    connectionSecret,
    getCommand: getCrossplaneGetCommand(kind, objectName),
  };
}

export interface CrossplaneCreateExample {
  kind: string;
  objectName: string;
  yaml: string;
  // What each field is for, by its field.
  rows: Array<DeveloperDocsFieldRow>;
  secret: CrossplaneManifestSecret | null;
  leftOutForSecrets: Array<string>;
  // The fields it writes that OneUptime changes too.
  sharedFields: Array<CrossplaneSharedField>;
  connectionSecret: CrossplaneConnectionSecret | null;
  // The example's IDs written as references instead, by Kubernetes name.
  referencesYaml: string | null;
  isPlaceholder: boolean;
  usesProjectData: boolean;
  getCommand: string;
}

/*
 * The descriptor a configuration's attribute is of, by the name it writes:
 * none for a person's email address (user_email beside user_id), which is
 * an attribute of its own.
 */
function descriptorsByAttribute(
  modelType: DatabaseBaseModelType,
): Dictionary<TerraformAttributeDescriptor> {
  const byAttribute: Dictionary<TerraformAttributeDescriptor> = {};

  for (const descriptor of getTerraformAttributes(modelType)) {
    byAttribute[descriptor.attributeName] = descriptor;
    byAttribute[getProviderAttributeName(descriptor.attributeName)] =
      descriptor;
  }

  return byAttribute;
}

/*
 * The example's IDs as references to the resources of the same namespace
 * that stand for their records, by the names those records would have
 * there: `incidentSeverityIdRef: {name: critical-incident}`. Null when none
 * of its fields takes one.
 */
function referencesYaml(data: {
  modelType: DatabaseBaseModelType;
  attributes: Array<HclAttributeItem>;
}): string | null {
  const references: Array<CrossplaneReference> = getCrossplaneReferences(
    data.modelType,
  );
  const entries: Array<YamlMapEntry> = [];

  for (const attribute of data.attributes) {
    const reference: CrossplaneReference | undefined = references.find(
      (candidate: CrossplaneReference): boolean => {
        return candidate.descriptor.attributeName === attribute.name;
      },
    );

    if (!reference) {
      continue;
    }

    const names: Array<string> =
      attribute.value.kind === "tuple"
        ? attribute.value.items.map(
            (item: HclTupleItem, index: number): string => {
              const name: string | undefined =
                item.comment ||
                (attribute.value.kind === "tuple" &&
                attribute.value.items.length === 1
                  ? attribute.comment
                  : undefined);

              return getCrossplaneObjectName(
                name,
                `${getKindObjectName(reference.targetKind)}-${index + 1}`,
              );
            },
          )
        : [
            getCrossplaneObjectName(
              attribute.comment,
              getKindObjectName(reference.targetKind),
            ),
          ];

    const named: (name: string) => YamlMapNode = (
      name: string,
    ): YamlMapNode => {
      return Yaml.map([Yaml.entry("name", Yaml.string(name))]);
    };

    entries.push(
      Yaml.entry(
        reference.referenceField,
        reference.isList
          ? Yaml.list(names.map(named))
          : named(names[0] as string),
      ),
    );
  }

  if (entries.length === 0) {
    return null;
  }

  return printYaml(
    Yaml.map([
      Yaml.entry(
        "spec",
        Yaml.map([Yaml.entry("forProvider", Yaml.map(entries))]),
      ),
    ]),
  );
}

/*
 * A new resource of this type as a manifest: the fields most people set,
 * filled in from the project, as the Terraform page's example sets them.
 * Null when the provider cannot create it.
 */
export function getCrossplaneCreateExample(data: {
  modelType: DatabaseBaseModelType;
  context: DeveloperDocsExampleContext;
}): CrossplaneCreateExample | null {
  const kind: string | null = getCrossplaneKindOf(data.modelType);
  const profile: DeveloperDocsProfile = getDeveloperDocsProfile(data.modelType);

  if (!kind || profile.terraformCannotCreate) {
    return null;
  }

  const block: DeveloperDocsTerraformBlock = getDeveloperDocsTerraformBlock({
    modelType: data.modelType,
    fields: withNameAndDescription(data.modelType, profile, "Crossplane"),
    context: data.context,
    variables: new TerraformVariableCollector(),
  });
  const resource: HclBlockItem = block.items.find(
    (item: HclBodyItem): boolean => {
      return item.kind === "block";
    },
  ) as HclBlockItem;
  const attributes: Array<HclAttributeItem> = resource.body.filter(
    (item: HclBodyItem): item is HclAttributeItem => {
      return item.kind === "attribute";
    },
  );
  const byAttribute: Dictionary<TerraformAttributeDescriptor> =
    descriptorsByAttribute(data.modelType);
  const objectName: string = getCrossplaneObjectName(
    block.localName.replace(/_/g, "-"),
    getKindObjectName(kind),
  );
  const fields: CrossplaneSpecFields = specFields({
    modelType: data.modelType,
    objectName,
    variablePrefix: `${block.localName}_`,
    attributes: attributes.map((attribute: HclAttributeItem) => {
      return {
        attributeName: attribute.name,
        descriptor: byAttribute[attribute.name],
        value: attribute.value,
        comment: attribute.comment,
      };
    }),
  });
  const monitorType: HclAttributeItem | undefined = attributes.find(
    (attribute: HclAttributeItem): boolean => {
      return attribute.name === "monitor_type";
    },
  );
  const connectionKeys: Array<string> = connectionKeysFor(
    data.modelType,
    monitorType?.value.kind === "string" ? monitorType.value.value : null,
  );
  const connectionSecret: CrossplaneConnectionSecret | null =
    connectionKeys.length > 0
      ? { name: `${objectName}-connection`, keys: connectionKeys }
      : null;

  return {
    kind,
    objectName,
    yaml: printYamlDocuments([
      resourceDocument({
        kind,
        objectName,
        connectionSecret,
        initProvider: fields.initProvider,
        forProvider: [
          ...fields.forProvider,
          ...sharedComments({ written: fields.shared, leftOut: [] }),
          ...leftOutComments({
            omittedSecrets: [],
            leftOutForSecrets: fields.leftOutForSecrets,
          }),
        ],
      }),
    ]),
    rows: block.rows.map(
      (row: DeveloperDocsFieldRow): DeveloperDocsFieldRow => {
        const descriptor: TerraformAttributeDescriptor | undefined =
          byAttribute[row.name];
        const shared: CrossplaneSharedField | null =
          descriptor?.isChangedByOneUptimeToo
            ? sharedFieldOf(descriptor)
            : null;

        return {
          ...row,
          name:
            descriptor && isCrossplaneSecretField(data.modelType, descriptor)
              ? getCrossplaneSecretFieldOf(descriptor)
              : getCrossplaneFieldName(getProviderAttributeName(row.name)),
          // A field OneUptime changes too says so, as the manifest does.
          about: shared
            ? `${row.about} ${shared.isList ? "OneUptime may add to it too." : "OneUptime may change it too."}`
            : row.about,
        };
      },
    ),
    secret: fields.secret,
    leftOutForSecrets: fields.leftOutForSecrets,
    sharedFields: fields.shared,
    connectionSecret,
    referencesYaml: referencesYaml({ modelType: data.modelType, attributes }),
    isPlaceholder: block.isPlaceholder,
    usesProjectData: block.usesProjectData,
    getCommand: getCrossplaneGetCommand(kind, objectName),
  };
}

/*
 * A manifest that observes each existing record, by its ID, every one with
 * a name of its own: the provider reads them and never changes or deletes
 * them. Null when the provider has no kind for the model, or there are none.
 */
export function getCrossplaneObserveManifests(data: {
  modelType: DatabaseBaseModelType;
  targets: Array<TerraformImportTarget>;
}): string | null {
  const kind: string | null = getCrossplaneKindOf(data.modelType);

  if (!kind || data.targets.length === 0) {
    return null;
  }

  const used: Set<string> = new Set<string>();

  return printYamlDocuments(
    data.targets.map((target: TerraformImportTarget): YamlDocument => {
      const base: string = getCrossplaneObjectName(
        target.displayName,
        `${getKindObjectName(kind)}-${target.id.slice(0, 8)}`,
      );
      let objectName: string = base;
      let suffix: number = 2;

      while (used.has(objectName)) {
        objectName = `${base}-${suffix}`;
        suffix++;
      }

      used.add(objectName);

      return resourceDocument({
        kind,
        objectName,
        externalName: target.id,
        observeOnly: true,
        forProvider: [],
      });
    }),
  );
}
