import Hostname from 'Common/Types/API/Hostname';
import ObjectID from 'Common/Types/ObjectID';
import FormType from './FormType'

type FormField<Property> =
    Property extends ObjectID ? FormType.ObjectID
    : Property extends Hostname ? FormType.Hostname
    : unknown;

export declare type FormFields<Entity> = {
    [P in keyof Entity]?: FormField<NonNullable<Entity[P]>>;
};