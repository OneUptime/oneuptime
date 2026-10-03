import type SelectFormFields from "Common/UI/Types/SelectEntityField";
import type Field from "Common/UI/Components/Forms/Types/Field";
import type { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getNameAfterPick } from "Common/UI/Components/Forms/Utils/FollowPickName";
import {
  getCloudEnvironmentNameFromIdentity,
  getNameFromIdentity,
} from "Common/Utils/Telemetry/DiscoveredResourceName";

/*
 * The create forms of resources that telemetry also discovers: hosts,
 * Docker and Podman hosts, Kubernetes clusters, RUM applications,
 * serverless functions and cloud environments.
 *
 * "Make software as simple as possible to use and reduce decision
 * paralysis." These forms used to ask for a Name and an "Identifier" that
 * "should match host.name" - two boxes with near-identical placeholders,
 * so people decided twice and guessed which one the telemetry used.
 * Ingest names every resource it discovers after that identifier anyway
 * (Common/Utils/Telemetry/DiscoveredResourceName). So a form asks only for
 * what the telemetry is matched on, titled after the attribute it must
 * equal - getIdentityFormField - and the name becomes an optional Display
 * Name folded under Advanced - getDisplayNameFormField - that follows the
 * identifier as it is typed, until somebody types a name of their own.
 * Left alone, a resource added by hand is named exactly as a discovered
 * one; the server fills the same name in for an API caller who leaves it
 * out (DiscoveredResourceCreate).
 *
 * The name is made from the identifier, never the other way round: a name
 * is free text, while an identifier that is not exactly what the telemetry
 * reports leaves the resource empty for good.
 *
 * How to use it:
 *
 *   const advancedSection = getAdvancedFormSection<Host>();
 *   formFields: [
 *     getIdentityFormField<Host>({
 *       field: { hostIdentifier: true },
 *       title: "Host Name (host.name)",
 *       description: "...", placeholder: "host-prod-1",
 *     }),
 *     getDisplayNameFormField<Host>({
 *       getDefaultName: getNameFromIdentityField<Host>("hostIdentifier"),
 *       description: "...", placeholder: "...",
 *       collapsibleSection: advancedSection,
 *     }),
 *     { ...descriptionField, collapsibleSection: advancedSection },
 *     getLabelsFormField<Host>({ collapsibleSection: advancedSection }),
 *   ]
 *
 * A resource named after more than one field (a cloud environment: its
 * platform, account and region) gives each of them
 * onChange: followWithDisplayName(...) and hands getDisplayNameFormField
 * the same getDefaultName.
 *
 * Common/Tests/UI/Components/Forms/DiscoveredResourceCreateFormsGuard.test.ts
 * holds every such create form to this shape.
 */

// The column every one of these resources keeps its name in.
export const DISPLAY_NAME_KEY: string = "name";

export type GetDefaultNameFunction<TEntity> = (
  values: FormValues<TEntity>,
) => string;

/**
 * The display name once something it is made from changes: the name made
 * from the new values, while the display name is still the form's own -
 * empty, or the name made from the values before the change. Null when it
 * stays as it is: somebody typed a name of their own, or nothing changed.
 * The rule every name a form fills in follows (Forms/Utils/FollowPickName:
 * a status page resource's display name, a new ingestion key's name), with
 * one addition for a value that is typed rather than picked: emptying the
 * identifier empties a display name that followed it, so the next
 * identifier is followed again.
 */
export const getDisplayNameAfterChange: (data: {
  // The display name the form holds now.
  displayName: unknown;
  // The name made from the values before the change.
  previousName: string;
  // The name made from the values after it.
  nextName: string;
}) => string | null = (data: {
  displayName: unknown;
  previousName: string;
  nextName: string;
}): string | null => {
  const displayName: string =
    typeof data.displayName === "string" ? data.displayName : "";

  if (displayName === data.nextName) {
    return null;
  }

  if (!data.nextName) {
    const isTheFormsOwn: boolean =
      displayName.trim().length === 0 || displayName === data.previousName;

    return isTheFormsOwn ? "" : null;
  }

  return getNameAfterPick({
    name: displayName,
    pickedName: data.nextName,
    filledInNames: [data.previousName],
  });
};

/**
 * A field's onChange that keeps the display name following the name made
 * from the form's values (getDisplayNameAfterChange). fieldKey is the
 * field's own key in the form values, so the name is worked out from the
 * value just typed or picked.
 */
