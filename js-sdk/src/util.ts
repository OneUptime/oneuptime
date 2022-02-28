import { readFile } from 'fs';
import * as LRUMap from 'lru_map';

const CONTENT_CACHE = new LRUMap.default.LRUMap(100);
class Util {
    options: $TSFixMe;
    constructor(options: $TSFixMe) {
        this.options = options;
    }
    getErrorType() {
        return {
            INFO: 'info',
            WARNING: 'warning',
            ERROR: 'error',
        };
    }
    async _getErrorStackTrace(errorEvent: $TSFixMe) {
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
        let obj = {
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

        // check if  readFile is supported before attempting to read file, this currently works on only NODE
        // check if user opted in for getting code snippet before getting it

        if (readFile && this.options.captureCodeSnippet) {
            obj = await this._getErrorCodeSnippet(obj);
        }
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
    async _getErrorCodeSnippet(errorObj: $TSFixMe) {
        const frames = errorObj.stacktrace ? errorObj.stacktrace.frames : [];
        for (let i = 0; i < frames.length; i++) {
            let fileName = frames[i].fileName;
            // check what it starts with
            fileName = this._formatFileName(fileName);

            // try to get the file from the cache
            const cache = CONTENT_CACHE.get(fileName);
            // if we get a hit for the file
            if (cache !== undefined) {
                // and the content is not null
                if (cache !== null) {
                    frames[i].sourceFile = cache;
                }
            } else {
                // try to read the file content and save to cache
                const currentContent = await this._readFileFromSource(fileName);
                if (currentContent !== null) {
                    frames[i].sourceFile = currentContent;
                }
            }
        }
        frames.map((frame: $TSFixMe) => {
            const lines = frame.sourceFile ? frame.sourceFile.split('\n') : [];
            const localFrame = this._addCodeSnippetToFrame(lines, frame);
            frame = localFrame;
            return frame;
        });
        errorObj.stacktrace.frames = frames;
        return errorObj;
    }
    _readFileFromSource(fileName: $TSFixMe) {
        return new Promise(resolve => {
            readFile(fileName, (err, data) => {
                const content = err ? null : data.toString();

                CONTENT_CACHE.set(fileName, content);
                resolve(content);
            });
        });
    }
    _formatFileName(fileName: $TSFixMe) {
        const fileIndicator = 'file://';
        let localFileName = fileName;
        if (fileName.indexOf(fileIndicator) > -1) {
            // check for index of file then trim the file part by skiping it and starting with the leading /
            localFileName = fileName.substring(
                fileName.indexOf(fileIndicator) + fileIndicator.length
            );
        }
        return localFileName;
    }
    _addCodeSnippetToFrame(
        lines: $TSFixMe,
        frame: $TSFixMe,
        linesOfContext = 5
    ) {
        if (lines.length < 1) return;
        const lineNumber = frame.lineNumber || 0;
        const maxLines = lines.length;
        const sourceLine = Math.max(Math.min(maxLines, lineNumber - 1), 0);
        // attach the line before the error
        frame.linesBeforeError = lines.slice(
            Math.max(0, sourceLine - linesOfContext),
            sourceLine
        );
        // attach the line after the error
        frame.linesAfterError = lines.slice(
            Math.min(sourceLine + 1, maxLines),
            sourceLine + 1 + linesOfContext
        );
        // attach the error line
        frame.errorLine = lines[Math.min(maxLines - 1, sourceLine)];

        // remove the source file
        delete frame.sourceFile;
        return frame;
    }
}
export default Util;
