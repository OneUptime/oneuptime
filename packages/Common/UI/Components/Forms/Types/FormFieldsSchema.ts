import FormType from "./FormFieldSchemaType";
import Hostname from "../../../../Types/API/Hostname";
import ObjectID from "../../../../Types/ObjectID";

type FormField<Property> = Property extends ObjectID
  ? FormType.ObjectID
  : Property extends Hostname
    ? FormType.Hostname
    : unknown;

export declare type FormFields<Entity> = {
  [P in keyof Entity]?: FormField<NonNullable<Entity[P]>>;
};
