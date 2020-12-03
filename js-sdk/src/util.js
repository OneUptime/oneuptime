class Util {
    getErrorType() {
        return {
            INFO: 'info',
            WARNING: 'warning',
            ERROR: 'error',
        };
    }
    _getErrorStackTrace(errorEvent) {
        const frames = [];
        // get error stack trace
        const stack = errorEvent.stack
            ? errorEvent.stack
            : errorEvent.error.stack
            ? errorEvent.error.stack
            : errorEvent.error;
        const stackTrace = stack.split('\n'); // it is all a string so split into array by the enter key
        // the first item is always the title.
        const firstStack = stackTrace[0].split(':'); // browser add a : to seperate the title from the description
        const obj = {
            type: firstStack[0],
            message: errorEvent.message ? errorEvent.message : errorEvent.error,
            stacktrace: null,
            lineNumber: errorEvent.line || errorEvent.lineno,
            columnNumber: errorEvent.col,
        };
        // loop through the remaining stack to construct the remaining frame
        for (let index = 1; index < stackTrace.length; index++) {
            const currentFrame = stackTrace[index];
            // split the  string into two
            const firstHalf = currentFrame.substring(
                0,
                currentFrame.indexOf('(') - 1
            );
            // first half contains the method
            const methodName = firstHalf
                .substring(firstHalf.lastIndexOf(' '))
                .replace(/\s+/g, '');
            // second half contains file, line number and column number
            let secondHalf = currentFrame.substring(currentFrame.indexOf('('));
            // strip away the () the first and last character
            secondHalf = secondHalf.substring(1);
            secondHalf = secondHalf.substring(0, secondHalf.length - 1);

            // we split the second half by : since the format is filelocation:linenumber:columnnumber
            secondHalf = secondHalf.split(':');
            // we pick the last two as the line number and column number
            const lineNumber = secondHalf[secondHalf.length - 2];
            const columnNumber = secondHalf[secondHalf.length - 1];
            // then we merge the rest by the :
            let fileName = '';
            let position = 0;
            while (position < secondHalf.length - 2) {
                fileName += `${secondHalf[position]}`;
                if (position !== secondHalf.length - 3) fileName += ':';
                position = position + 1;
            }
            // add this onto the frames
            frames.push({
                methodName,
                lineNumber,
                columnNumber,
                fileName,
            });
        }
        const stacktrace = {
            frames,
        };
        obj.stacktrace = stacktrace;
        return obj;
    }
    _getUserDeviceDetails() {
        const deviceDetails = { device: null, browser: null };
        if (typeof window !== 'undefined') {
            const details = window.navigator.appVersion;
            // get string between first parenthesis
            const deviceOS = details.substring(
                details.indexOf('(') + 1,
                details.indexOf(')')
            );
            const device = deviceOS.split(';');
            // get string after last parenthesis
            const deviceBrowser = details
                .substring(details.lastIndexOf(')') + 1)
                .trim()
                .split(' ');
            const browser = deviceBrowser[0];
            const browserDetails = {
                name: browser.substring(0, browser.indexOf('/')),
                version: browser.substring(browser.indexOf('/') + 1),
            };
            deviceDetails.device = device;
            deviceDetails.browser = browserDetails;
        }
        return deviceDetails;
    }
}
export default Util;
