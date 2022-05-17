import FormFieldSchemaTypes from './FormFieldType';

type RequiredFormField<Property> = Property extends FormFieldSchemaTypes
    ? boolean
    : unknown;

declare type RequiredFormFields<Entity> = {
    [P in keyof Entity]?: RequiredFormField<NonNullable<Entity[P]>>;
};

export default RequiredFormFields;
