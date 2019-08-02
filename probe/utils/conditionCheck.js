var _ = require('lodash');
module.exports = {
    headers: async (val, type) => {
        let header = {};
        if (type && type.length) {
            header['Content-Type'] = type;
        }
        if (val && val.length) {
            val.map(head => {
                header[head.key] = head.value;
            });
        }
        return header;
    },

    body: async (val, type) => {
        let bodyContent = {};
        if (type && type === 'formData' && val && val[0] && val[0].key) {
            val.map(bod => {
                bodyContent[bod.key] = bod.value;
            });
            bodyContent = JSON.stringify(bodyContent);
        }
        else if (type && type === 'text' && val && val.length) {
            bodyContent = val;
        }
        return bodyContent;
    },

    conditions: async (respTime, resp, con) => {
        let stat = true;
        if (con && con.and && con.and.length) {
            stat = await checkAnd(respTime, con.and, resp.status || resp.statusCode || null, resp.body || null);
        }
        else if (con && con.or && con.or.length) {
            stat = await checkOr(respTime, con.or, resp.status || resp.statusCode || null, resp.body || null);
        }
        return stat;
    },
};


const checkAnd = async (respTime, con, statusCode, body) => {
    let validity = true;
    for (let i = 0; i < con.length; i++) {
        if (con[i] && con[i].responseType && con[i].responseType === 'responseTime') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (!(con[i] && con[i].field1 && respTime && respTime > con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (!(con[i] && con[i].field1 && respTime && respTime < con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (!(con[i] && con[i].field1 && respTime && con[i].field2 && respTime > con[i].field1 && respTime < con[i].field2)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (!(con[i] && con[i].field1 && respTime && respTime == con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (!(con[i] && con[i].field1 && respTime && respTime != con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (!(con[i] && con[i].field1 && respTime && respTime >= con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (!(con[i] && con[i].field1 && respTime && respTime <= con[i].field1)) {
                    validity = false;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'doesRespond') {
            if (con[i] && con[i].filter && con[i].filter === 'isUp') {
                if (!(con[i] && con[i].filter && respTime)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'isDown') {
                if (!(con[i] && con[i].filter && !respTime)) {
                    validity = false;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'statusCode') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (!(con[i] && con[i].field1 && statusCode && statusCode > con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (!(con[i] && con[i].field1 && statusCode && statusCode < con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (!(con[i] && con[i].field1 && statusCode && con[i].field2 && statusCode > con[i].field1 && statusCode < con[i].field2)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (!(con[i] && con[i].field1 && statusCode && statusCode == con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (!(con[i] && con[i].field1 && statusCode && statusCode != con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (!(con[i] && con[i].field1 && statusCode && statusCode >= con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (!(con[i] && con[i].field1 && statusCode && statusCode <= con[i].field1)) {
                    validity = false;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'responseBody') {
            if (con[i] && con[i].filter && con[i].filter === 'contains') {
                if (!(con[i] && con[i].field1 && body && body[con[i].field1])) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'doesNotContain') {
                if (!(con[i] && con[i].field1 && body && !body[con[i].field1])) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'jsExpression') {
                if (!(con[i] && con[i].field1 && body && body[con[i].field1] === con[i].field1)) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'empty') {
                if (!(con[i] && con[i].filter && body && _.isEmpty(body))) {
                    validity = false;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEmpty') {
                if (!(con[i] && con[i].filter && body && !_.isEmpty(body))) {
                    validity = false;
                }
            }
        }
        if (con[i] && con[i].collection && con[i].collection.and && con[i].collection.and.length) {
            let temp = await checkAnd(respTime, con[i].collection.and, statusCode, body);
            if (!temp) {
                validity = temp;
            }
        }
        else if (con[i] && con[i].collection && con[i].collection.or && con[i].collection.or.length) {
            let temp1 = await checkOr(respTime, con[i].collection.or, statusCode, body);
            if (!temp1) {
                validity = temp1;
            }
        }
    }
    return validity;
};

const checkOr = async (respTime, con, statusCode, body) => {
    let validity = false;
    for (let i = 0; i < con.length; i++) {
        if (con[i] && con[i].responseType === 'responseTime') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (con[i] && con[i].field1 && respTime && respTime > con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (con[i] && con[i].field1 && respTime && respTime < con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (con[i] && con[i].field1 && respTime && con[i].field2 && respTime > con[i].field1 && respTime < con[i].field2) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (con[i] && con[i].field1 && respTime && respTime == con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (con[i] && con[i].field1 && respTime && respTime != con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (con[i] && con[i].field1 && respTime && respTime >= con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (con[i] && con[i].field1 && respTime && respTime <= con[i].field1) {
                    validity = true;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'doesRespond') {
            if (con[i] && con[i].filter && con[i].filter === 'isUp') {
                if (con[i] && con[i].filter && respTime) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'isDown') {
                if (con[i] && con[i].filter && !respTime) {
                    validity = true;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'statusCode') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (con[i] && con[i].field1 && statusCode && statusCode > con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'lessThan') {
                if (con[i] && con[i].field1 && statusCode && statusCode < con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'inBetween') {
                if (con[i] && con[i].field1 && statusCode && con[i].field2 && statusCode > con[i].field1 && statusCode < con[i].field2) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (con[i] && con[i].field1 && statusCode && statusCode == con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEqualTo') {
                if (con[i] && con[i].field1 && statusCode && statusCode != con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'gtEqualTo') {
                if (con[i] && con[i].field1 && statusCode && statusCode >= con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'ltEqualTo') {
                if (con[i] && con[i].field1 && statusCode && statusCode <= con[i].field1) {
                    validity = true;
                }
            }
        }
        else if (con[i] && con[i].responseType === 'responseBody') {
            if (con[i] && con[i].filter && con[i].filter === 'contains') {
                if (con[i] && con[i].field1 && body && body[con[i].field1]) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'doesNotContain') {
                if (con[i] && con[i].field1 && body && !body[con[i].field1]) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'jsExpression') {
                if (con[i] && con[i].field1 && body && body[con[i].field1] === con[i].field1) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'empty') {
                if (con[i] && con[i].filter && body && _.isEmpty(body)) {
                    validity = true;
                }
            }
            else if (con[i] && con[i].filter && con[i].filter === 'notEmpty') {
                if (con[i] && con[i].filter && body && !_.isEmpty(body)) {
                    validity = true;
                }
            }
        }
        if (con[i] && con[i].collection && con[i].collection.and && con[i].collection.and.length) {
            let temp = await checkAnd(respTime, con[i].collection.and, statusCode, body);
            if (temp) {
                validity = temp;
            }
        }
        else if (con[i] && con[i].collection && con[i].collection.or && con[i].collection.or.length) {
            let temp1 = await checkOr(respTime, con[i].collection.or, statusCode, body);
            if (temp1) {
                validity = temp1;
            }
        }
    }
    return validity;
};