export const followWithDisplayName: <TEntity>(data: {
  fieldKey: string;
  getDefaultName: GetDefaultNameFunction<TEntity>;
}) => (
  value: unknown,
  currentValues: FormValues<TEntity>,
  setNewFormValues: (values: FormValues<TEntity>) => void,
) => void = <TEntity>(data: {
  fieldKey: string;
  getDefaultName: GetDefaultNameFunction<TEntity>;
}): ((
  value: unknown,
  currentValues: FormValues<TEntity>,
  setNewFormValues: (values: FormValues<TEntity>) => void,
) => void) => {
  return (
    value: unknown,
    currentValues: FormValues<TEntity>,
    setNewFormValues: (values: FormValues<TEntity>) => void,
  ): void => {
    const values: Record<string, unknown> = (currentValues || {}) as Record<
      string,
      unknown
    >;

    const displayName: string | null = getDisplayNameAfterChange({
      displayName: values[DISPLAY_NAME_KEY],
      previousName: data.getDefaultName(values as FormValues<TEntity>),
      nextName: data.getDefaultName({
        ...values,
        [data.fieldKey]: value,
      } as FormValues<TEntity>),
    });

    if (displayName === null) {
      return;
    }

    setNewFormValues({
      ...values,
      [DISPLAY_NAME_KEY]: displayName,
    } as FormValues<TEntity>);
  };
};

/**
 * The name of a resource matched by one identifier, read from the form's
 * values: the identifier, without the spaces around it.
 */
export const getNameFromIdentityField: <TEntity>(
  fieldKey: keyof TEntity & string,
) => GetDefaultNameFunction<TEntity> = <TEntity>(
  fieldKey: keyof TEntity & string,
): GetDefaultNameFunction<TEntity> => {
  return (values: FormValues<TEntity>): string => {
    return getNameFromIdentity(
      ((values || {}) as Record<string, unknown>)[fieldKey],
    );
  };
};

export interface IdentityFormFieldOptions<TEntity> {
  // The column the telemetry is matched on: { hostIdentifier: true }, ...
  field: SelectFormFields<TEntity>;
  // Titled after the attribute it must equal: "Host Name (host.name)".
  title: string;
  // Where the value comes from, and that the telemetry is matched by it.
  description: string;
  placeholder: string;
}

/**
 * The one question a discovered resource's create form asks: the value its
 * telemetry is matched on. Required, and the display name follows it.
 */
export const getIdentityFormField: <TEntity>(
  options: IdentityFormFieldOptions<TEntity>,
) => Field<TEntity> = <TEntity>(
  options: IdentityFormFieldOptions<TEntity>,
): Field<TEntity> => {
  const fieldKey: keyof TEntity & string = Object.keys(
    options.field,
  )[0] as keyof TEntity & string;

  return {
    field: options.field,
    title: options.title,
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: options.placeholder,
    description: options.description,
    onChange: followWithDisplayName<TEntity>({
      fieldKey: fieldKey,
      getDefaultName: getNameFromIdentityField<TEntity>(fieldKey),
    }),
  };
};

export interface DisplayNameFormFieldOptions<TEntity> {
  // The name the form fills in: the one a discovered resource gets.
  getDefaultName: GetDefaultNameFunction<TEntity>;
  // That it starts as that name, and that telemetry is not matched by it.
  description: string;
  placeholder: string;
  // The form's Advanced section, which the description and labels fold into.
  collapsibleSection: FormFieldCollapsibleSection<TEntity>;
}

/**
 * The resource's name, as an optional Display Name folded under Advanced.
 * The form fills it in as the identifier is typed (followWithDisplayName);
 * that name is also its default, so the folded section says "Configured"
 * only for a name somebody typed, and a name left as it is - or emptied -
 * is the one ingest would have given.
 */
export const getDisplayNameFormField: <TEntity>(
  options: DisplayNameFormFieldOptions<TEntity>,
) => Field<TEntity> = <TEntity>(
  options: DisplayNameFormFieldOptions<TEntity>,
): Field<TEntity> => {
  return {
    field: { name: true } as unknown as SelectFormFields<TEntity>,
    title: "Display Name",
    fieldType: FormFieldSchemaType.Text,
    required: false,
    placeholder: options.placeholder,
    description: options.description,
    getDefaultValue: options.getDefaultName,
    collapsibleSection: options.collapsibleSection,
  };
};

/*
 * A picked dropdown option can sit in the form values as the option itself
 * ({ label, value }) rather than as its value.
 */
const readPickedValue: (value: unknown) => unknown = (
  value: unknown,
): unknown => {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "value")
  ) {
    return (value as { value: unknown }).value;
  }

  return value;
};

/**
 * The name of a cloud environment, read from the form's values: the one
 * ingest gives it ("AWS ECS · us-east-1 · 123456789012"), once a platform
 * is picked. Empty until then.
 */
export const getCloudEnvironmentNameFromFields: <TEntity>(
  values: FormValues<TEntity>,
) => string = <TEntity>(values: FormValues<TEntity>): string => {
  const fields: Record<string, unknown> = (values || {}) as Record<
    string,
    unknown
  >;

  return getCloudEnvironmentNameFromIdentity({
    cloudPlatform: readPickedValue(fields["cloudPlatform"]),
    cloudAccountId: fields["cloudAccountId"],
    cloudRegion: fields["cloudRegion"],
  });
};
