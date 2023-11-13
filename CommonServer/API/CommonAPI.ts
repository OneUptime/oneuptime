import { IsBillingEnabled } from '../EnvironmentConfig';
import ProjectService from '../Services/ProjectService';
import { PlanSelect } from 'Common/Types/Billing/SubscriptionPlan';
import UserType from 'Common/Types/UserType';
import { ExpressRequest, OneUptimeRequest } from '../Utils/Express';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';

export default class CommonAPI {
    public static async  getDatabaseCommonInteractionProps(
        req: ExpressRequest
    ): Promise<DatabaseCommonInteractionProps> {
        const props: DatabaseCommonInteractionProps = {
            tenantId: undefined,
            userGlobalAccessPermission: undefined,
            userTenantAccessPermission: undefined,
            userId: undefined,
            userType: (req as OneUptimeRequest).userType,
            isMultiTenantRequest: undefined,
        };

        if (
            (req as OneUptimeRequest).userAuthorization &&
            (req as OneUptimeRequest).userAuthorization?.userId
        ) {
            props.userId = (req as OneUptimeRequest).userAuthorization!.userId;
        }

        if ((req as OneUptimeRequest).userGlobalAccessPermission) {
            props.userGlobalAccessPermission = (
                req as OneUptimeRequest
            ).userGlobalAccessPermission;
        }

        if ((req as OneUptimeRequest).userTenantAccessPermission) {
            props.userTenantAccessPermission = (
                req as OneUptimeRequest
            ).userTenantAccessPermission;
        }

        if ((req as OneUptimeRequest).tenantId) {
            props.tenantId = (req as OneUptimeRequest).tenantId || undefined;
        }

        if (req.headers['is-multi-tenant-query']) {
            props.isMultiTenantRequest = true;
        }

        if (IsBillingEnabled && props.tenantId) {
            const plan: {
                plan: PlanSelect | null;
                isSubscriptionUnpaid: boolean;
            } = await ProjectService.getCurrentPlan(props.tenantId!);
            props.currentPlan = plan.plan || undefined;
            props.isSubscriptionUnpaid = plan.isSubscriptionUnpaid;
        }

        // check for root permissions.

        if (props.userType === UserType.MasterAdmin) {
            props.isMasterAdmin = true;
        }

        return props;
    }
}