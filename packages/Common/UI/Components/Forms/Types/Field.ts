import SelectFormFields from "../../../Types/SelectEntityField";
import {
  CategoryCheckboxOption,
  CheckboxCategory,
} from "../../CategoryCheckbox/CategoryCheckboxTypes";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "../../CardSelect/CardSelect";
import { DropdownOption, DropdownOptionGroup } from "../../Dropdown/Dropdown";
import type { DropdownChange } from "../../Dropdown/DropdownChange";
import { BulkAddedLabel } from "../../EntityDropdown/EntityDropdown";
import { RadioButton } from "../../RadioButtons/GroupRadioButtons";
import FormFieldSchemaType from "./FormFieldSchemaType";
import FormValues from "./FormValues";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import MimeType from "../../../../Types/File/MimeType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import type { CodeEditorActions } from "../../CodeEditor/CodeEditor";
import type { PeoplePickerFieldConfig } from "../../PeoplePicker/PeoplePickerTypes";
import type { TemplateVariableGroups } from "../../../../Types/Template/TemplateVariable";
import type IconProp from "../../../../Types/Icon/IconProp";
import { ReactElement, ReactNode } from "react";

export enum FormFieldStyleType {
  Default = "Default",
  Heading = "Heading",
  DividerBelow = "DividerBelow",
}

export interface FormFieldSideLink {
  text: string;
  url: Route | URL;
  openLinkInNewTab?: boolean;
}

export interface CustomElementProps {
  error?: string | undefined;
  tabIndex?: number | undefined;
  onChange?: ((value: any) => void) | undefined;
  onBlur?: () => void;
  initialValue?: any;
  placeholder?: string | undefined;
  /*
   * The id of the field's label, so a custom control can be named by it the
   * way a native input is by <label for>.
   */
  ariaLabelledby?: string | undefined;
}

export interface CategoryCheckboxProps {
  categories: Array<CheckboxCategory>;
  options: Array<CategoryCheckboxOption>;
}

/*
 * What a field's footer (getFooterElement) can do to the field it is drawn
 * under.
 */
export interface FieldFooterProps {
  /*
   * Sets the field's value the way picking it in the field would: the
   * field's onChange is called first - for a dropdown, with what the pick
   * changed as the field's options name it (DropdownChange) - then the value
   * is stored, and the form counts it as the user's own edit. For a footer
   * that offers one-click picks, such as the status pages that show a
   * maintenance event's monitors, suggested under its status page picker.
   * Nothing is set until the footer calls it.
   */
  setValue: (value: any) => void;
}

/*
 * A folded group of fields inside a form (or inside one step of it): a
 * header the user opens to reach them. Every field that should be in the
 * group carries the same section (same id), and the fields must be next to
 * each other in the list - BasicForm folds consecutive fields that share an
 * id into one section. For the usual case, rarely needed options under
 * "Advanced", use getAdvancedFormSection (Forms/Utils/AdvancedFormSection)
 * rather than writing one.
 *
 * A folded section says "Configured" on its header while anything in it is
 * set, and opens by itself when a field in it fails validation.
 */
export interface FormFieldCollapsibleSection<TEntity> {
  id: string;
  title: string;
  description?: string | undefined;
  /*
   * Whether anything in the section is set. Left out, the section works it
   * out from its own fields: one of them holding a value other than empty
   * or its default (isFormSectionConfigured).
   */
  isConfigured?: ((values: FormValues<TEntity>) => boolean) | undefined;
  /*
   * Whether the section starts open when it is configured as the form
   * opens - an edit form, or a default that fills a field in. True when left
   * out: a section of details someone wrote opens to show them. A More
   * fields section (getAdvancedFormSection) sets it to false: it always
   * starts folded, and its header shows what is set instead.
   */
  openWhenConfigured?: boolean | undefined;
  /*
   * Folded, the header lists the fields the section holds by name - "Declared
   * At · Initial State · Labels" - with the set ones as chips that say what
   * they are set to. For a section whose title does not say what is in it:
   * More fields. Left out, a folded header shows only the fields that are
   * set (FoldedSection).
   */
  listFieldsWhileFolded?: boolean | undefined;
  // Drawn in a tile before the title (More fields: IconProp.AdjustmentHorizontal).
  icon?: IconProp | undefined;
  /*
   * What the folded fields are set to, in plain words, shown under the
   * title while the section is folded - so the form says what will happen
   * without being opened, and a section whose defaults are right for most
   * people can stay folded ("Subscribers of the event's status pages are
   * notified when it is scheduled, when it starts and when it ends.").
   * Worked out from the form's values as they are now, so it follows what
   * is ticked. Whole English sentences: each is looked up in the
   * translations on its own (keep them in translationKey() so the string
   * extractor finds them). Drawn under what the section lists; a section
   * that does not list its fields shows it in place of the chips of what is
   * set, since the sentences already say it.
   */
  getSummary?:
    | ((values: FormValues<TEntity>) => Array<string> | undefined)
    | undefined;
}

