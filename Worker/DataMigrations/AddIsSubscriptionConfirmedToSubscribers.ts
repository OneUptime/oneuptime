import DataMigrationBase from "./DataMigrationBase";
import NumberUtil from "Common/Utils/Number";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";

export default class AddIsSubscriptionConfirmedToSubscribers extends DataMigrationBase {
    public constructor() {
        super("AddIsSubscriptionConfirmedToSubscribers");
    }

    public override async migrate(): Promise<void> {
        // get all the users with email isVerified true.

        const subscribers: Array<StatusPageSubscriber> = await StatusPageSubscriberService.findBy({
            query: {},
            select: {
                _id: true,
            },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
                isRoot: true,
            },
        });

        for (const subscriber of subscribers) {
            // update subscriber with isSubscriptionConfirmed true.
            await StatusPageSubscriberService.updateOneById({
                id: subscriber.id!,
                data: {
                    isSubscriptionConfirmed: true,
                    subscriptionConfirmationToken: NumberUtil.getRandomNumber(100000, 999999).toString(),
                },
                props: {
                    isRoot: true,
                }
            });
        }
    }

    public override async rollback(): Promise<void> {
        return;
    }
}
