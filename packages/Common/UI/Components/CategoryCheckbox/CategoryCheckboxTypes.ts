import { ReactElement } from "react";

export type CategoryCheckboxValue = string | number | boolean;

export interface CheckboxCategory {
  title: string | ReactElement;
  id: string;
  /*
   * The title is a name - a status page's group - drawn as written, never
   * looked up (CategoryCheckboxOption.isUserContent).
   */
  isUserContent?: boolean | undefined;
}

export interface CategoryCheckboxOption {
  value: CategoryCheckboxValue;
  label: string | ReactElement;
  categoryId?: string | undefined;
  /*
   * The label is a name - a record's, a monitor's or a status page
   * resource's - drawn as written in every language, never looked up, by
   * the rule a dropdown's option reads by (DropdownOption.isUserContent): a
   * monitor named "Network" is "Network" on a Spanish page, never "Red".
   */
  isUserContent?: boolean | undefined;
}
