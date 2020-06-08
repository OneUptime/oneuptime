class Logger {
    constructor(applicationLogId, applicationLogKey) {
        this.applicationLogId = applicationLogId;
        this.applicationLogKey = applicationLogKey;
        this.apiUrl = '';
    }

    log(data) {
        var type = typeof data;

        if (!data || !(type === 'object' || type === 'string')) {
            return;
        }
        // make api requeest to the server to save a log with the key, id and content
        try {
            // api request
            var xmlHttp = new XMLHttpRequest();
            xmlHttp.open('POST', this.apiUrl, true);
            xmlHttp.setRequestHeader('Content-Type', 'text/plain');
            xmlHttp.send(JSON.stringify(data));
        } catch (error) {
            console.log("Failed to log to loggly because of this exception:\n" + ex);
            console.log("Failed log data:", data);
        }
    }
}
