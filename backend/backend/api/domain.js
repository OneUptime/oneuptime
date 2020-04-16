const express = require('express');
const dns = require('dns');
const flat = require('../utils/flattenArray');
const { getUser } = require('../middlewares/user');
const { isAuthorized } = require('../middlewares/authorization');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const StatusPageService = require('../services/statusPageService');

const router = express.Router();

router.put(
    '/:projectId/:statusPageId/verify/:domainId',
    getUser,
    isAuthorized,
    (req, res) => {
        let { domain, verificationToken } = req.body;
        const { statusPageId, domainId } = req.params;

        try {
            dns.resolveTxt(domain, async (err, records) => {
                if (err) {
                    let errorMsg = `error looking up TXT record: ${err.message}`;
                    return sendErrorResponse(req, res, {
                        message: errorMsg,
                        code: 400,
                    });
                }
                // records is an array of arrays
                // flatten the array to a single array
                let txtRecords = flat(records);
                let txtFound = txtRecords.some(
                    txtRecord => verificationToken === txtRecord
                );

                if (txtFound) {
                    let status = await StatusPageService.findOneBy({
                        _id: statusPageId,
                    });

                    status.domains.forEach(domain => {
                        if (domain._id === domainId) {
                            domain.verified = true;
                        }
                    });

                    let response = await StatusPageService.updateOneBy(
                        { _id: statusPageId },
                        { domains: status.domains }
                    );
                    return sendItemResponse(req, res, response);
                } else {
                    return sendErrorResponse(req, res, {
                        message: 'TXT record not found',
                        code: 400,
                    });
                }
            });
        } catch (error) {
            return sendErrorResponse(req, res, error);
        }
    }
);

module.exports = router;
