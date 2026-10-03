import Field from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";

/*
 * Nobody creates a rule in order to have it switched off.
 *
 * A rule starts on: its isEnabled column defaults to true, which is what the
 * API stores when the field is left out. Asking "Enabled?" on the create form
 * was one more decision nobody needed to make, and the form even answered it
 * wrongly - every rule created from the dashboard was saved switched off
 * (Forms/Utils/CreateFormDefaults says why). So a rule's create form leaves
 * the switch out, and the rule starts on. The switch stays where it is
 * useful: on the rule's edit form, and as its table's Status column.
 *
 * RuleTable - and LabelRuleTable, which is built on it - does this for every
 * rule page it draws. A rule page built on ModelTable directly marks its
 * Enabled field doNotShowWhenCreating itself. CreateFormDefaultsGuard holds
 * both to it.
 */
export const RULE_ENABLED_COLUMN: string = "isEnabled";

const SWITCH_FIELD_TYPES: ReadonlySet<FormFieldSchemaType | undefined> =
  new Set<FormFieldSchemaType | undefined>([
    FormFieldSchemaType.Toggle,
    FormFieldSchemaType.Checkbox,
  ]);

// The switch a rule is turned on and off with.
export function isRuleEnabledField<TEntity>(field: Field<TEntity>): boolean {
  return (
    !field.overrideFieldKey &&
    Object.keys(field.field || {})[0] === RULE_ENABLED_COLUMN &&
    SWITCH_FIELD_TYPES.has(field.fieldType)
  );
}

/**
 * A rule's form fields with its Enabled switch on the edit form only. Every
 * other field is handed back as it was (the same object).
 */
export function withRuleEnabledOnEditOnly<TEntity>(
  fields: Array<Field<TEntity>>,
): Array<Field<TEntity>> {
  return fields.map((field: Field<TEntity>): Field<TEntity> => {
    if (!isRuleEnabledField(field) || field.doNotShowWhenCreating) {
      return field;
    }

    return { ...field, doNotShowWhenCreating: true };
  });
}
