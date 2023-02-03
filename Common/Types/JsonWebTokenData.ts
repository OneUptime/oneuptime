import type Email from './Email';
import type { JSONObject } from './JSON';
import type Name from './Name';
import type ObjectID from './ObjectID';

export default interface JSONWebTokenData extends JSONObject {
    userId: ObjectID;
    email: Email;
    name: Name;
    isMasterAdmin: boolean;
    statusPageId?: ObjectID | undefined; // for status page logins.
}
