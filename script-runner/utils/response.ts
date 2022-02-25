export default {
    sendSuccessResponse: function(req, res, data) {
        return res.status(200).send(data);
    },
    sendErrorResponse: function(req, res, error) {
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
