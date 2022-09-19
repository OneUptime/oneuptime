import ObjectID from '../ObjectID';
import {
    UserGlobalAccessPermission,
    UserTenantAccessPermission,
} from '../Permission';
import UserType from '../UserType';

export default interface DatabaseCommonInteractionProps {
    userId?: ObjectID | undefined;
    userGlobalAccessPermission?: UserGlobalAccessPermission | undefined;
    userTenantAccessPermission?: UserTenantAccessPermission | undefined;
    userType?: UserType | undefined;
    tenantId?: ObjectID | undefined;
    isRoot?: boolean | undefined;
    isMultiTenantRequest?: boolean | undefined;
}
