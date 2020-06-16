import axios from '../node_modules/axios';
class Logger {
    #applicationLogId;
    #applicationLogKey;
    #apiUrl;
    constructor(apiUrl, applicationLogId, applicationLogKey) {
        this.#verifyUrlExist(apiUrl);
        this.#setApiUrl(apiUrl);
        this.#setApplicationLogId(applicationLogId);
        this.#setApplicationLogKey(applicationLogKey);
    }
    #verifyUrlExist(apiUrl){
        const allowedServerUrl = [
            'http://localhost:3002/api/',
            'https://fyipe.com/api'
        ];
        if(!allowedServerUrl.includes(apiUrl)){
            throw new Error('Invalid Server URl')
        }
        return true;
    }
    #setApplicationLogId(applicationLogId) {
        this.#applicationLogId = applicationLogId;
    }
    #setApplicationLogKey(applicationLogKey) {
        this.#applicationLogKey = applicationLogKey;
    }
    #setApiUrl(apiUrl) {
        this.#apiUrl = `${apiUrl}application-log/${this.#applicationLogId}/log`;
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
    async warning(data) {
        var type = typeof data;

        if (!data || !(type === 'object' || type === 'string')) {
            return;
        }
        const logType = 'warning';
        // make api request to the server to save a log with the key, id and content
        return await this.#makeApiRequest(data, logType);
    }
    async error(data) {
        var type = typeof data;

        if (!data || !(type === 'object' || type === 'string')) {
            return;
        }
        const logType = 'error';
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
