import axios from 'axios';
const CLUSTER_KEY = process.env['CLUSTER_KEY'];

export default {
    headers: async (val: $TSFixMe, type: $TSFixMe) => {
        const header = {};
        if (type && type.length) {
            // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            header['Content-Type'] = type;
        }
        if (val && val.length) {
            val.forEach((head: $TSFixMe) => {
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                header[head.key] = head.value;
            });
        }
        return header;
    },

    body: async (val: $TSFixMe, type: $TSFixMe) => {
        let bodyContent = {};
        if (type && type === 'formData' && val && val[0] && val[0].key) {
            val.forEach((bod: $TSFixMe) => {
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                bodyContent[bod.key] = bod.value;
            });
            bodyContent = JSON.stringify(bodyContent);
        } else if (type && type === 'text' && val && val.length) {
            bodyContent = val;
        }
        return bodyContent;
    },

    postApi: async (url: $TSFixMe, data: $TSFixMe) => {
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
