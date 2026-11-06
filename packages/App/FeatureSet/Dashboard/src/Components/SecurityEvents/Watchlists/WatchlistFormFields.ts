import {
  DESCRIPTION_FIELD_DESCRIPTION,
  DESCRIPTION_FIELD_PLACEHOLDER,
  DESCRIPTION_FIELD_TITLE,
  FEED_FIELD_DESCRIPTION,
  FEED_FIELD_PLACEHOLDER,
  FEED_FIELD_TITLE,
  HOLDS_FIELD_DESCRIPTION,
  HOLDS_FIELD_PLACEHOLDER,
  HOLDS_FIELD_TITLE,
  IMPORT_SCHEDULE_FIELD_DESCRIPTION,
  IMPORT_SCHEDULE_FIELD_TITLE,
  IMPORT_URL_FIELD_DESCRIPTION,
  IMPORT_URL_FIELD_PLACEHOLDER,
  IMPORT_URL_FIELD_TITLE,
  NAME_FIELD_DESCRIPTION,
  NAME_FIELD_PLACEHOLDER,
  NAME_FIELD_TITLE,
  SOURCE_FIELD_TITLE,
} from "./WatchlistsCopy";
import {
  WatchlistHoldsOption,
  WatchlistSourceChoice,
  canChooseWatchlistSource,
  getWatchlistHoldsOptions,
  getWatchlistSourceChoicesFor,
  isFeedWatchlist,
  isUrlWatchlist,
} from "./WatchlistsModel";
import SecurityWatchlist from "Common/Models/DatabaseModels/SecurityWatchlist";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  DEFAULT_SECURITY_WATCHLIST_IMPORT_SCHEDULE,
  SECURITY_WATCHLIST_IMPORT_SCHEDULES,
  SecurityWatchlistFormField,
  SecurityWatchlistImportSchedule,
  SecurityWatchlistShape,
  SecurityWatchlistSource,
  getSecurityWatchlistProblems,
} from "Common/Types/SecurityEvent/SecurityWatchlist";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE CREATE WATCHLIST FORM, AND A LIST'S EDIT.
 *
 * Creating a list asks for what most lists need and nothing else: its name
 * (what rules write) and what it holds. A description, and where its values
 * come from in place of keeping them - a file at an address read on a
 * schedule, or (for a kind a threat intel feed carries) a feed - wait under
 * More fields: most teams keep their lists, and one page of two fields is
 * quicker to read than a choice they rarely need.
 *
 * A list's Edit (on its page, which knows where its values come from)
 * changes its name, its description, the feed it follows, and the address
 * it is read from and how often. What a list holds and where its values
 * come from are chosen once - every value on the list was checked against
 * them - so Edit leaves them out.
 *
 * Each field shows the shared rules' problem with it, in the reader's
 * language (getSecurityWatchlistProblems): the API checks the same rules.
 *
 * React-free, as App's tests read these fields (the docs' facts): where a
 * new list's values come from is drawn by WatchlistSourceRadio, which the
 * page hands in (renderWatchlistSourceChoice).
 */

const advancedSection: FormFieldCollapsibleSection<SecurityWatchlist> =
  getAdvancedFormSection<SecurityWatchlist>();

export function getWatchlistHoldsDropdownOptions(): Array<DropdownOption> {
  return getWatchlistHoldsOptions().map(
    (option: WatchlistHoldsOption): DropdownOption => {
      return { label: option.label, value: option.value };
    },
  );
}

// Where a list of this kind's values come from, as the form offers it.
export function getWatchlistSourceChoices(
  entityType?: unknown,
): Array<RadioButton> {
  return getWatchlistSourceChoicesFor(entityType).map(
    (choice: WatchlistSourceChoice): RadioButton => {
      return {
        value: choice.value,
        title: choice.title,
        description: choice.description,
      };
    },
  );
}

