import { EVERY_DAY, EVERY_MINUTE } from '../../Utils/CronTime';
import RunCron from '../../Utils/Cron';
import ProjectService from 'CommonServer/Services/ProjectService';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import Project from 'Model/Models/Project';
import BillingService from 'CommonServer/Services/BillingService';
import { IsBillingEnabled, IsDevelopment } from 'CommonServer/Config';
import logger from 'CommonServer/Utils/Logger';
import Sleep from 'Common/Types/Sleep';

RunCron(
    'PaymentProvider:CheckSubscriptionStatus',
    { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY, runOnStartup: true },
    async () => {
        // get all projects.
        if (!IsBillingEnabled) {
            return;
        }

        const projects: Array<Project> = await ProjectService.findBy({
            query: {},
            select: {
                _id: true,
                paymentProviderSubscriptionId: true,
                paymentProviderCustomerId: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
                isRoot: true,
                ignoreHooks: true,
            },
        });

        for (const project of projects) {
            try {
                if (project.paymentProviderSubscriptionId) {
                    // get subscription detail.
                    const subscriptionState: string =
                        await BillingService.getSubscriptionStatus(
                            project.paymentProviderSubscriptionId as string
                        );

                    await ProjectService.updateOneById({
                        id: project.id!,
                        data: {
                            paymentProviderSubscriptionStatus:
                                subscriptionState,
                        },
                        props: {
                            isRoot: true,
                            ignoreHooks: true,
                        },
                    });

                    // after every subscription fetch, sleep for a 5 seconds to avoid stripe rate limit.
                    await Sleep.sleep(5000);
                }
            } catch (err) {
                logger.error(err);
            }
        }
    }
);