export default interface Field<TEntity> {
  name?: string; // form field name, should be unique in thr form. If not provided, the field will be auto generated.
  title?: string;
  description?: string | ReactElement;
  field?: SelectFormFields<TEntity> | undefined;
  placeholder?: string;
  showEvenIfPermissionDoesNotExist?: boolean; // show this field even if user does not have permissions to view.
  disabled?: boolean;
  stepId?: string | undefined;
  required?: boolean | ((item: FormValues<TEntity>) => boolean) | undefined;
  dropdownOptions?: Array<DropdownOption | DropdownOptionGroup> | undefined;
  cardSelectOptions?:
    | Array<CardSelectOption | CardSelectOptionGroup>
    | undefined;
  cardSelectSingleColumn?: boolean | undefined;
  /*
   * Give the card picker a search box and collapse its groups behind their
   * headers. Both are opt in: a picker with a handful of cards reads fine as
   * a plain grid, and turning them on there would only add chrome.
   */
  cardSelectSearchable?: boolean | undefined;
  cardSelectSearchPlaceholder?: string | undefined;
  cardSelectCollapsibleGroups?: boolean | undefined;
  fetchDropdownOptions?:
    | ((
        item: FormValues<TEntity>,
      ) => Promise<Array<DropdownOption | DropdownOptionGroup>>)
    | undefined;
  showHorizontalRuleBelow?: boolean | undefined;
  showHorizontalRuleAbove?: boolean | undefined;
  /*
   * The model a dropdown lists. ModelForm fetches it with its colour column,
   * so a state, severity or monitor status shows its colour before its name
   * (Field.fetchDropdownOptions, when a field has one, keeps those colours).
   */
  dropdownModal?: {
    type: DatabaseBaseModelType;
    labelField: string;
    valueField: string;
    /*
     * The order to list the options in, by columns of the dropdown's model -
     * `{ order: SortOrder.Ascending }` lists states in the order an incident
     * moves through them. Unset, the list comes in the server's default
     * order (newest first).
     */
    sort?: { [columnName: string]: SortOrder } | undefined;
    /*
     * Only the rows of the dropdown's model that match this, by its columns
     * - `{ isVerified: true }` lists only the domains a project has verified.
     * Both the list the form fetches and the dropdown's own search are
     * narrowed by it. Unset, every row the reader may see is listed.
     */
    query?: Record<string, unknown> | undefined;
  };
  /*
   * Entity dropdowns can bulk-add every entry carrying a label. That is a
   * one-time expansion and the label is not part of the field's value, so a
   * form that needs to know which label a selection came from asks for it
   * here.
   */
  onLabelsBulkAdded?: ((labels: Array<BulkAddedLabel>) => void) | undefined;
  selectByAccessControlProps?: {
    categoryCheckboxProps: CategoryCheckboxProps;
    accessControlColumnTitle: string;
  };
  fileTypes?: Array<MimeType> | undefined;
  /*
   * File and ImageFile fields: the largest file the field takes, in
   * megabytes, when it is less than the 10 MB every upload is held to. The
   * picker says so, and refuses a larger file before uploading it.
   */
  maxFileSizeInMegabytes?: number | undefined;
  sideLink?: FormFieldSideLink | undefined;
  validation?: {
    minLength?: number | undefined;
    maxLength?: number | undefined;
    toMatchField?: keyof TEntity | undefined;
    noSpaces?: boolean | undefined;
    noSpecialCharacters?: boolean;
    noNumbers?: boolean | undefined;
    minValue?: number | undefined;
    maxValue?: number | undefined;
    dateShouldBeInTheFuture?: boolean | undefined;
  };
  customValidation?:
    | ((values: FormValues<TEntity>) => string | null)
    | undefined;
  styleType?: FormFieldStyleType | undefined;
  showIf?: ((item: FormValues<TEntity>) => boolean) | undefined;
  /**
   * For a JSON field: judge its contents by JSON5's rules rather than JSON's.
   * Set it where the code that eventually reads this value uses
   * JSONFunctions.parse, so validation cannot reject a value that would have
   * been read back perfectly well.
   */
  allowJSON5?: boolean | undefined;
  /*
   * For a JSON, HTML, CSS or JavaScript field: more buttons for its code
   * editor's toolbar, such as the workflow builder's "Insert value".
   */
  codeEditorToolbarActions?:
    | ((editor: CodeEditorActions) => ReactNode)
    | undefined;
  /*
   * Called with the new value before the form stores it. currentFormValues
   * are the values as they were; setNewFormValues replaces them all (spread
   * currentFormValues into what you hand it), and the new value is stored
   * on top. For a Dropdown or MultiSelectDropdown field, change says what
   * the pick was as the list showed it - the options picked now and before,
   * with their labels - so a field can fill in a name after what was picked
   * without a request of its own (a status page resource's display name
   * follows its monitor: StatusPageResourceFormFields).
   */
  onChange?:
    | ((
        value: any,
        currentFormValues: FormValues<TEntity>,
        setNewFormValues: (currentFormValues: FormValues<TEntity>) => void,
        change?: DropdownChange | undefined,
      ) => void)
    | undefined;
  fieldType?: FormFieldSchemaType;
  overrideFieldKey?: string;
  defaultValue?: boolean | string | Date | number | undefined;
  getDefaultValue?:
    | ((item: FormValues<TEntity>) => boolean | string | Date | number)
    | undefined;
  /*
   * For a field whose default follows other fields - an OIDC discovery URL
   * made from the issuer, a description made from the provider's name -
   * whether the value it holds now is that default. Such a value is not
   * one the user chose, so a folded section does not show it as set, and a
   * review step does not list it (isFormFieldValueSet).
   */
  isAtDefault?: ((values: FormValues<TEntity>) => boolean) | undefined;
  /*
   * The default of the column the field writes, as its model declares it -
   * filled in by ModelForm, on Create and Edit alike, for a field that names
   * no default of its own (Utils/CreateFormDefaults). Not a value the field
   * starts with: an Edit form shows the record as it is. It is what a folded
   * section compares with, so a switch that is on because its column starts
   * on is not shown as set, and one turned off is (isFormFieldValueSet).
   */
  columnDefaultValue?: boolean | string | number | undefined;
  radioButtonOptions?: Array<RadioButton>;
  footerElement?: ReactElement | undefined;
  /*
   * Drawn under the field, from the form's values as they are now. error is
   * the field's validation error once it has been touched. footer lets it
   * set the field's value (FieldFooterProps); BasicForm always hands it in.
   */
  getFooterElement?: (
    values: FormValues<TEntity>,
    error?: string,
    footer?: FieldFooterProps,
  ) => ReactElement | undefined;
  // For Input fields: render errors in the footer linked by ariaDescribedby.
  errorMessageInFooter?: boolean | undefined;
  id?: string | undefined;
  getCustomElement?: (
    values: FormValues<TEntity>,
    props: CustomElementProps,
  ) => ReactElement | undefined; // custom element to render instead of the elements in the form.
  /*
   * The custom element draws the field's title and help itself, the way a
   * switch field does - beside its control rather than above it. FormField
   * leaves out the label it would draw over the element, and the gap under
   * that label, and hands the element no ariaLabelledby to a label that is
   * not there.
   */
  customElementDrawsOwnLabel?: boolean | undefined;
  categoryCheckboxProps?: CategoryCheckboxProps | undefined; // props for the category checkbox component. If fieldType is CategoryCheckbox, this prop is required.
  /*
   * For a PeoplePicker field: the kinds of record it offers (people, teams),
   * in the order its search list shows them, and the form value each kind's
   * picks are kept in. One picker can so stand in for an "owner users" and an
   * "owner teams" dropdown and save exactly what they saved: ModelForm saves
   * a value that is a column of its model as that column, and sends any
   * other as misc data. The field's own key names it in the form only (use
   * formOnly). OwnersFormField.ts builds the owners one.
   */
  peoplePicker?: PeoplePickerFieldConfig | undefined;
  dataTestId?: string | undefined;
  autoComplete?: string | undefined;
  /*
   * A Password field that holds the person's own password, on a page where
   * they sign in, sign up or change it. Set it together with the matching
   * autoComplete ("current-password" to sign in, "new-password" to set one)
   * so password managers fill and save it. Every other Password and
   * EncryptedText field holds a secret the product stores for something else,
   * and is kept away from password managers (see Input).
   */
  isOwnCredential?: boolean | undefined;
  ariaDescribedby?: string | undefined;

