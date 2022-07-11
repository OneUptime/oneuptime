import ObjectID from '../ObjectID';
import Permission from '../Permission';
import UserType from "../UserType";

export default interface DatabaseCommonInteractionProps {
    userId?: ObjectID | undefined;
    userPermissions?: Array<Permission>;
    userType?: UserType | undefined;
    projectId?: ObjectID | undefined;
    isRoot?: boolean | undefined; 
}
