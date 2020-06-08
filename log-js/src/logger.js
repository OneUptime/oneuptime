class Logger {
    constructor(applicationLogId, applicationLogKey) {
        this.applicationLogId = applicationLogId;
        this.applicationLogKey = applicationLogKey;
        this.apiUrl = '/applicationLogId/create-log';

        const isLocalhost =
            window &&
            window.location &&
            window.location.host &&
            (window.location.host.includes('localhost:') ||
                window.location.host.includes('0.0.0.0:') ||
                window.location.host.includes('127.0.0.1:'));

        if (isLocalhost || isLocalhost === '') {
            let protocol = 'http:';
            if(window.location.protocol != 'file:'){
                protocol = window.location.protocol
            }
            this.apiUrl = `${protocol}//localhost:3002/api/application-log/${this.applicationLogId}/create-log`;
        }
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
            xmlHttp.setRequestHeader('Content-Type', 'application/json');
            xmlHttp.send(JSON.stringify({"data":data}));
        } catch (error) {
            console.log(
                'Failed to log to server because of this exception:\n' + error
            );
            console.log('Failed log data:', data);
        }
    }
}
