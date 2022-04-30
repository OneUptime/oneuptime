import OneUptimeDate from 'Common/Types/Date';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Model from 'Common/Models/SmsCount';
import DatabaseService from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Query from '../Types/DB/Query';

class Service extends DatabaseService<typeof Model> {
    public constructor() {
        super({
            model: Model,

            friendlyName: 'SMS Count',
            publicListProps: {
                populate: [],
                select: [],
            },
            adminListProps: {
                populate: [],
                select: [],
            },
            ownerListProps: {
                populate: [],
                select: [],
            },
            memberListProps: {
                populate: [],
                select: [],
            },
            viewerListProps: {
                populate: [],
                select: [],
            },
            publicItemProps: {
                populate: [],
                select: [],
            },
            adminItemProps: {
                populate: [],
                select: [],
            },
            memberItemProps: {
                populate: [],
                select: [],
            },
            viewerItemProps: {
                populate: [],
                select: [],
            },
            ownerItemProps: {
                populate: [],
                select: [],
            },
        });
    }

    public async validateResend(userId: ObjectID): Promise<boolean> {
        const smsCount: PositiveNumber = await this.countBy({
            query: new Query()
                .equalTo('userId', userId)
                .greaterThan('createdAt', OneUptimeDate.getOneDayAgo()),
        });

        if (smsCount.toNumber() > 3) {
            throw new BadDataException(
                `You have exhausted the maximum limit of sms resends in a day. Please try tomorrow.`
            );
        }

        return true;
    }
}

export default Service;