// How often a list read from an address is read, as the form offers it.
export function getWatchlistImportScheduleOptions(): Array<DropdownOption> {
  return SECURITY_WATCHLIST_IMPORT_SCHEDULES.map(
    (schedule: SecurityWatchlistImportSchedule): DropdownOption => {
      return { label: schedule, value: schedule };
    },
  );
}

function readValues(
  values: FormValues<SecurityWatchlist>,
): Record<string, unknown> {
  return values as Record<string, unknown>;
}

// The feed the form names, under either of its names.
export function getWatchlistFormFeedId(
  values: FormValues<SecurityWatchlist>,
): unknown {
  const data: Record<string, unknown> = readValues(values);
  const relation: unknown = data["threatIntelFeed"];

  if (relation && typeof relation === "object") {
    return (relation as Record<string, unknown>)["_id"] || null;
  }

  return relation || data["threatIntelFeedId"] || null;
}

// Whether a new list follows a feed: chosen, for a kind a feed carries.
export function isNewWatchlistFollowingFeed(
  values: FormValues<SecurityWatchlist>,
): boolean {
  const data: Record<string, unknown> = readValues(values);

  return (
    isFeedWatchlist(data["source"]) &&
    canChooseWatchlistSource(data["entityType"])
  );
}

// Whether a new list is read from an address: chosen, for any kind.
export function isNewWatchlistReadFromUrl(
  values: FormValues<SecurityWatchlist>,
): boolean {
  return isUrlWatchlist(readValues(values)["source"]);
}

/*
 * Where a new list's values come from, as the reader can see it: a feed
 * chosen before the kind changed to one no feed carries is a list kept by
 * hand - the choices on screen no longer offer it, and the list is saved
 * that way (prepareNewWatchlist).
 */
export function getNewWatchlistSource(
  values: FormValues<SecurityWatchlist>,
): SecurityWatchlistSource {
  if (isNewWatchlistReadFromUrl(values)) {
    return SecurityWatchlistSource.Url;
  }

  if (isNewWatchlistFollowingFeed(values)) {
    return SecurityWatchlistSource.ThreatIntelFeed;
  }

  return SecurityWatchlistSource.Values;
}

/*
 * A new list as it is saved. The form hides the feed for a kind no feed
 * carries, and the feed or the address for a list that keeps its own
 * values; a choice made before the kind or the source changed still sits
 * in the form, out of sight. Such a list is saved as what the reader can
 * see, so its save is never refused over a field they cannot.
 */
export function prepareNewWatchlist(
  item: SecurityWatchlist,
): SecurityWatchlist {
  const values: FormValues<SecurityWatchlist> =
    item as unknown as FormValues<SecurityWatchlist>;

  if (isNewWatchlistFollowingFeed(values)) {
    delete item.importUrl;
    delete item.importSchedule;
    return item;
  }

  delete item.threatIntelFeed;
  delete item.threatIntelFeedId;

  if (isNewWatchlistReadFromUrl(values)) {
    item.importSchedule =
      item.importSchedule || DEFAULT_SECURITY_WATCHLIST_IMPORT_SCHEDULE;
    return item;
  }

  item.source = SecurityWatchlistSource.Values;
  delete item.importUrl;
  delete item.importSchedule;

  return item;
}

/*
 * The shared rules' problem with one field of a form, in the reader's
 * language. An Edit form holds no kind or source: the saved list's are
 * asked about in their place (`saved`).
 */
function problemWith(data: {
  translator: Translator;
  field: SecurityWatchlistFormField;
  saved?: { entityType: string; source: string } | undefined;
}): (values: FormValues<SecurityWatchlist>) => string | null {
  return (values: FormValues<SecurityWatchlist>): string | null => {
    const form: Record<string, unknown> = readValues(values);

    const watchlist: SecurityWatchlistShape = {
      name: form["name"] as string | undefined,
      entityType: data.saved
        ? data.saved.entityType
        : (form["entityType"] as string | undefined),
      description: form["description"] as string | undefined,
      source: data.saved ? data.saved.source : getNewWatchlistSource(values),
      threatIntelFeedId: getWatchlistFormFeedId(values),
      importUrl: form["importUrl"] as string | undefined,
      importSchedule: form["importSchedule"] as string | undefined,
    };

    const problem: string | undefined = getSecurityWatchlistProblems(
      watchlist,
    ).find((item: { field: SecurityWatchlistFormField }): boolean => {
      return item.field === data.field;
    })?.message;

    return problem ? data.translator.translateText(problem) || problem : null;
  };
}