  // set this to true if you want to show this field in the form even when the form is in edit mode.
  doNotShowWhenEditing?: boolean | undefined;
  doNotShowWhenCreating?: boolean | undefined;

  /*
   * The field only drives the form: it fills in, or edits a part of,
   * fields that are saved, and its own value is never sent. ModelForm
   * leaves it out of the request's misc data, where the value of a field
   * with an overrideFieldKey otherwise goes. Examples: the identity
   * provider picker that fills in an OAuth 2.0 variable's token URL, and
   * the Destination step that edits a part of a workspace notification
   * rule.
   */
  formOnly?: boolean | undefined;

  //
  jsonKeysForDictionary?: Array<string> | undefined;
  isLoadingDictionaryKeys?: boolean | undefined;
  dictionaryValueSuggestions?: Record<string, Array<string>> | undefined;
  loadingDictionaryValueKeys?: Array<string> | undefined;
  onDictionaryKeySelected?: ((key: string) => void) | undefined;
  dictionaryEnableOperators?: boolean | undefined;

  hideOptionalLabel?: boolean | undefined;

  /*
   * Spell check configuration (primarily for Markdown and text fields)
   * Default: false (spell check enabled). Set to true to disable spell check.
   */
  disableSpellCheck?: boolean | undefined;

  /*
   * For a LongText field: start a few lines tall and grow with what is typed,
   * up to a limit where it scrolls, rather than sitting at a fixed six lines.
   * Suits values that are usually a line or two but sometimes run to
   * paragraphs, such as a workflow step's message or prompt.
   */
  autoGrow?: boolean | undefined;

