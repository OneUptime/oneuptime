export type CategoryCheckboxValue = string | number | boolean;

export interface CheckboxCategory {
    title: string;
    id: string;
}

export interface CategoryCheckboxOption {
    value: CategoryCheckboxValue;
    label: string;
    categoryId: string;
}
