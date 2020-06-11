import axios from '../node_modules/axios';
import { getApiUrl } from './config';
class Logger {
    #applicationLogId;
    #applicationLogKey;
    #apiUrl;
    constructor(applicationLogId, applicationLogKey) {
        this.#setApplicationLogId(applicationLogId);
        this.#setApplicationLogKey(applicationLogKey);
        this.#setApiUrl();
    }
    #setApplicationLogId(applicationLogId) {
        this.#applicationLogId = applicationLogId;
    }
    #setApplicationLogKey(applicationLogKey) {
        this.#applicationLogKey = applicationLogKey;
    }
    #setApiUrl() {
        this.#apiUrl = `${getApiUrl()}${this.#applicationLogId}/log`;
    }

    async log(data) {
        var type = typeof data;

        if (!data || !(type === 'object' || type === 'string')) {
            return;
        }
        const logType = 'info';
        // make api request to the server to save a log with the key, id and content
        return await this.#makeApiRequest(data, logType);
    }

    #makeApiRequest(data, logType) {
        return new Promise((resolve, reject) => {
            axios
                .post(this.#apiUrl, {
                    content: data,
                    applicationLogKey: this.#applicationLogKey,
                    type: logType,
                })
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
