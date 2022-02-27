import JsonToCsv from './jsonToCsv';

export default {
    sendEmptyResponse(req: $TSFixMe, res: $TSFixMe) {
        return res.status(200).send();
    },

    sendErrorResponse: function(req: $TSFixMe, res: $TSFixMe, error: $TSFixMe) {
        // eslint-disable-next-line no-console
        console.error(error);

        if (error.statusCode && error.message) {
            res.resBody = { message: error.message };
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

        if (req.query['output-type'] === 'csv') {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
            if (!Array.isArray(response.data)) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
                const properties = Object.keys(response.data);
                const newObj = {};
                properties.forEach(prop => {
                    if (
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
                        typeof response.data[[prop]] === 'object' &&
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
                        response.data[[prop]] !== null
                    ) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
                        if (response.data[[prop]].name)
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
                            response.data[[prop]] = response.data[[prop]].name;
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
                        else if (response.data[[prop]].title)
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
                            response.data[[prop]] = response.data[[prop]].title;
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
                        else if (response.data[[prop]]._id)
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
                            response.data[[prop]] = response.data[[prop]]._id;
                    }
                    // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                    newObj[[prop]] = response.data[[prop]];
                });
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
                response.data = JSON.parse(JSON.stringify(newObj));
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
                response.data = [response.data];
            } else {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
                response.data = response.data.map((i: $TSFixMe) => {
                    i = i._doc ? i._doc : i;
                    const properties = Object.keys(i);
                    const newObj = {};
                    properties.forEach(prop => {
                        if (
                            // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                            typeof i[[prop]] === 'object' &&
                            // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                            i[[prop]] !== null
                        ) {
                            // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                            if (i[[prop]].name) i[[prop]] = i[[prop]].name;
                            // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                            else if (i[[prop]].title)
                                // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                                i[[prop]] = i[[prop]].title;
                            // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                            else if (i[[prop]]._id) i[[prop]] = i[[prop]]._id;
                        }
                        // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                        newObj[[prop]] = i[[prop]];
                    });
                    return JSON.parse(JSON.stringify(newObj));
                });
            }

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type '{}'.
            response.data = await JsonToCsv.ToCsv(response.data);
        }

        res.resBody = response;

        return res.status(200).send(response);
    },

    async sendItemResponse(req: $TSFixMe, res: $TSFixMe, item: $TSFixMe) {
        if (req.query['output-type'] === 'csv') {
            if (!Array.isArray(item)) {
                const properties = Object.keys(item);
                const newObj = {};
                properties.forEach(prop => {
                    if (
                        // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                        typeof item[[prop]] === 'object' &&
                        // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                        item[[prop]] !== null
                    ) {
                        // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                        if (item[[prop]].name) item[[prop]] = item[[prop]].name;
                        // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                        else if (item[[prop]].title)
                            // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                            item[[prop]] = item[[prop]].title;
                        // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                        else if (item[[prop]]._id)
                            // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                            item[[prop]] = item[[prop]]._id;
                    }
                    // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
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
                            // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                            typeof i[[prop]] === 'object' &&
                            // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                            i[[prop]] !== null
                        ) {
                            // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                            if (i[[prop]].name) i[[prop]] = i[[prop]].name;
                            // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                            else if (i[[prop]].title)
                                // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                                i[[prop]] = i[[prop]].title;
                            // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                            else if (i[[prop]]._id) i[[prop]] = i[[prop]]._id;
                        }
                        // @ts-expect-error ts-migrate(2538) FIXME: Type 'string[]' cannot be used as an index type.
                        newObj[[prop]] = i[[prop]];
                    });
                    return JSON.parse(JSON.stringify(newObj));
                });
            }
            item = await JsonToCsv.ToCsv(item);
        }

        res.resBody = item;

        return res.status(200).send(item);
    },
};
