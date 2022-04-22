import { readFile } from 'fs';
import * as LRUMap from 'lru_map';

const CONTENT_CACHE: $TSFixMe = new LRUMap.default.LRUMap(100);
class Util {
    private options: $TSFixMe;
    public constructor(options: $TSFixMe) {
        this.options = options;
    }
    public getErrorType(): void {
        return {
            INFO: 'info',
            WARNING: 'warning',
            ERROR: 'error',
        };
    }
    private async _getErrorStackTrace(errorEvent: $TSFixMe): void {
        const frames: $TSFixMe = [];
        // Get error stack trace
        const stack: $TSFixMe = errorEvent.stack
            ? errorEvent.stack
            : errorEvent.error.stack
            ? errorEvent.error.stack
            : errorEvent.error;
        const stackTrace: $TSFixMe = stack.split('\n'); // It is all a string so split into array by the enter key
        // The first item is always the title.
        const firstStack: $TSFixMe = stackTrace[0].split(':'); // Browser add a : to seperate the title from the description
        let obj: $TSFixMe = {
            type: firstStack[0],
            message: errorEvent.message ? errorEvent.message : errorEvent.error,
            stacktrace: null,
            lineNumber: errorEvent.line || errorEvent.lineno,
            columnNumber: errorEvent.col,
        };
        // Loop through the remaining stack to construct the remaining frame
        for (let index: $TSFixMe = 1; index < stackTrace.length; index++) {
            const currentFrame: $TSFixMe = stackTrace[index];
            // Split the  string into two
            const firstHalf: $TSFixMe = currentFrame.substring(
                0,
                currentFrame.indexOf('(') - 1
            );
            // First half contains the method
            const methodName: $TSFixMe = firstHalf
                .substring(firstHalf.lastIndexOf(' '))
                .replace(/\s+/g, '');
            // Second half contains file, line number and column number
            let secondHalf: $TSFixMe = currentFrame.substring(
                currentFrame.indexOf('(')
            );
            // Strip away the () the first and last character
            secondHalf = secondHalf.substring(1);
            secondHalf = secondHalf.substring(0, secondHalf.length - 1);

            // We split the second half by : since the format is filelocation:linenumber:columnnumber
            secondHalf = secondHalf.split(':');
            // We pick the last two as the line number and column number
            const lineNumber: $TSFixMe = secondHalf[secondHalf.length - 2];
            const columnNumber: $TSFixMe = secondHalf[secondHalf.length - 1];
            // Then we merge the rest by the :
            let fileName: $TSFixMe = '';
            let position: $TSFixMe = 0;
            while (position < secondHalf.length - 2) {
                fileName += `${secondHalf[position]}`;
                if (position !== secondHalf.length - 3) {
                    fileName += ':';
                }
                position = position + 1;
            }
            // Add this onto the frames
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

        /*
         * Check if  readFile is supported before attempting to read file, this currently works on only NODE
         * Check if user opted in for getting code snippet before getting it
         */

        if (readFile && this.options.captureCodeSnippet) {
            obj = await this._getErrorCodeSnippet(obj);
        }
        return obj;
    }
    private _getUserDeviceDetails(): void {
        const deviceDetails: $TSFixMe = { device: null, browser: null };
        if (typeof window !== 'undefined') {
            const details: $TSFixMe = window.navigator.appVersion;
            // Get string between first parenthesis
            const deviceOS: $TSFixMe = details.substring(
                details.indexOf('(') + 1,
                details.indexOf(')')
            );
            const device: $TSFixMe = deviceOS.split(';');
            // Get string after last parenthesis
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
    private async _getErrorCodeSnippet(errorObj: $TSFixMe): void {
        const frames: $TSFixMe = errorObj.stacktrace
            ? errorObj.stacktrace.frames
            : [];
        for (let i: $TSFixMe = 0; i < frames.length; i++) {
            let fileName: $TSFixMe = frames[i].fileName;
            // Check what it starts with
            fileName = this._formatFileName(fileName);

            // Try to get the file from the cache
            const cache: $TSFixMe = CONTENT_CACHE.get(fileName);
            // If we get a hit for the file
            if (cache !== undefined) {
                // And the content is not null
                if (cache !== null) {
                    frames[i].sourceFile = cache;
                }
            } else {
                // Try to read the file content and save to cache
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
    private _readFileFromSource(fileName: $TSFixMe): void {
        return new Promise((resolve: $TSFixMe) => {
            readFile(fileName, (err: $TSFixMe, data: $TSFixMe) => {
                const content: $TSFixMe = err ? null : data.toString();

                CONTENT_CACHE.set(fileName, content);
                resolve(content);
            });
        });
    }
    private _formatFileName(fileName: $TSFixMe): void {
        const fileIndicator: string = 'file://';
        let localFileName: $TSFixMe = fileName;
        if (fileName.indexOf(fileIndicator) > -1) {
            // Check for index of file then trim the file part by skiping it and starting with the leading /
            localFileName = fileName.substring(
                fileName.indexOf(fileIndicator) + fileIndicator.length
            );
        }
        return localFileName;
    }
    private _addCodeSnippetToFrame(
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
        // Attach the line before the error
        frame.linesBeforeError = lines.slice(
            Math.max(0, sourceLine - linesOfContext),
            sourceLine
        );
        // Attach the line after the error
        frame.linesAfterError = lines.slice(
            Math.min(sourceLine + 1, maxLines),
            sourceLine + 1 + linesOfContext
        );
        // Attach the error line
        frame.errorLine = lines[Math.min(maxLines - 1, sourceLine)];

        // Remove the source file
        delete frame.sourceFile;
        return frame;
    }
}
export default Util;
