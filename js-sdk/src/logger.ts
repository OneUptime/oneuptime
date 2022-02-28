import axios from 'axios';
class Logger {
    apiUrl: $TSFixMe;
    applicationLogId: $TSFixMe;
    applicationLogKey: $TSFixMe;
    constructor(
        apiUrl: $TSFixMe,
        applicationLogId: $TSFixMe,
        applicationLogKey: $TSFixMe
    ) {
        this._setApplicationLogId(applicationLogId);
        this._setApiUrl(apiUrl);
        this._setApplicationLogKey(applicationLogKey);
    }
    _setApplicationLogId(applicationLogId: $TSFixMe) {
        this.applicationLogId = applicationLogId;
    }
    _setApplicationLogKey(applicationLogKey: $TSFixMe) {
        this.applicationLogKey = applicationLogKey;
    }
    _setApiUrl(apiUrl: $TSFixMe) {
        this.apiUrl = `${apiUrl}/application-log/${this.applicationLogId}/log`;
    }

    async log(data: $TSFixMe, tags = null) {
        const type = typeof data;

        if (!data || !(type === 'object' || type === 'string')) {
            return 'Invalid Content to be logged';
        }

        if (tags) {
            if (!(typeof tags === 'string' || Array.isArray(tags))) {
                return 'Invalid Content Tags to be logged';
            }
        }
        const logType = 'info';
        // make api request to the server to save a log with the key, id and content
        return await this._makeApiRequest(data, logType, tags);
    }
    async warning(data: $TSFixMe, tags = null) {
        const type = typeof data;

        if (!data || !(type === 'object' || type === 'string')) {
            return 'Invalid Content to be logged';
        }

        if (tags) {
            if (!(typeof tags === 'string' || Array.isArray(tags))) {
                return 'Invalid Content Tags to be logged';
            }
        }
        const logType = 'warning';
        // make api request to the server to save a log with the key, id and content
        return await this._makeApiRequest(data, logType, tags);
    }
    async error(data: $TSFixMe, tags = null) {
        const type = typeof data;

        if (!data || !(type === 'object' || type === 'string')) {
            return 'Invalid Content to be logged';
        }

        if (tags) {
            if (!(typeof tags === 'string' || Array.isArray(tags))) {
                return 'Invalid Content Tags to be logged';
            }
        }
        const logType = 'error';
        // make api request to the server to save a log with the key, id and content
        return await this._makeApiRequest(data, logType, tags);
    }

    _makeApiRequest(data: $TSFixMe, logType: $TSFixMe, tags = null) {
        const requestData = {
            content: data,
            applicationLogKey: this.applicationLogKey,
            type: logType,
        };
        if (tags) {
            
            requestData.tags = tags;
        }
        return new Promise((resolve, reject) => {
            axios
                .post(this.apiUrl, requestData)
                .then(res => {
                    resolve(res);
                })
                .catch(err => {
                    reject(err);
                });
        });
    }
}
export default Logger;
