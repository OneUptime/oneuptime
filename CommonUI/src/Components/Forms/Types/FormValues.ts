import FormFieldSchemaTypes from './FormFieldType';

export type FormField<Property> = Property extends FormFieldSchemaTypes
    ? Property
    : unknown;

declare type FormValues<Entity> = {
    [P in keyof Entity]?: FormField<NonNullable<Entity[P]>> | undefined;
};

export default FormValues;
