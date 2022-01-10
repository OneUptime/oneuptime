/**
 *
 * Copyright HackerBay, Inc.
 *
 */
const JsonToCsv = require('./jsonToCsv');

module.exports = {
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

    sendListResponse: async function(req, res, list, count) {
        // remove __v, deleted, deletedAt and deletedById if not Master Admin
        const response = {};

        if (!list) {
            list = [];
        }

        if (list) {
            response.data = list;
        }

        if (count) {
            response.count = count;
        } else {
            if (list) response.count = list.length;
        }

        if (req.query.skip) {
            response.skip = parseInt(req.query.skip);
        }

        if (req.query.limit) {
            response.limit = parseInt(req.query.limit);
        }

        //purge request.
        //req = null;
        if (req.query['output-type'] === 'csv') {
            if (!Array.isArray(response.data)) {
                const properties = Object.keys(response.data);
                const newObj = {};
                properties.forEach(prop => {
                    if (
                        typeof response.data[[prop]] === 'object' &&
                        response.data[[prop]] !== null
                    ) {
                        if (response.data[[prop]].name)
                            response.data[[prop]] = response.data[[prop]].name;
                        else if (response.data[[prop]].title)
                            response.data[[prop]] = response.data[[prop]].title;
                        else if (response.data[[prop]]._id)
                            response.data[[prop]] = response.data[[prop]]._id;
                    }
                    newObj[[prop]] = response.data[[prop]];
                });
                response.data = JSON.parse(JSON.stringify(newObj));
                response.data = [response.data];
            } else {
                response.data = response.data.map(i => {
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

            response.data = await JsonToCsv.ToCsv(response.data);
        }

        res.resBody = response; // To be used in 'auditLog' middleware to log reponse data;

        return res.status(200).send(response);
    },
};
