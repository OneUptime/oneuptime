import {
  DESCRIPTION_FIELD_PLACEHOLDER,
  DESCRIPTION_FIELD_TITLE,
  NAME_FIELD_PLACEHOLDER,
  NAME_FIELD_TITLE,
  SCHEDULE_FIELD_DESCRIPTION,
  SCHEDULE_FIELD_TITLE,
  SCHEDULE_LABELS,
  SCHEDULE_STEP_TITLE,
  SEARCH_FIELD_DESCRIPTION,
  SEARCH_FIELD_PLACEHOLDER,
  SEARCH_FIELD_TITLE,
  SEARCH_OVER_FIELD_DESCRIPTION,
  SEARCH_OVER_FIELD_TITLE,
  SEARCH_STEP_TITLE,
  TELL_ADD_BUTTON_TEXT,
  TELL_FIELD_DESCRIPTION,
  TELL_FIELD_TITLE,
} from "./HuntsCopy";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_SECURITY_HUNT_TIME_RANGE,
  SECURITY_HUNT_MESSAGES,
  SECURITY_HUNT_SCHEDULES,
  SECURITY_HUNT_TIME_RANGES,
  SecurityHuntField,
  SecurityHuntProblem,
  SecurityHuntSchedule,
  countSecurityHuntFilterValues,
  getSecurityHuntProblems,
  isScheduledSecurityHunt,
  readSecurityHuntFilters,
} from "Common/Types/SecurityEvent/SecurityHunt";
import TimeRange from "Common/Types/Time/TimeRange";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  toPeoplePickerIds,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE HUNT FORMS: Create Hunt and a hunt's Edit (Security Events > Hunts),
 * and Save as Hunt on Events.
 *
 * Two steps, as a hunt is two questions: what it searches for (its name,
 * its search and how far back it looks, a description under More fields),
 * and whether it runs on its own (its schedule, and - once it has one -
 * who it tells). A new hunt is not scheduled: most saved searches are
 * opened by hand, and a schedule tells people things, so it is chosen.
 * Choosing one asks who to tell, starting with the person saving it.
 *
 * Save as Hunt saves the search on screen, so it asks only for the name,
 * the schedule and who to tell, on one page (getSaveAsHuntFormFields); a
 * description is added with Edit, on the hunt's page.
 *
 * Each field shows the shared rules' problem with it, in the reader's
 * language (getSecurityHuntProblems): the API checks the same rules.
 */

export const HUNT_FORM_STEPS: Array<FormStep<SecurityHunt>> = [
  { title: SEARCH_STEP_TITLE, id: "search" },
  { title: SCHEDULE_STEP_TITLE, id: "schedule" },
];

// The field the Tell picker names itself by: no column, its picks are notifyUsers and notifyTeams.
export const HUNT_TELL_FIELD_KEY: string = "tell";

const moreFieldsSection: FormFieldCollapsibleSection<SecurityHunt> =
  getAdvancedFormSection<SecurityHunt>({ id: "hunt-more-fields" });

export function getHuntScheduleDropdownOptions(): Array<DropdownOption> {
  return SECURITY_HUNT_SCHEDULES.map(
    (schedule: SecurityHuntSchedule): DropdownOption => {
      return { label: SCHEDULE_LABELS[schedule], value: schedule };
    },
  );
}

export function getHuntTimeRangeDropdownOptions(): Array<DropdownOption> {
  return SECURITY_HUNT_TIME_RANGES.map((range: TimeRange): DropdownOption => {
    return { label: range, value: range };
  });
}

// People first, then teams, as the Owners picker lists them.
export function getHuntTellPickerConfig(): PeoplePickerFieldConfig {
  return {
    kinds: [
      { kind: PeoplePickerKind.User, valueKey: "notifyUsers" },
      { kind: PeoplePickerKind.Team, valueKey: "notifyTeams" },
    ],
    addButtonText: TELL_ADD_BUTTON_TEXT,
    searchPlaceholder: "Search people or teams...",
    emptyText: "No people or teams available.",
  };
}

function readValues(values: FormValues<SecurityHunt>): Record<string, unknown> {
  return values as Record<string, unknown>;
}

// Whether the form's hunt runs on its own.
export function isHuntFormScheduled(values: FormValues<SecurityHunt>): boolean {
  return isScheduledSecurityHunt(readValues(values)["schedule"] as string);
}

// How many people and teams the form's Tell picker holds.
export function countHuntFormRecipients(
  values: FormValues<SecurityHunt>,
): number {
  const data: Record<string, unknown> = readValues(values);

  return (
    toPeoplePickerIds(data["notifyUsers"]).length +
    toPeoplePickerIds(data["notifyTeams"]).length
  );
}

/*
 * Whether the form's hunt keeps filters beside its search: a hunt saved
 * from Events with sidebar chips. Its search may then be empty.
 */
export function hasHuntFormFilters(values: FormValues<SecurityHunt>): boolean {
  return (
    countSecurityHuntFilterValues(
      readSecurityHuntFilters(readValues(values)["filters"]),
    ) > 0
  );
}

// A search is needed unless the hunt searches with filters alone.
export function isHuntFormSearchRequired(
  values: FormValues<SecurityHunt>,
): boolean {
  return !hasHuntFormFilters(values);
}

// The shared rules' problem with one field, in the reader's language.
export function getHuntFieldProblem(data: {
  translator: Translator;
  field: SecurityHuntField;
}): (values: FormValues<SecurityHunt>) => string | null {
  return (values: FormValues<SecurityHunt>): string | null => {
    const form: Record<string, unknown> = readValues(values);

    const problem: string | undefined = getSecurityHuntProblems({
      name: form["name"] as string | undefined,
      description: form["description"] as string | undefined,
      searchQuery: form["searchQuery"] as string | undefined,
      filters: readSecurityHuntFilters(form["filters"]),
    }).find((item: SecurityHuntProblem): boolean => {
      return item.field === data.field;
    })?.message;

    return problem ? data.translator.translateText(problem) || problem : null;
  };
}

