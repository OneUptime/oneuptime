const axios = require('axios');
const { API_URL } = require('./config');

const prepareToLogRequest = (data, url, success, error) => {
    var type = typeof data;

    if (!data || !(type === 'object' || type === 'string')) {
        return;
    }
    // make post request
    return sendLogsToServer(data, url, success, error)
};

const sendLogsToServer =  (data, url, success, error) => {
    return axios({
        method: 'post',
        url: `${API_URL}/${url}`,
        data,
    }).then(success, error);
};

module.exports = (applicationLogId, applicationLogKey) => {
    applicationLogId = applicationLogId;
    applicationLogKey = applicationLogKey;

    return {
        log: data => {
            const url = `${applicationLogId}/log-content`;
            data.applicationLogKey = applicationLogKey;

            return prepareToLogRequest(
                data,
                url,
                async response => {
                    return response;
                },
                async err => {
                    return err;
                }
            );
        },
    };
};
