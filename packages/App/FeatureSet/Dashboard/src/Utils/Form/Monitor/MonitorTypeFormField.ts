import { MonitorTypeHelper } from "Common/Types/Monitor/MonitorType";
import { CardSelectCatalog } from "Common/UI/Components/CardSelect/CardSelect";
import type Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import type SelectFormFields from "Common/UI/Types/SelectEntityField";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import MonitorTypeUtil from "../../MonitorType";

/*
 * The Monitor Type field of every form that offers the whole monitor type
 * catalog: Create Monitor, and a monitor template's create and edit forms.
 *
 * The maintainer, on Create Monitor: "this UI is extremely confusing to use".
 * The picker used to open on a full-width grid of eight large cards under a
 * search box that said "32 to choose from", over eight more category headings
 * each with a count, so the first thing a new user met was a wall of choices.
 *
 * It now opens on the six types most people create (Website, API, Ping,
 * Port, SSL Certificate, Incoming Request - MonitorTypeHelper
 * .getCommonMonitorTypes), as compact rows, two to a line. Every other type
 * is one search, or one "More monitor types" press, away; More shows them
 * under their category headings, with no counts. Once a type is picked the
 * picker shrinks to that type, on one line, with a Change button, so the rest
 * of the step (the name) is right there and the choice reads at a glance.
 *
 * One helper, so the three forms draw the same picker:
 * App/Tests/Dashboard/MonitorTypePickerWiring.test.ts holds each of them to it.
 */

// The question the picker answers.
export const MONITOR_TYPE_FIELD_DESCRIPTION: string = translationKey(
  "What do you want to monitor?",
);

/*
 * The search box's placeholder: the only thing that tells a user the search
 * knows words no card prints (k8s, postgres).
 */
export const MONITOR_TYPE_SEARCH_PLACEHOLDER: string = translationKey(
  "Search monitor types - try ping, ssl, k8s, postgres",
);

// The button that shows every type the common rows leave out.
export const MORE_MONITOR_TYPES_TEXT: string =
  translationKey("More monitor types");

export const MONITOR_TYPE_CATALOG: CardSelectCatalog = {
  commonOptionValues: MonitorTypeHelper.getCommonMonitorTypes(),
  moreOptionsText: MORE_MONITOR_TYPES_TEXT,
};

export interface MonitorTypeFormFieldOptions {
  // The step the field is on, on a stepped form.
  stepId?: string | undefined;
  /*
   * Help in place of the question above. A template says what kind of
   * monitor it produces.
   */
  description?: string | undefined;
}

export type GetMonitorTypeFormFieldFunction = <TEntity>(
  options?: MonitorTypeFormFieldOptions,
) => Field<TEntity>;

export const getMonitorTypeFormField: GetMonitorTypeFormFieldFunction = <
  TEntity,
>(
  options?: MonitorTypeFormFieldOptions,
): Field<TEntity> => {
  return {
    field: { monitorType: true } as unknown as SelectFormFields<TEntity>,
    title: "Monitor Type",
    description: options?.description || MONITOR_TYPE_FIELD_DESCRIPTION,
    stepId: options?.stepId,
    fieldType: FormFieldSchemaType.CardSelect,
    required: true,
    cardSelectOptions:
      MonitorTypeUtil.monitorTypesAsCategorizedCardSelectOptions(),
    cardSelectSearchable: true,
    cardSelectSearchPlaceholder: MONITOR_TYPE_SEARCH_PLACEHOLDER,
    cardSelectCatalog: MONITOR_TYPE_CATALOG,
  };
};

export default getMonitorTypeFormField;
