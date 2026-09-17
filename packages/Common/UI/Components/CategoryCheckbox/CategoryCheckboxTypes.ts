import { ReactElement } from "react";

export type CategoryCheckboxValue = string | number | boolean;

export interface CheckboxCategory {
  title: string | ReactElement;
  id: string;
}

export interface CategoryCheckboxOption {
  value: CategoryCheckboxValue;
  label: string | ReactElement;
  categoryId?: string | undefined;
}
