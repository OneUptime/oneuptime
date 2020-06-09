import axios from '../node_modules/axios';
class Logger {
    constructor(applicationLogId, applicationLogKey) {
        this.applicationLogId = applicationLogId;
        this.applicationLogKey = applicationLogKey;
        this.apiUrl = `http://localhost:3002/api/application-log/${this.applicationLogId}/log-content`;
    }

    async log(data) {
        var type = typeof data;

        if (!data || !(type === 'object' || type === 'string')) {
            return;
        }
        // make api requeest to the server to save a log with the key, id and content
        return await this.makeApiRequest(data);
    }

    makeApiRequest(data) {
        return new Promise((resolve, reject) => {
            axios
                .post(this.apiUrl, { content: data, applicationLogKey: this.applicationLogKey })
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
