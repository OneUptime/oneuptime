import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../Types/Dictionary";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import {
  getCrossplaneFieldName,
  getCrossplaneKind,
  getCrossplaneReferenceFieldName,
  getCrossplaneSecretRefFieldName,
  getCrossplaneSelectorFieldName,
} from "./CrossplaneNames";
import {
  getTerraformAttributes,
  getTerraformProviderAttributeName,
  getTerraformTypeName,
  isModelInPublicApi,
  toTerraformSnakeCase,
  TerraformAttributeDescriptor,
  TerraformValueKind,
} from "./TerraformSchema";

/*
 * What the OneUptime Crossplane provider makes of a model, worked out in the
 * browser from the same metadata the Terraform provider - and so the
 * Crossplane provider, which Upjet generates from it - is made from: its
 * kind, each attribute's field, the fields that take a reference, the
 * secrets a manifest gives from a Secret, and the ones OneUptime makes,
 * which the provider writes to the resource's connection Secret.
 *
 * Common/Tests/Utils/DeveloperDocs/CrossplaneProviderContract.test.ts runs
 * the real spec through the real generators (the Terraform provider's
 * OpenAPIParser, the Crossplane provider's collectReferences) and holds this
 * file to them, for every resource.
 */

// The encrypted column types the spec marks secret (ModelSchema's).
const ENCRYPTED_SECRET_COLUMN_TYPES: ReadonlyArray<TableColumnType> = [
  TableColumnType.ShortText,
  TableColumnType.LongText,
  TableColumnType.VeryLongText,
];

/*
 * Whether the provider marks a column's attribute sensitive: the spec says
 * x-oneuptime-secret for it (ModelSchema.isSecretColumn, rule for rule). A
 * sensitive attribute a manifest gives is read from a Secret
 * (`<field>SecretRef`); one only OneUptime writes is left out of the kind
 * and written to its connection Secret. TerraformSchema's secretKind is
 * wider - it also keeps what is named like a secret off the page - and an
 * attribute only it calls a secret is an ordinary field of the kind.
 */
export function isCrossplaneSensitiveColumn(
  column: TableColumnMetadata,
): boolean {
  return (
    Boolean(column.secret) ||
    column.type === TableColumnType.HashedString ||
    column.type === TableColumnType.Password ||
    Boolean(
      column.encrypted && ENCRYPTED_SECRET_COLUMN_TYPES.includes(column.type),
    )
  );
}

/*
 * The attribute's name in the provider, which is the dashboard's
 * (TerraformAttributeDescriptor.attributeName) unless Terraform reserves it:
 * the Terraform provider exposes such an attribute with `_value` added, and
 * so does the Crossplane provider made from it - a cloud account's
 * `provider` is `providerValue`.
 */
export function getProviderAttributeName(attributeName: string): string {
  return getTerraformProviderAttributeName(attributeName);
}

/*
 * The kind of a model's managed resource, or null when the provider has
 * none: a model with no Terraform resource has no kind either.
 */
export function getCrossplaneKindOf(
  modelType: DatabaseBaseModelType,
): string | null {
  const typeName: string | null = getTerraformTypeName(modelType);

  if (!typeName || getTerraformAttributes(modelType).length === 0) {
    return null;
  }

  return getCrossplaneKind(typeName);
}

// The field of an attribute under spec.forProvider: isEnabled is isEnabled.
export function getCrossplaneFieldOf(
  descriptor: TerraformAttributeDescriptor,
): string {
  return getCrossplaneFieldName(
    getProviderAttributeName(descriptor.attributeName),
  );
}

// The column of a model, by its name.
function getColumn(
  modelType: DatabaseBaseModelType,
  columnName: string,
): TableColumnMetadata | undefined {
  return getTableColumns(new modelType())[columnName];
}

/*
 * Whether the provider reads an attribute from a Secret: a sensitive
 * attribute a manifest gives (`<field>SecretRef`).
 */
export function isCrossplaneSecretField(
  modelType: DatabaseBaseModelType,
  descriptor: TerraformAttributeDescriptor,
): boolean {
  const column: TableColumnMetadata | undefined = getColumn(
    modelType,
    descriptor.columnName,
  );

  return Boolean(column && isCrossplaneSensitiveColumn(column));
}

