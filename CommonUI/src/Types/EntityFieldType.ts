import type Hostname from 'Common/Types/API/Hostname';
import type Route from 'Common/Types/API/Route';
import type URL from 'Common/Types/API/URL';
import type Email from 'Common/Types/Email';
import type Name from 'Common/Types/Name';
import type ObjectID from 'Common/Types/ObjectID';

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
