import OneUptimeDate from 'Common/Types/Date';
import BadDataException from 'Common/Types/Exception/BadDataException';
import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/SmsCount';
import DatabaseService from './DatabaseService';
import PositiveNumber from 'Common/Types/PositiveNumber';
import User from 'Common/Models/User';
import { MoreThan } from 'typeorm';

export class Service extends DatabaseService<Model> {
    public constructor() {
        super(Model, postgresDatabase);
    }

    public async validateResend(user: User): Promise<boolean> {
        const smsCount: PositiveNumber = await this.countBy({
            query: {
                user: user,
                createdAt: MoreThan(OneUptimeDate.getOneDayAgo()),
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
export default new Service();
