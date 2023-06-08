import { IsBillingEnabled } from '../Config';
import ObjectID from 'Common/Types/ObjectID';
import Project from 'Model/Models/Project';
import ProjectService from './ProjectService';
import BillingService from './BillingService';
import logger from '../Utils/Logger';
import BadDataException from 'Common/Types/Exception/BadDataException';

export default class NotificationService {
    public static async rechargeIfBalanceIsLow(
        projectId: ObjectID
    ): Promise<number> {
        let project: Project | null = null;
        if (projectId && IsBillingEnabled) {
            // check payment methods.

            project = await ProjectService.findOneById({
                id: projectId,
                select: {
                    smsOrCallCurrentBalanceInUSDCents: true,
                    enableAutoRechargeSmsOrCallBalance: true,
                    enableSmsNotifications: true,
                    autoRechargeSmsOrCallByBalanceInUSD: true,
                    autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: true,
                    paymentProviderCustomerId: true,
                },
                props: {
                    isRoot: true,
                },
            });

            if (!project) {
                return 0;
            }

            if (
                !(await BillingService.hasPaymentMethods(
                    project.paymentProviderCustomerId!
                ))
            ) {
                throw new BadDataException(
                    'No payment methods found for the project. Please add a payment method in project settings to continue.'
                );
            }

            if (
                project.enableAutoRechargeSmsOrCallBalance &&
                project.autoRechargeSmsOrCallByBalanceInUSD &&
                project.autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD
            ) {
                if (
                    project.smsOrCallCurrentBalanceInUSDCents &&
                    project.smsOrCallCurrentBalanceInUSDCents <
                        project.autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD
                ) {
                    try {
                        // recharge balance
                        const updatedAmount: number = Math.floor(
                            project.smsOrCallCurrentBalanceInUSDCents +
                                project.autoRechargeSmsOrCallByBalanceInUSD *
                                    100
                        );

                        // If the recharge is succcessful, then update the project balance.
                        await BillingService.genrateInvoiceAndChargeCustomer(
                            project.paymentProviderCustomerId!,
                            'SMS or Call Balance Recharge',
                            project.autoRechargeSmsOrCallByBalanceInUSD
                        );

                        await ProjectService.updateOneById({
                            data: {
                                smsOrCallCurrentBalanceInUSDCents:
                                    updatedAmount,
                            },
                            id: project.id!,
                            props: {
                                isRoot: true,
                            },
                        });

                        project.smsOrCallCurrentBalanceInUSDCents =
                            updatedAmount;

                        // TODO: Send an email on successful recharge.
                    } catch (err) {
                        // TODO: if the recharge fails, then send email to the user.
                        logger.error(err);
                    }
                }
            }
        }

        return project?.smsOrCallCurrentBalanceInUSDCents || 0;
    }
}