function nameField(data: {
  translator: Translator;
  saved?: { entityType: string; source: string } | undefined;
}): ModelField<SecurityWatchlist> {
  return {
    field: { name: true },
    title: NAME_FIELD_TITLE,
    description: NAME_FIELD_DESCRIPTION,
    fieldType: FormFieldSchemaType.Text,
    placeholder: NAME_FIELD_PLACEHOLDER,
    required: true,
    customValidation: problemWith({ ...data, field: "name" }),
    disableSpellCheck: true,
    dataTestId: "watchlist-name",
  };
}

function descriptionField(data: {
  translator: Translator;
  saved?: { entityType: string; source: string } | undefined;
}): ModelField<SecurityWatchlist> {
  return {
    field: { description: true },
    title: DESCRIPTION_FIELD_TITLE,
    description: DESCRIPTION_FIELD_DESCRIPTION,
    fieldType: FormFieldSchemaType.LongText,
    placeholder: DESCRIPTION_FIELD_PLACEHOLDER,
    required: false,
    customValidation: problemWith({ ...data, field: "description" }),
    collapsibleSection: advancedSection,
    dataTestId: "watchlist-description",
  };
}

/*
 * The feed a list follows. Create folds it with the other rare fields - the
 * section is handed in where the form is built, so it reads as one row
 * there - and Edit asks it in the open.
 */
function feedField(data: {
  translator: Translator;
  saved?: { entityType: string; source: string } | undefined;
  showIf?: ((values: FormValues<SecurityWatchlist>) => boolean) | undefined;
  collapsibleSection?:
    | FormFieldCollapsibleSection<SecurityWatchlist>
    | undefined;
}): ModelField<SecurityWatchlist> {
  return {
    field: { threatIntelFeed: true },
    title: FEED_FIELD_TITLE,
    description: FEED_FIELD_DESCRIPTION,
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownModal: {
      type: ThreatIntelFeed,
      labelField: "name",
      valueField: "_id",
      sort: { name: SortOrder.Ascending },
    },
    placeholder: FEED_FIELD_PLACEHOLDER,
    ...(data.showIf ? { showIf: data.showIf } : {}),
    required: data.showIf || true,
    customValidation: problemWith({ ...data, field: "threatIntelFeedId" }),
    ...(data.collapsibleSection
      ? { collapsibleSection: data.collapsibleSection }
      : {}),
    dataTestId: "watchlist-feed",
  };
}

/*
 * The address a list is read from, and how often. Create folds them with
 * the other rare fields (the section is handed in where the form is
 * built); Edit asks them in the open - they are what such a list is.
 */
function importFields(data: {
  translator: Translator;
  saved?: { entityType: string; source: string } | undefined;
  showIf?: ((values: FormValues<SecurityWatchlist>) => boolean) | undefined;
  collapsibleSection?:
    | FormFieldCollapsibleSection<SecurityWatchlist>
    | undefined;
}): Array<ModelField<SecurityWatchlist>> {
  return [
    {
      field: { importUrl: true },
      title: IMPORT_URL_FIELD_TITLE,
      description: IMPORT_URL_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.URL,
      placeholder: IMPORT_URL_FIELD_PLACEHOLDER,
      ...(data.showIf ? { showIf: data.showIf } : {}),
      required: data.showIf || true,
      disableSpellCheck: true,
      customValidation: problemWith({ ...data, field: "importUrl" }),
      ...(data.collapsibleSection
        ? { collapsibleSection: data.collapsibleSection }
        : {}),
      dataTestId: "watchlist-import-url",
    },
    {
      field: { importSchedule: true },
      title: IMPORT_SCHEDULE_FIELD_TITLE,
      description: IMPORT_SCHEDULE_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getWatchlistImportScheduleOptions(),
      defaultValue: DEFAULT_SECURITY_WATCHLIST_IMPORT_SCHEDULE,
      ...(data.showIf ? { showIf: data.showIf } : {}),
      required: data.showIf || true,
      customValidation: problemWith({ ...data, field: "importSchedule" }),
      ...(data.collapsibleSection
        ? { collapsibleSection: data.collapsibleSection }
        : {}),
      dataTestId: "watchlist-import-schedule",
    },
  ];
}

