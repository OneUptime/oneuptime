import axios from 'axios';
const CLUSTER_KEY: $TSFixMe = process.env.CLUSTER_KEY;

export default {
    headers: async (val: $TSFixMe, type: $TSFixMe) => {
        const header: $TSFixMe = {};
        if (type && type.length) {
            header['Content-Type'] = type;
        }
        if (val && val.length) {
            val.forEach((head: $TSFixMe) => {
                header[head.key] = head.value;
            });
        }
        return header;
    },

    body: async (val: $TSFixMe, type: $TSFixMe) => {
        let bodyContent: $TSFixMe = {};
        if (type && type === 'formData' && val && val[0] && val[0].key) {
            val.forEach((bod: $TSFixMe) => {
                bodyContent[bod.key] = bod.value;
            });
            bodyContent = JSON.stringify(bodyContent);
        } else if (type && type === 'text' && val && val.length) {
            bodyContent = val;
        }
        return bodyContent;
    },

    post: async (url: URL, data: $TSFixMe) => {
        /*
         * Error [ERR_FR_MAX_BODY_LENGTH_EXCEEDED]: Request body larger than maxBodyLength limit
         * https://stackoverflow.com/questions/58655532/increasing-maxcontentlength-and-maxbodylength-in-axios
         */
        const response: $TSFixMe = await axios({
            method: 'POST',
            url,
            headers: {
                'Access-Control-Allow-Origin': '*',
                Accept: 'application/json',
                'Content-Type': 'application/json;charset=UTF-8',
                clusterKey: CLUSTER_KEY,
            },
            data,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });
        return response.data;
    },
};
