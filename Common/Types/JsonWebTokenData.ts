import Email from "./Email";
import { JSONObject } from "./JSON";
import Name from "./Name";
import ObjectID from "./ObjectID";

export default interface JSONWebTokenData extends JSONObject {
  userId: ObjectID;
  email: Email;
  name?: Name | undefined;
  isMasterAdmin: boolean;
  statusPageId?: ObjectID | undefined; // for status page logins.
  projectId?: ObjectID | undefined; // for SSO logins.
  isGlobalLogin: boolean; // If this is OneUptime username and password login. This is true, if this is SSO login. Then, this is false.
}
