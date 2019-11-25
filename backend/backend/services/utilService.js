/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

module.exports = {
    // Description: Checks if user email is vaild Params: 
    // Param 1:  email. 
    // Returns: boolean
    isEmailValid: function (email) {
        // eslint-disable-next-line
        var re = /^(([^<>()\[\]\.,;:\s@\"]+(\.[^<>()\[\]\.,;:\s@\"]+)*)|(\".+\"))@(([^<>()[\]\.,;:\s@\"]+\.)+[^<>()[\]\.,;:\s@\"]{2,})$/i;
        return re.test(email);
    },

    // Description: Checks if domain has at least one dot present:
    // Param 1:  domain. 
    // Returns: boolean
    isDomainValid: function (domain) {
        return (domain.search(/\./) >= 0);
    }
};