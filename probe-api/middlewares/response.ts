export default {
    sendErrorResponse: function(req: $TSFixMe, res: $TSFixMe, error: $TSFixMe) {
        //log error to the console.
        // eslint-disable-next-line no-console
        console.error(error);

        if (error.statusCode && error.message) {
            res.resBody = { message: error.message }; // To be used in 'auditLog' middleware to log reponse data;
            return res
                .status(error.statusCode)
                .send({ message: error.message });
        } else if (
            error.code &&
            error.message &&
            typeof error.code === 'number'
        ) {
            let status = error.code;
            if (
                error.code &&
                error.status &&
                typeof error.code === 'number' &&
                typeof error.status === 'number' &&
                error.code > 600
            ) {
                status = error.status;
            }
            res.resBody = { message: error.message };
            return res.status(status).send({ message: error.message });
        } else {
            res.resBody = { message: 'Server Error.' };
            return res.status(500).send({ message: 'Server Error.' });
        }
    },

    sendListResponse: async function(
        req: $TSFixMe,
        res: $TSFixMe,
        list: $TSFixMe,
        count: $TSFixMe
    ) {
        // remove __v, deleted, deletedAt and deletedById if not Master Admin
        const response = {};

        if (!list) {
            list = [];
        }

        if (list) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
            response.data = list;
        }

        if (count) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type '{}'.
            response.count = count;
        } else {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'count' does not exist on type '{}'.
            if (list) response.count = list.length;
        }

        if (req.query.skip) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'skip' does not exist on type '{}'.
            response.skip = parseInt(req.query.skip);
        }

        if (req.query.limit) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'limit' does not exist on type '{}'.
            response.limit = parseInt(req.query.limit);
        }

        res.resBody = response; // To be used in 'auditLog' middleware to log reponse data;

        return res.status(200).send(response);
    },
};