// A scheduled hunt tells somebody: said under Tell, in the reader's language.
export function getHuntTellProblem(
  translator: Translator,
): (values: FormValues<SecurityHunt>) => string | null {
  return (values: FormValues<SecurityHunt>): string | null => {
    if (!isHuntFormScheduled(values) || countHuntFormRecipients(values) > 0) {
      return null;
    }

    const message: string = SECURITY_HUNT_MESSAGES.chooseRecipients.message;

    return translator.translateText(message) || message;
  };
}

/*
 * Create Hunt and Edit: the search step, then the schedule step. The
 * hunt's filters - chips it was saved from Events with - are never shown
 * (they are changed on the hunt's page, on the Events explorer), but read,
 * so the form knows whether the search may be empty.
 */
export function getHuntFormFields(data: {
  translator: Translator;
}): Array<ModelField<SecurityHunt>> {
  return [
    {
      field: { name: true },
      stepId: "search",
      title: NAME_FIELD_TITLE,
      fieldType: FormFieldSchemaType.Text,
      placeholder: NAME_FIELD_PLACEHOLDER,
      required: true,
      customValidation: getHuntFieldProblem({
        translator: data.translator,
        field: "name",
      }),
      dataTestId: "hunt-name",
    },
    {
      field: { searchQuery: true },
      stepId: "search",
      title: SEARCH_FIELD_TITLE,
      description: SEARCH_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Text,
      placeholder: SEARCH_FIELD_PLACEHOLDER,
      required: isHuntFormSearchRequired,
      customValidation: getHuntFieldProblem({
        translator: data.translator,
        field: "searchQuery",
      }),
      disableSpellCheck: true,
      dataTestId: "hunt-search",
    },
    {
      field: { filters: true },
      stepId: "search",
      title: "Filters",
      fieldType: FormFieldSchemaType.JSON,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: { timeRange: true },
      stepId: "search",
      title: SEARCH_OVER_FIELD_TITLE,
      description: SEARCH_OVER_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getHuntTimeRangeDropdownOptions(),
      required: true,
      dataTestId: "hunt-time-range",
    },
    {
      field: { description: true },
      stepId: "search",
      title: DESCRIPTION_FIELD_TITLE,
      fieldType: FormFieldSchemaType.LongText,
      placeholder: DESCRIPTION_FIELD_PLACEHOLDER,
      required: false,
      customValidation: getHuntFieldProblem({
        translator: data.translator,
        field: "description",
      }),
      collapsibleSection: moreFieldsSection,
    },
    {
      field: { schedule: true },
      stepId: "schedule",
      title: SCHEDULE_FIELD_TITLE,
      description: SCHEDULE_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getHuntScheduleDropdownOptions(),
      required: true,
      dataTestId: "hunt-schedule",
    },
    {
      field: {
        [HUNT_TELL_FIELD_KEY]: true,
      } as unknown as SelectFormFields<SecurityHunt>,
      stepId: "schedule",
      title: TELL_FIELD_TITLE,
      description: TELL_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.PeoplePicker,
      peoplePicker: getHuntTellPickerConfig(),
      formOnly: true,
      showIf: isHuntFormScheduled,
      required: isHuntFormScheduled,
      customValidation: getHuntTellProblem(data.translator),
      dataTestId: "hunt-tell",
    },
  ];
}

/*
 * Save as Hunt, on Events: the search is the page's, so the dialog asks for
 * the name, whether it runs on a schedule and who it tells - one page.
 */
export function getSaveAsHuntFormFields(data: {
  translator: Translator;
}): Array<ModelField<SecurityHunt>> {
  return [
    {
      field: { name: true },
      title: NAME_FIELD_TITLE,
      fieldType: FormFieldSchemaType.Text,
      placeholder: NAME_FIELD_PLACEHOLDER,
      required: true,
      customValidation: getHuntFieldProblem({
        translator: data.translator,
        field: "name",
      }),
      dataTestId: "hunt-name",
    },
    {
      field: { schedule: true },
      title: SCHEDULE_FIELD_TITLE,
      description: SCHEDULE_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getHuntScheduleDropdownOptions(),
      required: true,
      dataTestId: "hunt-schedule",
    },
    {
      field: {
        [HUNT_TELL_FIELD_KEY]: true,
      } as unknown as SelectFormFields<SecurityHunt>,
      title: TELL_FIELD_TITLE,
      description: TELL_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.PeoplePicker,
      peoplePicker: getHuntTellPickerConfig(),
      formOnly: true,
      showIf: isHuntFormScheduled,
      required: isHuntFormScheduled,
      customValidation: getHuntTellProblem(data.translator),
      dataTestId: "hunt-tell",
    },
  ];
}

// A new hunt's starting values: not scheduled, telling the person saving it once it is.
export function getNewHuntInitialValues(data: {
  userId: ObjectID | null;
  timeRange?: TimeRange | undefined;
}): FormValues<SecurityHunt> {
  return {
    schedule: SecurityHuntSchedule.NotScheduled,
    timeRange: data.timeRange || DEFAULT_SECURITY_HUNT_TIME_RANGE,
    ...(data.userId && data.userId.toString()
      ? { notifyUsers: [data.userId.toString()] }
      : {}),
  } as unknown as FormValues<SecurityHunt>;
}
