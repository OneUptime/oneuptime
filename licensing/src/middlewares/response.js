module.exports = {
    sendErrorResponse: function(req, res, error) {
        if (error.statusCode && error.message) {
            res.resBody = { message: error.message };
            return res
                .status(error.statusCode)
                .send({ message: error.message });
        }
    },
    sendConfirmationResponse(req, res, token) {
        return res.status(200).send(token);
    }
};
