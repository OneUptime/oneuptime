import Hostname from 'Common/Types/API/Hostname';
import Email from 'Common/Types/Email';
import Name from 'Common/Types/Name';
import ObjectID from 'Common/Types/ObjectID';

type FormFieldType =
    | string
    | number
    | boolean
    | ObjectID
    | Hostname
    | Email
    | Name;

export default FormFieldType;
