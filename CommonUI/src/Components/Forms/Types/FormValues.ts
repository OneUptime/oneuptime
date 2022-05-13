import FormFieldSchemaTypes from './FormFieldType'

type FormFields<Property> = Property extends FormFieldSchemaTypes
    ? Property
    : unknown;

declare type FormValues<Entity> = {
    [P in keyof Entity]?: FormFields<NonNullable<Entity[P]>>;
};

export default FormValues;