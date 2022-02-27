export default {
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

        try {
            MailService.sendLoginEmail(
                user.email,
                ipLocation,
                result,
                user.twoFactorEnabled,
                status
            );
        } catch (error) {
            ErrorService.log('mailService.sendLoginEmail', error);
        }
    },
    async findBy({ query, skip, limit, select, populate }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        let logsQuery = LoginHistoryModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        logsQuery = handleSelect(select, logsQuery);
        logsQuery = handlePopulate(populate, logsQuery);

        const [logs, count] = await Promise.all([
            logsQuery,
            LoginHistoryModel.countDocuments(query),
        ]);
        const response = { logs, skip, limit, count };
        return response;
    },
};

import LoginHistoryModel from '../models/loginIPLog';
import ErrorService from 'common-server/utils/error';
import DeviceDetector from 'node-device-detector';
import MailService from '../services/mailService';
import UserService from '../services/userService';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
