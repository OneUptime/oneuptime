const StatusPageService = require('../services/statusPageService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const apiMiddleware = require('./api');

const _this = {
    ipWhitelist: async function(req, res, next) {
        const statusPageId = apiMiddleware.getStatusPageId(req);
        const statusPage = await StatusPageService.findOneBy({
            _id: statusPageId,
        });

        const ipWhitelist = statusPage.ipWhitelist
            ? [...statusPage.ipWhitelist]
            : [];
        // no ip whitelist? move to the next express option
        if (!ipWhitelist || ipWhitelist.length === 0) {
            return next();
        }

        let clientIp = _this.getClientIp(req); // returns client ip or null
        if (Array.isArray(clientIp)) {
            clientIp = clientIp[0]; // get the first item on the list
        }

        if (!clientIp) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Client does not have an IP',
            });
        }

        clientIp = clientIp.trim();
        const ipFound = ipWhitelist.some(ip => clientIp === ip);
        //TODO:
        // handle ip ranges eg: if client's ip fall within the ip range
        if (ipFound) {
            return next();
        }

        return sendErrorResponse(req, res, {
            code: 400,
            message: 'You are not allowed to view this page',
        });
    },
    /**
     * @description Gets the ip of the client
     * @param {Object} req Object made available by express
     */
    getClientIp: function(req) {
        let ip =
            req.headers['x-forwarded-for'] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.connection.socket.remoteAddress;

        if (!ip) {
            return null;
        }

        ip = ip.split(',')[0];
        ip = ip.split(':').slice(-1); //in case the ip returned in a format: "::ffff:146.xxx.xxx.xxx"
        return ip;
    },
};

module.exports = _this;