// The field that names the Secret it is read from: tlsClientKeySecretRef.
export function getCrossplaneSecretFieldOf(
  descriptor: TerraformAttributeDescriptor,
): string {
  return getCrossplaneSecretRefFieldName(
    getProviderAttributeName(descriptor.attributeName),
  );
}

/*
 * A field that holds the ID of another resource, which a manifest can also
 * give as a reference to that resource's managed resource.
 */
export interface CrossplaneReference {
  descriptor: TerraformAttributeDescriptor;
  // monitorStatusId, labels.
  field: string;
  // monitorStatusIdRef, labelsRefs.
  referenceField: string;
  // monitorStatusIdSelector, labelsSelector.
  selectorField: string;
  // Whether it holds a list of IDs, so its reference is a list too.
  isList: boolean;
  // The model it points at, and that model's kind.
  targetModelType: DatabaseBaseModelType;
  targetKind: string;
}

/*
 * The fields of a model's kind that take a reference, as the generator
 * gives them one (Scripts/CrossplaneProvider/Core/References.ts): an ID, or
 * a list of IDs, of a model the provider has a resource for. A field that
 * points at a record with no resource - a person, a scan - takes the ID
 * only.
 */
export function getCrossplaneReferences(
  modelType: DatabaseBaseModelType,
): Array<CrossplaneReference> {
  const references: Array<CrossplaneReference> = [];

  for (const descriptor of getTerraformAttributes(modelType)) {
    const target: DatabaseBaseModelType | undefined =
      descriptor.relatedModelType;

    if (
      !target ||
      (descriptor.kind !== TerraformValueKind.String &&
        descriptor.kind !== TerraformValueKind.IdSet)
    ) {
      continue;
    }

    const targetKind: string | null = getCrossplaneKindOf(target);

    if (!targetKind) {
      continue;
    }

    const attribute: string = getProviderAttributeName(
      descriptor.attributeName,
    );
    const isList: boolean = descriptor.kind === TerraformValueKind.IdSet;

    references.push({
      descriptor,
      field: getCrossplaneFieldName(attribute),
      referenceField: getCrossplaneReferenceFieldName(attribute, isList),
      selectorField: getCrossplaneSelectorFieldName(attribute),
      isList,
      targetModelType: target,
      targetKind,
    });
  }

  return references;
}

/*
 * The values OneUptime makes for a record and the provider never puts in
 * the resource - a telemetry ingestion key's secret, an API key - by the
 * key each has in the connection Secret `writeConnectionSecretToRef` names:
 * `attribute.` and the attribute's name (attribute.secret_key). A
 * sensitive attribute only OneUptime writes is dropped from the kind's
 * status, and Upjet writes it to that Secret instead. Empty for a model with
 * none, whose manifest needs no connection Secret.
 */
export function getCrossplaneConnectionSecretKeys(
  modelType: DatabaseBaseModelType,
): Array<string> {
  if (!getCrossplaneKindOf(modelType) || !isModelInPublicApi(modelType)) {
    return [];
  }

  const model: DatabaseBaseModel = new modelType();
  const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
  const accessControlByColumn: Dictionary<ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();
  const settable: Set<string> = new Set<string>(
    getTerraformAttributes(modelType).map(
      (descriptor: TerraformAttributeDescriptor): string => {
        return descriptor.columnName;
      },
    ),
  );
  const keys: Array<string> = [];

  for (const columnName of Object.keys(columns)) {
    const column: TableColumnMetadata | undefined = columns[columnName];

    if (
      !column ||
      settable.has(columnName) ||
      column.hideColumnInDocumentation ||
      column.type === TableColumnType.Entity ||
      !isCrossplaneSensitiveColumn(column)
    ) {
      continue;
    }

    /*
     * No manifest writes it, so it is OneUptime's: it reaches the provider
     * when a read answers it to someone, or when the create answers it once
     * (shownOnce), as a project API key's.
     */
    const accessControl: ColumnAccessControl | undefined =
      accessControlByColumn[columnName];
    const isRead: boolean =
      !accessControl ||
      Boolean(accessControl.read && accessControl.read.length > 0) ||
      Boolean(column.shownOnce);

    if (isRead) {
      keys.push(
        `attribute.${getProviderAttributeName(toTerraformSnakeCase(columnName))}`,
      );
    }
  }

  return keys;
}
