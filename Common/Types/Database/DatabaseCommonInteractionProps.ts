import ObjectID from '../ObjectID';
import { UserGlobalAccessPermission, UserProjectAccessPermission } from '../Permission';
import UserType from '../UserType';

export default interface DatabaseCommonInteractionProps {
    userId?: ObjectID | undefined;
    userGlobalAccessPermission?: UserGlobalAccessPermission | undefined;
    userProjectAccessPermission?: UserProjectAccessPermission | undefined;
    userType?: UserType | undefined;
    projectId?: ObjectID | undefined;
    isRoot?: boolean | undefined;
}
