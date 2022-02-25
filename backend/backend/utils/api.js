import axios from 'axios'
const CLUSTER_KEY = process.env['CLUSTER_KEY'];

export default {
    headers: async (val, type) => {
        const header = {};
        if (type && type.length) {
            header['Content-Type'] = type;
        }
        if (val && val.length) {
            val.forEach(head => {
                header[head.key] = head.value;
            });
        }
        return header;
    },

    body: async (val, type) => {
        let bodyContent = {};
        if (type && type === 'formData' && val && val[0] && val[0].key) {
            val.forEach(bod => {
                bodyContent[bod.key] = bod.value;
            });
            bodyContent = JSON.stringify(bodyContent);
        } else if (type && type === 'text' && val && val.length) {
            bodyContent = val;
        }
        return bodyContent;
    },

    postApi: async (url, data) => {
        // Error [ERR_FR_MAX_BODY_LENGTH_EXCEEDED]: Request body larger than maxBodyLength limit
        // https://stackoverflow.com/questions/58655532/increasing-maxcontentlength-and-maxbodylength-in-axios
        const response = await axios({
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
