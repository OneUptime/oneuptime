module.exports = {
    sendEmptyResponse(req, res) {
        //purge request.
        //req = null;
        return res.status(200).send();
    },

    sendErrorResponse: function(req, res, error) {
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
};
