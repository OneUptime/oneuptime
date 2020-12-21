/* eslint-disable no-console */
/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    sendEmptyResponse(req, res) {
        //purge request.
        //req = null;
        return res.status(200).send();
    },

    sendErrorResponse: function(req, res, error) {
        //log error to the console.
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
            res.resBody = { message: error.message };
            return res.status(error.code).send({ message: error.message });
        } else if (error instanceof mongoose.Error.CastError) {
            res.resBody = { code: 400, message: 'Input data schema mismatch.' };
            return res
                .status(400)
                .send({ code: 400, message: 'Input data schema mismatch.' });
        } else {
            res.resBody = { message: 'Server Error.' };
            return res.status(500).send({ message: 'Server Error.' });
        }
    },

    async sendItemResponse(req, res, item) {
        // remove __v, deleted, deletedAt and deletedById if not Master Admin
        if (req.authorizationType !== 'MASTER-ADMIN') {
            if (Array.isArray(item)) {
                item = item.map(field =>
                    typeof field === 'object' && field !== null
                        ? filterKeys(field)
                        : field
                );
            } else if (typeof list === 'object' && item !== null) {
                item = filterKeys(item);
            }
        }

        if (req.query['output-type'] === 'csv') {
            if (!Array.isArray(item)) {
                const properties = Object.keys(item);
                const newObj = {};
                properties.forEach(prop => {
                    if (
                        typeof item[[prop]] === 'object' &&
                        item[[prop]] !== null
                    ) {
                        if (item[[prop]].name) item[[prop]] = item[[prop]].name;
                        else if (item[[prop]].title)
                            item[[prop]] = item[[prop]].title;
                        else if (item[[prop]]._id)
                            item[[prop]] = item[[prop]]._id;
                    }
                    newObj[[prop]] = item[[prop]];
                });
                item = JSON.parse(JSON.stringify(newObj));
                item = [item];
            } else {
                item = item.map(i => {
                    i = i._doc ? i._doc : i;
                    const properties = Object.keys(i);
                    const newObj = {};
                    properties.forEach(prop => {
                        if (
                            typeof i[[prop]] === 'object' &&
                            i[[prop]] !== null
                        ) {
                            if (i[[prop]].name) i[[prop]] = i[[prop]].name;
                            else if (i[[prop]].title)
                                i[[prop]] = i[[prop]].title;
                            else if (i[[prop]]._id) i[[prop]] = i[[prop]]._id;
                        }
                        newObj[[prop]] = i[[prop]];
                    });
                    return JSON.parse(JSON.stringify(newObj));
                });
            }
            item = await JsonToCsv.ToCsv(item);
        }

        res.resBody = item; // To be used in 'auditLog' middleware to log reponse data;

        return res.status(200).send(item);
    },
};
