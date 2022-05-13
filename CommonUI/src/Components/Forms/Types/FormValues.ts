import FormFieldSchemaTypes from './FormFieldSchemaTypes'

type FormFields<Property> = Property extends FormFieldSchemaTypes
    ? Property
    : unknown;

declare type FormValues<Entity> = {
    [P in keyof Entity]?: FormFields<NonNullable<Entity[P]>>;
};

export default FormValues;