import axios from 'axios';
class Logger {
    private apiUrl: URL;
    private applicationLogId: $TSFixMe;
    private applicationLogKey: $TSFixMe;
    public constructor(
        apiUrl: URL,
        applicationLogId: $TSFixMe,
        applicationLogKey: $TSFixMe
    ) {
        this._setApplicationLogId(applicationLogId);
        this._setApiUrl(apiUrl);
        this._setApplicationLogKey(applicationLogKey);
    }
    private _setApplicationLogId(applicationLogId: $TSFixMe): void {
        this.applicationLogId = applicationLogId;
    }
    private _setApplicationLogKey(applicationLogKey: $TSFixMe): void {
        this.applicationLogKey = applicationLogKey;
    }
    private _setApiUrl(apiUrl: URL): void {
        this.apiUrl = `${apiUrl}/application-log/${this.applicationLogId}/log`;
    }

    public async log(data: $TSFixMe, tags = null): void {
        const type: $TSFixMe = typeof data;

        if (!data || !(type === Typeof.Object || type === Typeof.String)) {
            return 'Invalid Content to be logged';
        }

        if (tags) {
            if (!(typeof tags === Typeof.String || Array.isArray(tags))) {
                return 'Invalid Content Tags to be logged';
            }
        }
        const logType: string = 'info';
        // Make api request to the server to save a log with the key, id and content
        return this._makeApiRequest(data, logType, tags);
    }
    public async warning(data: $TSFixMe, tags = null): void {
        const type: $TSFixMe = typeof data;

        if (!data || !(type === Typeof.Object || type === Typeof.String)) {
            return 'Invalid Content to be logged';
        }

        if (tags) {
            if (!(typeof tags === Typeof.String || Array.isArray(tags))) {
                return 'Invalid Content Tags to be logged';
            }
        }
        const logType: string = 'warning';
        // Make api request to the server to save a log with the key, id and content
        return this._makeApiRequest(data, logType, tags);
    }
    public async error(data: $TSFixMe, tags = null): void {
        const type: $TSFixMe = typeof data;

        if (!data || !(type === Typeof.Object || type === Typeof.String)) {
            return 'Invalid Content to be logged';
        }

        if (tags) {
            if (!(typeof tags === Typeof.String || Array.isArray(tags))) {
                return 'Invalid Content Tags to be logged';
            }
        }
        const logType: string = 'error';
        // Make api request to the server to save a log with the key, id and content
        return this._makeApiRequest(data, logType, tags);
    }

    private _makeApiRequest(
        data: $TSFixMe,
        logType: $TSFixMe,
        tags = null
    ): void {
        const requestData: $TSFixMe = {
            content: data,
            applicationLogKey: this.applicationLogKey,
            type: logType,
        };
        if (tags) {
            requestData.tags = tags;
        }
        return new Promise((resolve: Function, reject: Function) => {
            axios
                .post(this.apiUrl, requestData)
                .then((res: $TSFixMe) => {
                    resolve(res);
                })
                .catch((err: $TSFixMe) => {
                    reject(err);
                });
        });
    }
}
export default Logger;
