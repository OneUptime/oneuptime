import FormFieldSchemaTypes from "./FormFieldType";

export type SelectFormField<Property> = Property extends FormFieldSchemaTypes
    ? boolean
    : unknown;

declare type SelectFormFields<Entity> = {
    [P in keyof Entity]?: SelectFormField<NonNullable<Entity[P]>>;
};

export default SelectFormFields;