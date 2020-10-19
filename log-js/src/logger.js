import axios from 'axios';
import FyipeTracker from './tracker';
class FyipeLogger {
    #applicationLogId;
    #applicationLogKey;
    #apiUrl;
    #tracker;
    constructor(apiUrl, applicationLogId, applicationLogKey, options = {}) {
        this._setApplicationLogId(applicationLogId);
        this._setApiUrl(apiUrl);
        this._setApplicationLogKey(applicationLogKey);
        // set up application tracker also
        this.#tracker = new FyipeTracker(options);
    }
    _setApplicationLogId(applicationLogId) {
        this.#applicationLogId = applicationLogId;
    }
    _setApplicationLogKey(applicationLogKey) {
        this.#applicationLogKey = applicationLogKey;
    }
    _setApiUrl(apiUrl) {
        this.#apiUrl = `${apiUrl}/application-log/${
            this.#applicationLogId
        }/log`;
    }

    addTimeline(category, content, type) {
        this.#tracker.addToTimeline(category, content, type);
    }
    captureMessage(message) {
        this.#tracker.captureMessage(message);
    }
    captureException(error) {
        this.#tracker.captureException(error);
    }
    setTag(key, value) {
        if (!(typeof key === 'string') || !(typeof value === 'string')) {
            return 'Invalid Tags type';
        }
        this.#tracker.setTag(key, value);
    }
    setTags(tags) {
        if (!Array.isArray(tags)) {
            return 'Invalid Tags type';
        }
        this.#tracker.setTags(tags);
    }
    setFingerprint(fingerprint) {
        if (!(typeof fingerprint === 'string') && !Array.isArray(fingerprint)) {
            return 'Invalid Fingerprint Format';
        }
        this.#tracker.setFingerprint(fingerprint);
    }
    async log(data, tags = null) {
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
    async warning(data, tags = null) {
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
    async error(data, tags = null) {
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

    _makeApiRequest(data, logType, tags = null) {
        const requestData = {
            content: data,
            applicationLogKey: this.#applicationLogKey,
            type: logType,
        };
        if (tags) {
            requestData.tags = tags;
        }
        return new Promise((resolve, reject) => {
            axios
                .post(this.#apiUrl, requestData)
                .then(res => {
                    resolve(res);
                })
                .catch(err => {
                    reject(err);
                });
        });
    }
}
export default FyipeLogger;
