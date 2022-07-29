import Email from './Email';
import { JSONObject } from './JSON';
import Name from './Name';
import ObjectID from './ObjectID';

export default interface JSONWebTokenData extends JSONObject {
    userId: ObjectID;
    email: Email;
    name: Name;
    isMasterAdmin: boolean;
}
