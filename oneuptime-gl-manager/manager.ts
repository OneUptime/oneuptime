import axios from 'axios';
const BASE_URL = `${process.env.BACKEND_PROTOCOL}://${process.env['ONEUPTIME_HOST']}`;

const Manager = module.exports;

//eslint-disable-next-line unused-imports/no-unused-vars
Manager.create = function (opts: $TSFixMe) {
    const manager = {};

    //
    // REQUIRED (basic issuance)
    //

    manager.get = async function ({ servername }: $TSFixMe) {
        const url = `${BASE_URL}/api/manager/site?servername=${servername}`;
        const response = await axios({
            url,
            method: 'get',
        });

        return response.data;
    };

    //
    // REQUIRED (basic issuance)
    //

    manager.set = async function (opts: $TSFixMe) {
        const url = `${BASE_URL}/api/manager/site?subject=${opts.subject}`;
        const response = await axios({
            url,
            method: 'put',
            data: opts,
        });

        return response.data;
    };

    //
    // Optional (Fully Automatic Renewal)
    //

    manager.find = async function (opts: $TSFixMe) {
        // { subject, servernames, altnames, renewBefore }
        if (opts.subject) {
            const url = `${BASE_URL}/api/manager/site?subject=${opts.subject}`;
            const response = await axios({
                url,
                method: 'get',
            });
            if (!response.data || response.data.length === 0) {
                return [];
            }

            return [response.data];
        }

        if (Array.isArray(opts.servernames) && opts.servernames.length > 0) {
            const url = `${BASE_URL}/api/manager/site/servernames`;
            const response = await axios({
                url,
                method: 'post',
                data: opts.servernames,
            });

            return response.data;
        }

        // i.e. find certs more than 30 days old as default
        opts.issuedBefore =
            opts.issuedBefore || Date.now() - 30 * 24 * 60 * 60 * 1000;
        // i.e. find certs that will expire in less than 45 days as default
        opts.expiresBefore =
            opts.expiresBefore || Date.now() + 45 * 24 * 60 * 60 * 1000;
        // i.e. find certs that should be renewed within 21 days as default
        opts.renewBefore =
            opts.renewBefore || Date.now() + 21 * 24 * 60 * 60 * 1000;

        const url = `${BASE_URL}/api/manager/site/opts`;
        const response = await axios({
            url,
            method: 'post',
            data: opts,
        });

        return response.data;
    };

    //
    // Optional (Special Remove Functionality)
    // The default behavior is to set `deletedAt`
    //

    manager.remove = async function (opts: $TSFixMe) {
        const url = `${BASE_URL}/api/manager/site?subject=${opts.subject}`;
        const response = await axios({
            url,
            method: 'delete',
        });

        return response.data;
    };

    //
    // Optional (special settings save)
    // Implemented here because this module IS the fallback
    // This is a setter/getter function
    //

    manager.defaults = async function (opts: $TSFixMe) {
        if (!opts) {
            const url = `${BASE_URL}/api/manager/default`;
            const response = await axios({
                url,
                method: 'get',
            });
            return response.data ? response.data : {};
        }

        const url = `${BASE_URL}/api/manager/default`;
        const response = await axios({
            url,
            method: 'put',
            data: opts,
        });

        return response.data || {};
    };

    return manager;
};
