import Express from 'common-server/utils/express';
const express = Express.getLibrary();

export default {
    sendSuccessResponse: function (
        req: $TSFixMe,
        res: $TSFixMe,
        data: $TSFixMe
    ) {
        return res.status(200).send(data);
    },
    sendErrorResponse: function (
        req: express.Request,
        res: express.Response,
        error: $TSFixMe
    ) {
        if (
            error.message &&
            error.code !== 'ENOTFOUND' &&
            error.code !== 'ECONNREFUSED'
        ) {
            return res
                .status(error.code || 400)
                .send({ message: error.message });
        } else if (
            error.code === 'ENOTFOUND' ||
            error.code === 'ECONNREFUSED'
        ) {
            return res.status(400).send({ message: error.message });
        } else {
            return res.status(500).send({ message: 'Server Error.' });
        }
    },
};