/*
 * What draws where a new list's values come from: WatchlistSourceRadio,
 * whose choices follow what the list holds (renderWatchlistSourceChoice).
 */
export type WatchlistSourceChoiceRenderer = NonNullable<
  ModelField<SecurityWatchlist>["getCustomElement"]
>;

// Create Watchlist: a name and what it holds; the rest under More fields.
export function getWatchlistCreateFields(options: {
  translator: Translator;
  renderSourceChoice: WatchlistSourceChoiceRenderer;
}): Array<ModelField<SecurityWatchlist>> {
  return [
    nameField({ translator: options.translator }),
    {
      field: { entityType: true },
      title: HOLDS_FIELD_TITLE,
      description: HOLDS_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getWatchlistHoldsDropdownOptions(),
      placeholder: HOLDS_FIELD_PLACEHOLDER,
      required: true,
      customValidation: problemWith({
        translator: options.translator,
        field: "entityType",
      }),
      dataTestId: "watchlist-holds",
    },
    descriptionField({ translator: options.translator }),
    {
      field: { source: true },
      title: SOURCE_FIELD_TITLE,
      /*
       * Its choices follow what the list holds (WatchlistSourceRadio): a
       * file at an address for any kind, a feed only for a kind a feed
       * carries.
       */
      fieldType: FormFieldSchemaType.CustomComponent,
      // Each choice says what it is; the API reader's column help would repeat them.
      hideColumnDescription: true,
      required: false,
      // One is always chosen (keeping values, by default): never "(Optional)".
      hideOptionalLabel: true,
      defaultValue: SecurityWatchlistSource.Values,
      // Keeping values is what a new list does: nobody's setting.
      isAtDefault: (values: FormValues<SecurityWatchlist>): boolean => {
        const source: unknown = readValues(values)["source"];
        return !source || source === SecurityWatchlistSource.Values;
      },
      customValidation: problemWith({
        translator: options.translator,
        field: "source",
      }),
      getCustomElement: options.renderSourceChoice,
      collapsibleSection: advancedSection,
    },
    feedField({
      translator: options.translator,
      showIf: isNewWatchlistFollowingFeed,
      collapsibleSection: advancedSection,
    }),
    ...importFields({
      translator: options.translator,
      showIf: isNewWatchlistReadFromUrl,
      collapsibleSection: advancedSection,
    }),
  ];
}

/*
 * A list's Edit: its name and description, and the feed it follows when it
 * follows one - asked in the open, it is what such a list is.
 */
export function getWatchlistEditFields(options: {
  translator: Translator;
  entityType: SecurityEntityType | string | undefined;
  source: SecurityWatchlistSource | string | undefined;
}): Array<ModelField<SecurityWatchlist>> {
  const saved: { entityType: string; source: string } = {
    entityType: options.entityType || SecurityEntityType.Other,
    source: options.source || SecurityWatchlistSource.Values,
  };

  const fields: Array<ModelField<SecurityWatchlist>> = [
    nameField({ translator: options.translator, saved }),
  ];

  if (isFeedWatchlist(options.source)) {
    fields.push(feedField({ translator: options.translator, saved }));
  }

  if (isUrlWatchlist(options.source)) {
    fields.push(...importFields({ translator: options.translator, saved }));
  }

  fields.push(descriptionField({ translator: options.translator, saved }));

  return fields;
}
