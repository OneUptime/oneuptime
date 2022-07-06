import Hostname from 'Common/Types/API/Hostname';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
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
    | Name
    | Route
    | URL;

export default FormFieldType;
