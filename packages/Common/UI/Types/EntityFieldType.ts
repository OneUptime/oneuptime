import Hostname from "../../Types/API/Hostname";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import Email from "../../Types/Email";
import Name from "../../Types/Name";
import ObjectID from "../../Types/ObjectID";

type FormFieldType =
  | string
  | number
  | boolean
  | ObjectID
  | Hostname
  | Email
  | Date
  | Name
  | Route
  | URL;

export default FormFieldType;
