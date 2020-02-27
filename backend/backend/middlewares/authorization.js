/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const hasProjectIdAndApiKey = require('./api').hasProjectIdAndApiKey;
const isValidProjectIdAndApiKey = require('./api').isValidProjectIdAndApiKey;
const doesUserBelongToProject = require('./project').doesUserBelongToProject;

module.exports = {
    // Description: Checking if user is authorized to access the page and decode jwt to get user data.
    // Params:
    // Param 1: req.headers-> {token}
    // Returns: 400: User is unauthorized since unauthorized token was present.
    isAuthorized: function(req, res, next) {
        if (hasProjectIdAndApiKey(req, res)) {
            isValidProjectIdAndApiKey(req, res, next);
        } else {
            doesUserBelongToProject(req, res, next);
        }
    },
};
