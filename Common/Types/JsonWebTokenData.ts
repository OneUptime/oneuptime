import Email from "./Email";
import ObjectID from "./ObjectID";
import UserRole from "./UserRole";

export default interface JSONWebTokenData {
    userId: ObjectID;
    email: Email;
    roles: Array<UserRole>;
    isMasterAdmin: boolean;
}

