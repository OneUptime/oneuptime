import {
  DESCRIPTION_FIELD_DESCRIPTION,
  DESCRIPTION_FIELD_PLACEHOLDER,
  DESCRIPTION_FIELD_TITLE,
  FEED_FIELD_DESCRIPTION,
  FEED_FIELD_PLACEHOLDER,
  FEED_FIELD_TITLE,
  HOLDS_FIELD_DESCRIPTION,
  HOLDS_FIELD_TITLE,
  NAME_FIELD_DESCRIPTION,
  NAME_FIELD_PLACEHOLDER,
  NAME_FIELD_TITLE,
  SOURCE_FEED_DESCRIPTION,
  SOURCE_FEED_TITLE,
  SOURCE_FIELD_TITLE,
  SOURCE_VALUES_DESCRIPTION,
  SOURCE_VALUES_TITLE,
} from "./WatchlistsCopy";
import {
  WatchlistHoldsOption,
  canChooseWatchlistSource,
  getWatchlistHoldsOptions,
  isFeedWatchlist,
} from "./WatchlistsModel";
import SecurityWatchlist from "Common/Models/DatabaseModels/SecurityWatchlist";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  SecurityWatchlistFormField,
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
 * (what rules write) and what it holds. A description, and - for a kind a
 * threat intel feed carries - following a feed in place of keeping values,
 * wait under More fields: most teams keep their lists, and one page of two
 * fields is quicker to read than a choice they rarely need.
 *
 * A list's Edit (on its page, which knows where its values come from)
 * changes its name, its description, and the feed it follows. What a list
 * holds and where its values come from are chosen once - every value on the
 * list was checked against them - so Edit leaves them out.
 *
 * Each field shows the shared rules' problem with it, in the reader's
 * language (getSecurityWatchlistProblems): the API checks the same rules.
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

// Where a list's values come from, as the form offers it.
export function getWatchlistSourceChoices(): Array<RadioButton> {
  return [
    {
      value: SecurityWatchlistSource.Values,
      title: SOURCE_VALUES_TITLE,
      description: SOURCE_VALUES_DESCRIPTION,
    },
    {
      value: SecurityWatchlistSource.ThreatIntelFeed,
      title: SOURCE_FEED_TITLE,
      description: SOURCE_FEED_DESCRIPTION,
    },
  ];
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

/*
 * A new list as it is saved. The form hides where values come from for a
 * kind no feed carries, and the feed for a list that keeps its own values;
 * a choice made before the kind changed still sits in the form, out of
 * sight. Such a list keeps its own values and follows no feed, so its save
 * is never refused over a field the reader cannot see.
 */
export function prepareNewWatchlist(
  item: SecurityWatchlist,
): SecurityWatchlist {
  if (
    isNewWatchlistFollowingFeed(
      item as unknown as FormValues<SecurityWatchlist>,
    )
  ) {
    return item;
  }

  item.source = SecurityWatchlistSource.Values;
  delete item.threatIntelFeed;
  delete item.threatIntelFeedId;

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
      source: data.saved
        ? data.saved.source
        : (form["source"] as string | undefined) ||
          SecurityWatchlistSource.Values,
      threatIntelFeedId: getWatchlistFormFeedId(values),
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

function feedField(data: {
  translator: Translator;
  saved?: { entityType: string; source: string } | undefined;
  showIf?: ((values: FormValues<SecurityWatchlist>) => boolean) | undefined;
  isFolded: boolean;
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
    ...(data.isFolded ? { collapsibleSection: advancedSection } : {}),
    dataTestId: "watchlist-feed",
  };
}

// Create Watchlist: a name and what it holds; the rest under More fields.
export function getWatchlistCreateFields(options: {
  translator: Translator;
}): Array<ModelField<SecurityWatchlist>> {
  return [
    nameField({ translator: options.translator }),
    {
      field: { entityType: true },
      title: HOLDS_FIELD_TITLE,
      description: HOLDS_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getWatchlistHoldsDropdownOptions(),
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
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: getWatchlistSourceChoices(),
      // Each choice says what it is; the API reader's column help would repeat them.
      hideColumnDescription: true,
      required: false,
      defaultValue: SecurityWatchlistSource.Values,
      showIf: (values: FormValues<SecurityWatchlist>): boolean => {
        return canChooseWatchlistSource(readValues(values)["entityType"]);
      },
      // Keeping values is what a new list does: nobody's setting.
      isAtDefault: (values: FormValues<SecurityWatchlist>): boolean => {
        return !isFeedWatchlist(readValues(values)["source"]);
      },
      collapsibleSection: advancedSection,
      dataTestId: "watchlist-source",
    },
    feedField({
      translator: options.translator,
      showIf: isNewWatchlistFollowingFeed,
      isFolded: true,
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
    fields.push(
      feedField({ translator: options.translator, saved, isFolded: false }),
    );
  }

  fields.push(descriptionField({ translator: options.translator, saved }));

  return fields;
}
