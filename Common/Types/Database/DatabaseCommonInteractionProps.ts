import ObjectID from '../ObjectID';
import {
    UserGlobalAccessPermission,
    UserProjectAccessPermission,
} from '../Permission';
import UserType from '../UserType';

export default interface DatabaseCommonInteractionProps {
    userId?: ObjectID | undefined;
    userGlobalAccessPermission?: UserGlobalAccessPermission | undefined;
    userProjectAccessPermission?: UserProjectAccessPermission | undefined;
    userType?: UserType | undefined;
    tenantId?: ObjectID | undefined;
    isRoot?: boolean | undefined;
    isMultiTenantQuery?: boolean | undefined;
}
