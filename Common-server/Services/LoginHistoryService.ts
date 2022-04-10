import LoginHistoryModel from '../Models/loginIPLog';
import DeviceDetector from 'node-device-detector';
import MailService from './MailService';
import UserService from './UserService';

import FindBy from '../Types/DB/FindBy';

export default class Service {
    async create(
        user: $TSFixMe,
        clientIP: $TSFixMe,
        userAgent: $TSFixMe,
        status: $TSFixMe
    ) {
        const detector = new DeviceDetector();
        const result = detector.detect(userAgent);
        const ipLocation = await UserService.getUserIpLocation(clientIP);
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

    async findBy({ query, skip, limit, select, populate, sort }: FindBy) {
        const logsQuery = LoginHistoryModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        logsQuery.select(select);
        logsQuery.populate(populate);

        const [logs, count] = await Promise.all([
            logsQuery,
            LoginHistoryModel.countDocuments(query),
        ]);
        const response = { logs, skip, limit, count };
        return response;
    }
}
