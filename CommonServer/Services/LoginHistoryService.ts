import LoginHistoryModel from '../Models/loginIPLog';
import DeviceDetector from 'node-device-detector';
import MailService from '../../MailService/Services/MailService';
import UserService from './UserService';

import FindBy from '../Types/DB/FindBy';

export default class Service {
    async create(
        user: $TSFixMe,
        clientIP: $TSFixMe,
        userAgent: $TSFixMe,
        status: $TSFixMe
    ): void {
        const detector: $TSFixMe = new DeviceDetector();
        const result: $TSFixMe = detector.detect(userAgent);
        const ipLocation: $TSFixMe = await UserService.getUserIpLocation(
            clientIP
        );
        await LoginHistoryModel.create({
            userId: user._id,
            ipLocation,
            device: result,
            status,
        });

        MailService.sendLoginEmail(
            user.email,
            ipLocation,
            result,
            user.twoFactorEnabled,
            status
        );
    }

    async findBy({ query, skip, limit, select, populate, sort }: FindBy): void {
        const logsQuery: $TSFixMe = LoginHistoryModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        logsQuery.select(select);
        logsQuery.populate(populate);

        const [logs, count]: $TSFixMe = await Promise.all([
            logsQuery,
            LoginHistoryModel.countDocuments(query),
        ]);
        const response: $TSFixMe = { logs, skip, limit, count };
        return response;
    }
}