  /*
   * For a Markdown field: whether its editor uploads pasted, dropped and
   * picked images. Default: true. Uploading needs a signed-in user, so a
   * form that people without a OneUptime account fill in sets this to false
   * -- the Image button is hidden and image files are ignored.
   */
  allowImageUpload?: boolean | undefined;

  /*
   * The {{variables}} this field's value can use, when the value is a
   * template: a note template, an SLA reminder, a subscriber notification.
   * The field then shows them collapsed under its input, as cards that each
   * add their variable where the cursor is, and typing "{{" in the field
   * opens them under the cursor. A Markdown field's toolbar, and a code
   * field's, also get an Insert variable button.
   *
   * Works for Markdown, Text, LongText and the code fields (HTML, CSS,
   * JavaScript, JSON). A function is given the form's values, for variables
   * that depend on another field (a subscriber template's event type).
   * Don't also list the variables in the description: this is where they go.
   */
  templateVariables?:
    | TemplateVariableGroups
    | ((values: FormValues<TEntity>) => TemplateVariableGroups)
    | undefined;
  // What the variables are filled with: the first line of the open list.
  templateVariablesDescription?: string | ReactElement | undefined;
  // More for the open variables list, after the variables (a panel of its own).
  getTemplateVariablesFooter?:
    | ((values: FormValues<TEntity>) => ReactElement | undefined)
    | undefined;

  getSummaryElement?: (item: FormValues<TEntity>) => ReactElement | undefined;

  /*
   * Listed on the review step (FormSummary) whatever it holds, even while it
   * is folded into a collapsible section. A folded field is reviewed only
   * when it holds something of the user's (isListedInFormSummary), which
   * suits the options nobody touched; a default whose consequence should be
   * read before saving says so here. Declare Incident's Notify Status Page
   * Subscribers starts ticked under More fields, and its review row says who
   * will be emailed and previews what they will be sent. A field its showIf
   * hides is still left out, and a section reviewed by its own summary line
   * (FormFieldCollapsibleSection.getSummary) still stands in for its fields.
   */
  alwaysInSummary?: boolean | undefined;

  // If true, this field will span the full row in multi-column layouts.
  spanFullRow?: boolean | undefined;

  /*
   * Optional section header rendered above this field. Use to group related
   * fields together within a single form step. Renders a small heading and
   * an optional description, separated from the previous fields by a divider.
   */
  sectionTitle?: string | undefined;
  sectionDescription?: string | ReactElement | undefined;

  // Consecutive visible fields with the same id share one collapsible section.
  collapsibleSection?: FormFieldCollapsibleSection<TEntity> | undefined;
}
