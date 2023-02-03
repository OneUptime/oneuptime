import type Hostname from 'Common/Types/API/Hostname';
import type ObjectID from 'Common/Types/ObjectID';
import type FormType from './FormFieldSchemaType';

type FormField<Property> = Property extends ObjectID
    ? FormType.ObjectID
    : Property extends Hostname
    ? FormType.Hostname
    : unknown;

export declare type FormFields<Entity> = {
    [P in keyof Entity]?: FormField<NonNullable<Entity[P]>>;
};
