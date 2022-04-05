import LoginHistoryModel from 'common-server/models/loginIPLog';
import DeviceDetector from 'node-device-detector';
import MailService from '../services/mailService';
import UserService from '../services/userService';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
import FindBy from 'common-server/types/db/FindBy';

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

        MailService.sendLoginEmail(
            user.email,
            ipLocation,
            result,
            user.twoFactorEnabled,
            status
        );
    },
    async findBy({ query, skip, limit, select, populate, sort }: FindBy) {
        let logsQuery = LoginHistoryModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

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
