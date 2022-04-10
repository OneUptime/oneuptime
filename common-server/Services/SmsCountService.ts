import OneUptimeDate from 'common/types/Date';
import BadDataException from 'common/types/exception/BadDataException';
import Model, { requiredFields, uniqueFields } from '../Models/SmsCount';
import DatabaseService from './DatabaseService';

export default class SslService extends DatabaseService<typeof Model> {
    constructor() {
        super({
            model: Model,
            requiredFields: requiredFields,
            uniqueFields: uniqueFields,
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
            isResourceByProject: false,
            slugifyField: '',
        });
    }

    async validateResend(userId: string) {
        const smsCount = await this.countBy({
            query: {
                userId: userId,
                createdAt: {
                    $gt: OneUptimeDate.getOneDayAgo(),
                },
            },
        });

        if (smsCount.toNumber() > 3) {
            throw new BadDataException(
                `You have exhausted the maximum limit of sms resends in a day. Please try tomorrow.`
            );
        }

        return true;
    }
}
