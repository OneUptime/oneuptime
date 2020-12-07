const StatusPageService = require('../services/statusPageService');
// eslint-disable-next-line no-unused-vars
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const apiMiddleware = require('./api');
const ipaddr = require('ipaddr.js');

const _this = {
    ipWhitelist: async function(req, res, next) {
        const statusPageId = apiMiddleware.getStatusPageId(req);
        const statusPage = await StatusPageService.findOneBy({
            _id: statusPageId,
        });
        if (!statusPage.enableIpWhitelist) {
            return next();
        }

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
            // return sendErrorResponse(req, res, {
            //     code: 400,
            //     message: 'You are not allowed to view this page',
            // });
            return next();
        }

        clientIp = clientIp.trim();
        const ipFound = ipWhitelist.some(ip => {
            if (ip.indexOf('-') !== -1) {
                const ipRange = ip.split('-').map(ip => ip.trim());
                return _this.inRange(clientIp, ipRange);
            }

            return _this.check_single_cidr(clientIp, ip);
        });

        if (ipFound) {
            return next();
        }

        // return sendErrorResponse(req, res, {
        //     code: 400,
        //     message: 'You are not allowed to view this page',
        // });
        return next();
    },

    /**
     * @description Gets the ip of the client
     * @param {Object} req Object made available by express
     */
    getClientIp: function(req) {
        // eslint-disable-next-line no-console
        console.log('IP: ');
        // eslint-disable-next-line no-console
        console.log(req.headers);

        let ip =
            req.headers['x-forwarded-for'] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.connection.socket.remoteAddress;

        req.item = req.ip;
        req.ipItem = ip;

        if (!ip) {
            return null;
        }

        ip = ip.split(',')[0];
        ip = ip.split(':').slice(-1); //in case the ip returned in a format: "::ffff:146.xxx.xxx.xxx"
        return ip;
    },

    // https://www.npmjs.com/package/ip-range-check
    check_single_cidr: function(addr, cidr) {
        try {
            const parsed_addr = ipaddr.process(addr);
            if (cidr.indexOf('/') === -1) {
                // handle case when ip is not CIDR
                const parsed_cidr_as_ip = ipaddr.process(cidr);
                if (
                    parsed_addr.kind() === 'ipv6' &&
                    parsed_cidr_as_ip.kind() === 'ipv6'
                ) {
                    return (
                        parsed_addr.toNormalizedString() ===
                        parsed_cidr_as_ip.toNormalizedString()
                    );
                }
                return parsed_addr.toString() == parsed_cidr_as_ip.toString();
            } else {
                const parsed_range = ipaddr.parseCIDR(cidr);
                return parsed_addr.match(parsed_range);
            }
        } catch (e) {
            return false;
        }
    },

    /**
     * @description converts an ip to a normal number, for comparison purposes
     * @param {String} ip a string container an ip address
     */
    IPtoNum: function(ip) {
        return Number(
            ip
                .split('.')
                .map(d => ('000' + d).substr(-3))
                .join('')
        );
    },

    inRange: function(ip, range) {
        const min = _this.IPtoNum(range[0]);
        const max = _this.IPtoNum(range[1]);
        ip = _this.IPtoNum(ip);

        if (isNaN(min) || isNaN(max) || isNaN(ip)) {
            return false;
        }

        return min <= ip && max >= ip;
    },
};

module.exports = _this;
