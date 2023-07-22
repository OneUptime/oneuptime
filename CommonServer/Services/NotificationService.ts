import { IsBillingEnabled } from '../Config';
import ObjectID from 'Common/Types/ObjectID';
import Project from 'Model/Models/Project';
import ProjectService from './ProjectService';
import BillingService from './BillingService';
import logger from '../Utils/Logger';
import BadDataException from 'Common/Types/Exception/BadDataException';
import BaseService from './BaseService';

export class NotificationService extends BaseService {
    public constructor() {
        super();
    }

    public async rechargeBalance(
        projectId: ObjectID,
        amountInUSD: number
    ): Promise<number> {
        const project: Project | null = await ProjectService.findOneById({
            id: projectId,
            select: {
                smsOrCallCurrentBalanceInUSDCents: true,
                enableAutoRechargeSmsOrCallBalance: true,
                enableSmsNotifications: true,
                autoRechargeSmsOrCallByBalanceInUSD: true,
                autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: true,
                paymentProviderCustomerId: true,
                name: true,
                failedCallAndSMSBalanceChargeNotificationSentToOwners: true,
            },
            props: {
                isRoot: true,
            },
        });

        if (!project) {
            return 0;
        }

        try {
            if (
                !(await BillingService.hasPaymentMethods(
                    project.paymentProviderCustomerId!
                ))
            ) {
                if (
                    !project.failedCallAndSMSBalanceChargeNotificationSentToOwners
                ) {
                    await ProjectService.updateOneById({
                        data: {
                            failedCallAndSMSBalanceChargeNotificationSentToOwners:
                                true,
                        },
                        id: project.id!,
                        props: {
                            isRoot: true,
                        },
                    });
                    await ProjectService.sendEmailToProjectOwners(
                        project.id!,
                        'ACTION REQUIRED: SMS and Call Recharge Failed for project - ' +
                            (project.name || ''),
                        `We have tried to recharge your SMS and Call balance for project - ${
                            project.name || ''
                        } and failed. We could not find a payment method for the project. Please add a payment method in project settings.`
                    );
                }
                throw new BadDataException(
                    'No payment methods found for the project. Please add a payment method in project settings to continue.'
                );
            }

            // recharge balance
            const updatedAmount: number = Math.floor(
                (project.smsOrCallCurrentBalanceInUSDCents || 0) +
                    amountInUSD * 100
            );

            // If the recharge is succcessful, then update the project balance.
            await BillingService.genrateInvoiceAndChargeCustomer(
                project.paymentProviderCustomerId!,
                'SMS or Call Balance Recharge',
                amountInUSD
            );

            await ProjectService.updateOneById({
                data: {
                    smsOrCallCurrentBalanceInUSDCents: updatedAmount,
                    failedCallAndSMSBalanceChargeNotificationSentToOwners:
                        false, // reset this flag
                    lowCallAndSMSBalanceNotificationSentToOwners: false, // reset this flag
                    notEnabledSmsOrCallNotificationSentToOwners: false,
                },
                id: project.id!,
                props: {
                    isRoot: true,
                },
            });

            await ProjectService.sendEmailToProjectOwners(
                project.id!,
                'SMS and Call Recharge Successful for project - ' +
                    (project.name || ''),
                `We have successfully recharged your SMS and Call balance for project - ${
                    project.name || ''
                } by ${amountInUSD} USD. Your current balance is ${
                    updatedAmount / 100
                } USD.`
            );

            project.smsOrCallCurrentBalanceInUSDCents = updatedAmount;

            return updatedAmount;
        } catch (err) {
            await ProjectService.updateOneById({
                data: {
                    failedCallAndSMSBalanceChargeNotificationSentToOwners: true,
                },
                id: project.id!,
                props: {
                    isRoot: true,
                },
            });
            await ProjectService.sendEmailToProjectOwners(
                project.id!,
                'ACTION REQUIRED: SMS and Call Recharge Failed for project - ' +
                    (project.name || ''),
                `We have tried recharged your SMS and Call balance for project - ${
                    project.name || ''
                } and failed. Please make sure your payment method is upto date and has sufficient balance. You can add new payment methods in project settings.`
            );
            logger.error(err);
            throw err;
        }
    }

    public async rechargeIfBalanceIsLow(
        projectId: ObjectID,
        options?: {
            autoRechargeSmsOrCallByBalanceInUSD: number;
            autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: number;
            enableAutoRechargeSmsOrCallBalance: boolean;
        }
    ): Promise<number> {
        let project: Project | null = null;
        if (projectId && IsBillingEnabled) {
            // check payment methods.

            project = await ProjectService.findOneById({
                id: projectId,
                select: {
                    smsOrCallCurrentBalanceInUSDCents: true,
                    enableAutoRechargeSmsOrCallBalance: true,
                    autoRechargeSmsOrCallByBalanceInUSD: true,
                    autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: true,
                },
                props: {
                    isRoot: true,
                },
            });

            const autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: number =
                options?.autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD ||
                project?.autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD ||
                0;
            const autoRechargeSmsOrCallByBalanceInUSD: number =
                options?.autoRechargeSmsOrCallByBalanceInUSD ||
                project?.autoRechargeSmsOrCallByBalanceInUSD ||
                0;

            const enableAutoRechargeSmsOrCallBalance: boolean = options
                ? options.enableAutoRechargeSmsOrCallBalance
                : project?.enableAutoRechargeSmsOrCallBalance || false;

            if (!project) {
                return 0;
            }

            if (
                enableAutoRechargeSmsOrCallBalance &&
                autoRechargeSmsOrCallByBalanceInUSD &&
                autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD
            ) {
                if (
                    (project.smsOrCallCurrentBalanceInUSDCents || 0) / 100 <
                    autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD
                ) {
                    const updatedAmount: number = await this.rechargeBalance(
                        projectId,
                        autoRechargeSmsOrCallByBalanceInUSD
                    );
                    project.smsOrCallCurrentBalanceInUSDCents = updatedAmount;
                }
            }
        }

        return project?.smsOrCallCurrentBalanceInUSDCents || 0;
    }
}

export default new NotificationService();
