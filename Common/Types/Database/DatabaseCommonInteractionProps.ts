import type { PlanSelect } from '../Billing/SubscriptionPlan';
import type Dictionary from '../Dictionary';
import type ObjectID from '../ObjectID';
import type {
    UserGlobalAccessPermission,
    UserTenantAccessPermission,
} from '../Permission';
import type UserType from '../UserType';

export default interface DatabaseCommonInteractionProps {
    userId?: ObjectID | undefined;
    userGlobalAccessPermission?: UserGlobalAccessPermission | undefined;
    userTenantAccessPermission?:
        | Dictionary<UserTenantAccessPermission> // tenantId <-> UserTenantAccessPermission
        | undefined;
    userType?: UserType | undefined;
    tenantId?: ObjectID | undefined;
    isRoot?: boolean | undefined;
    isMultiTenantRequest?: boolean | undefined;
    ignoreHooks?: boolean | undefined;
    currentPlan?: PlanSelect | undefined;
    isSubscriptionUnpaid?: boolean | undefined;
}
