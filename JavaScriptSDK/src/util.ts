import { readFile } from 'fs';
import * as LRUMap from 'lru_map';

const CONTENT_CACHE = new LRUMap.default.LRUMap(100);
class Util {
    options: $TSFixMe;
    constructor(options: $TSFixMe) {
        this.options = options;
    }
    getErrorType(): void {
        return {
            INFO: 'info',
            WARNING: 'warning',
            ERROR: 'error',
        };
    }
    async _getErrorStackTrace(errorEvent: $TSFixMe): void {
        const frames: $TSFixMe = [];
        // get error stack trace
        const stack: $TSFixMe = errorEvent.stack
            ? errorEvent.stack
            : errorEvent.error.stack
            ? errorEvent.error.stack
            : errorEvent.error;
        const stackTrace: $TSFixMe = stack.split('\n'); // it is all a string so split into array by the enter key
        // the first item is always the title.
        const firstStack: $TSFixMe = stackTrace[0].split(':'); // browser add a : to seperate the title from the description
        let obj: $TSFixMe = {
            type: firstStack[0],
            message: errorEvent.message ? errorEvent.message : errorEvent.error,
            stacktrace: null,
            lineNumber: errorEvent.line || errorEvent.lineno,
            columnNumber: errorEvent.col,
        };
        // loop through the remaining stack to construct the remaining frame
        for (let index: $TSFixMe = 1; index < stackTrace.length; index++) {
            const currentFrame: $TSFixMe = stackTrace[index];
            // split the  string into two
            const firstHalf: $TSFixMe = currentFrame.substring(
                0,
                currentFrame.indexOf('(') - 1
            );
            // first half contains the method
            const methodName: $TSFixMe = firstHalf
                .substring(firstHalf.lastIndexOf(' '))
                .replace(/\s+/g, '');
            // second half contains file, line number and column number
            let secondHalf: $TSFixMe = currentFrame.substring(
                currentFrame.indexOf('(')
            );
            // strip away the () the first and last character
            secondHalf = secondHalf.substring(1);
            secondHalf = secondHalf.substring(0, secondHalf.length - 1);

            // we split the second half by : since the format is filelocation:linenumber:columnnumber
            secondHalf = secondHalf.split(':');
            // we pick the last two as the line number and column number
            const lineNumber: $TSFixMe = secondHalf[secondHalf.length - 2];
            const columnNumber: $TSFixMe = secondHalf[secondHalf.length - 1];
            // then we merge the rest by the :
            let fileName: $TSFixMe = '';
            let position: $TSFixMe = 0;
            while (position < secondHalf.length - 2) {
                fileName += `${secondHalf[position]}`;
                if (position !== secondHalf.length - 3) {
                    fileName += ':';
                }
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
        const stacktrace: $TSFixMe = {
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
    _getUserDeviceDetails(): void {
        const deviceDetails: $TSFixMe = { device: null, browser: null };
        if (typeof window !== 'undefined') {
            const details: $TSFixMe = window.navigator.appVersion;
            // get string between first parenthesis
            const deviceOS: $TSFixMe = details.substring(
                details.indexOf('(') + 1,
                details.indexOf(')')
            );
            const device: $TSFixMe = deviceOS.split(';');
            // get string after last parenthesis
            const deviceBrowser: $TSFixMe = details
                .substring(details.lastIndexOf(')') + 1)
                .trim()
                .split(' ');
            const browser: $TSFixMe = deviceBrowser[0];
            const browserDetails: $TSFixMe = {
                name: browser.substring(0, browser.indexOf('/')),
                version: browser.substring(browser.indexOf('/') + 1),
            };

            deviceDetails.device = device;

            deviceDetails.browser = browserDetails;
        }
        return deviceDetails;
    }
    async _getErrorCodeSnippet(errorObj: $TSFixMe): void {
        const frames: $TSFixMe = errorObj.stacktrace
            ? errorObj.stacktrace.frames
            : [];
        for (let i: $TSFixMe = 0; i < frames.length; i++) {
            let fileName: $TSFixMe = frames[i].fileName;
            // check what it starts with
            fileName = this._formatFileName(fileName);

            // try to get the file from the cache
            const cache: $TSFixMe = CONTENT_CACHE.get(fileName);
            // if we get a hit for the file
            if (cache !== undefined) {
                // and the content is not null
                if (cache !== null) {
                    frames[i].sourceFile = cache;
                }
            } else {
                // try to read the file content and save to cache
                const currentContent: $TSFixMe = await this._readFileFromSource(
                    fileName
                );
                if (currentContent !== null) {
                    frames[i].sourceFile = currentContent;
                }
            }
        }
        frames.map((frame: $TSFixMe): void => {
            const lines: $TSFixMe = frame.sourceFile
                ? frame.sourceFile.split('\n')
                : [];
            const localFrame: $TSFixMe = this._addCodeSnippetToFrame(
                lines,
                frame
            );
            frame = localFrame;
            return frame;
        });
        errorObj.stacktrace.frames = frames;
        return errorObj;
    }
    _readFileFromSource(fileName: $TSFixMe): void {
        return new Promise(resolve => {
            readFile(fileName, (err, data) => {
                const content: $TSFixMe = err ? null : data.toString();

                CONTENT_CACHE.set(fileName, content);
                resolve(content);
            });
        });
    }
    _formatFileName(fileName: $TSFixMe): void {
        const fileIndicator: string = 'file://';
        let localFileName: $TSFixMe = fileName;
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
    ): void {
        if (lines.length < 1) {
            return;
        }
        const lineNumber: $TSFixMe = frame.lineNumber || 0;
        const maxLines: $TSFixMe = lines.length;
        const sourceLine: $TSFixMe = Math.max(
            Math.min(maxLines, lineNumber - 1),
            0
        );
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
