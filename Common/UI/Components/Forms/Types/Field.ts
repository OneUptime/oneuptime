import SelectFormFields from "../../../Types/SelectEntityField";
import {
  CategoryCheckboxOption,
  CheckboxCategory,
} from "../../CategoryCheckbox/CategoryCheckboxTypes";
import { CardSelectOption } from "../../CardSelect/CardSelect";
import { DropdownOption, DropdownOptionGroup } from "../../Dropdown/Dropdown";
import { RadioButton } from "../../RadioButtons/GroupRadioButtons";
import FormFieldSchemaType from "./FormFieldSchemaType";
import FormValues from "./FormValues";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../../Types/API/Route";
import URL from "../../../../Types/API/URL";
import MimeType from "../../../../Types/File/MimeType";
import { ReactElement } from "react";

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
}

export interface CategoryCheckboxProps {
  categories: Array<CheckboxCategory>;
  options: Array<CategoryCheckboxOption>;
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
  cardSelectOptions?: Array<CardSelectOption> | undefined;
  fetchDropdownOptions?:
    | ((
        item: FormValues<TEntity>,
      ) => Promise<Array<DropdownOption | DropdownOptionGroup>>)
    | undefined;
  showHorizontalRuleBelow?: boolean | undefined;
  showHorizontalRuleAbove?: boolean | undefined;
  dropdownModal?: {
    type: DatabaseBaseModelType;
    labelField: string;
    valueField: string;
  };
  selectByAccessControlProps?: {
    categoryCheckboxProps: CategoryCheckboxProps;
    accessControlColumnTitle: string;
  };
  fileTypes?: Array<MimeType> | undefined;
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
  onChange?:
    | ((
        value: any,
        currentFormValues: FormValues<TEntity>,
        setNewFormValues: (currentFormValues: FormValues<TEntity>) => void,
      ) => void)
    | undefined;
  fieldType?: FormFieldSchemaType;
  overrideFieldKey?: string;
  defaultValue?: boolean | string | Date | number | undefined;
  getDefaultValue?:
    | ((item: FormValues<TEntity>) => boolean | string | Date | number)
    | undefined;
  radioButtonOptions?: Array<RadioButton>;
  footerElement?: ReactElement | undefined;
  getFooterElement?: (values: FormValues<TEntity>) => ReactElement | undefined;
  id?: string | undefined;
  getCustomElement?: (
    values: FormValues<TEntity>,
    props: CustomElementProps,
  ) => ReactElement | undefined; // custom element to render instead of the elements in the form.
  categoryCheckboxProps?: CategoryCheckboxProps | undefined; // props for the category checkbox component. If fieldType is CategoryCheckbox, this prop is required.
  dataTestId?: string | undefined;

  // set this to true if you want to show this field in the form even when the form is in edit mode.
  doNotShowWhenEditing?: boolean | undefined;
  doNotShowWhenCreating?: boolean | undefined;

  //
  jsonKeysForDictionary?: Array<string> | undefined;

  hideOptionalLabel?: boolean | undefined;

  /*
   * Spell check configuration (primarily for Markdown and text fields)
   * Default: false (spell check enabled). Set to true to disable spell check.
   */
  disableSpellCheck?: boolean | undefined;

  getSummaryElement?: (item: FormValues<TEntity>) => ReactElement | undefined;

  // If true, this field will span the full row in multi-column layouts.
  spanFullRow?: boolean | undefined;
}
