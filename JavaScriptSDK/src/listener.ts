import OneUptimeTimelineManager from './timelineManager';
import Util from './util';
import Http from 'http';
import Https from 'https';
class OneUptimeListener {
    BASE_url: URL;
    currentEventId: $TSFixMe;
    debounceDuration: $TSFixMe;
    isWindow: $TSFixMe;
    keypressTimeout: $TSFixMe;
    lastEvent: $TSFixMe;
    options: $TSFixMe;
    timelineObj: $TSFixMe;
    utilObj: $TSFixMe;
    constructor(eventId: $TSFixMe, isWindow: $TSFixMe, options: $TSFixMe) {
        this.options = options;
        this.isWindow = isWindow;
        this.timelineObj = new OneUptimeTimelineManager(options);

        this.utilObj = new Util();
        this.currentEventId = eventId;
        this.BASE_URL = 'http://localhost:3002/api'; // TODO proper base url config
        this.debounceDuration = 1000;
        this.keypressTimeout = undefined;
        this.lastEvent = undefined;
        this._setUpConsoleListener();

        if (this.isWindow) {
            this._init();
        } else {
            this._setUpHttpsListener();
        }
    }
    _init(): void {
        this._setUpDomListener();
        this._setUpFetchListener();
        this._setUpXhrListener();
    }
    getTimeline(): void {
        // this always get the current state of the timeline array
        return this.timelineObj.getTimeline();
    }
    clearTimeline(eventId: $TSFixMe): void {
        // set a new eventId
        this.currentEventId = eventId;
        // this will reset the state of the timeline array
        return this.timelineObj.clearTimeline();
    }
    // set up console listener
    _setUpConsoleListener(): void {
        // set up a console listener get the current content, pass it to the normal console and also pass it to the timeline event listener
        const console = (function (oldCons): void {
            return {
                log: function (text: $TSFixMe): void {
                    oldCons.log(text);
                    // this._logConsoleEvent(text, this.utilObj.getErrorType().INFO);
                },
                info: function (text: $TSFixMe): void {
                    oldCons.info(text);
                    this._logConsoleEvent(
                        text,
                        this.utilObj.getErrorType().INFO
                    );
                },
                warn: function (text: $TSFixMe): void {
                    oldCons.warn(text);
                    this._logConsoleEvent(
                        text,
                        this.utilObj.getErrorType().WARNING
                    );
                },
                error: function (text: $TSFixMe): void {
                    oldCons.error(text);
                    this._logConsoleEvent(
                        text,
                        this.utilObj.getErrorType().ERROR
                    );
                },
            };
        })(global.console);
        //Then redefine the old console

        global.console = console;
    }
    // set up dom listener
    _setUpDomListener(): void {
        Object.keys(window).forEach(key => {
            if (/^on(keypress|click)/.test(key)) {
                window.addEventListener(key.slice(2), event => {
                    if (!this.keypressTimeout) {
                        // confirm the event is new
                        if (this.lastEvent === event) {
                            return;
                        }
                        this.lastEvent = event;
                        // set up how to send this log to the server
                        this._logClickEvent(
                            event,
                            this.utilObj.getErrorType().INFO
                        );
                    }
                    // not logging cus of timeout

                    clearTimeout(this.keypressTimeout);

                    this.keypressTimeout = setTimeout(() => {
                        this.keypressTimeout = undefined;
                    }, this.debounceDuration);
                });
            }
        });
    }
    // set up xhr listener
    _setUpXhrListener(): void {
        const open = window.XMLHttpRequest.prototype.open;

        function openReplacement(
            this: $TSFixMe,
            method: $TSFixMe,
            url: URL
        ): void {
            const obj = {
                method,
                url,
                status_code: '',
            };
            this.addEventListener('load', function (thisObj: $TSFixMe): void {
                // check if it is not a request to OneUptime servers
                if (!url.startsWith(this.BASE_URL)) {
                    obj.status_code = thisObj.status;
                    this._logXHREvent(obj, this.utilObj.getErrorType().INFO);
                }
            });
            this.addEventListener('error', function (thisObj: $TSFixMe): void {
                // check if it is not a request to OneUptime servers
                if (!url.startsWith(this.BASE_URL)) {
                    obj.status_code = thisObj.status;
                    this._logXHREvent(obj, this.utilObj.getErrorType().INFO);
                }
            });

            // set up how to send this log to the server to take this log

            return open.apply(this, arguments);
        }

        window.XMLHttpRequest.prototype.open = openReplacement;
    }
    // set up fetch listener
    _setUpFetchListener(): void {
        const currentFetch = global.fetch;

        global.fetch = function (url, options): void {
            const obj = {
                url,
                method: options ? options.method : 'GET', // get request doesnt have a method on fetch, so its set as default
                status_code: '',
            };
            const promise = currentFetch(url, options);
            // Do something with the promise
            promise.then(
                res => {
                    obj.status_code = res.status;
                },
                err => {
                    obj.status_code = err.status;
                }
            );

            if (!url.startsWith(this.BASE_URL)) {
                this._logFetchEvent(obj, this.utilObj.getErrorType().INFO);
            }

            return promise;
        };
    }
    _setUpHttpsListener(): void {
        override(Http);
        override(Https);

        function override(module: $TSFixMe): void {
            const original = module.request;

            function wrapper(this: $TSFixMe, outgoing: $TSFixMe): void {
                // Store a call to the original in req
                const req = original.apply(this, arguments);
                const log = requestDetails(outgoing);
                const emit = req.emit;
                req.emit = function (
                    eventName: $TSFixMe,
                    response: $TSFixMe
                ): void {
                    switch (eventName) {
                        case 'response': {
                            response.on('end', () => {
                                // get status from final response
                                log.status = response.statusCode;
                                if (!log.url.startsWith(this.BASE_URL)) {
                                    this._logHttpRequestEvent(
                                        log,
                                        this.utilObj.getErrorType().INFO
                                    );
                                }
                            });
                        }
                    }
                    return emit.apply(this, arguments);
                };
                // return the original call
                return req;
            }
            module.request = wrapper;
        }
        function requestDetails(req: $TSFixMe): void {
            const log = {
                method: req.method || 'GET',
                host: req.host || req.hostname || '<no host>',
                port: req.port || '',
                path: req.pathname || req.path || '/',
                headers: req.headers || {},
                protocol: req.protocol,
                status: '',
                url: '',
            };
            const portDetails = log.port !== '' ? `:${log.port}` : '';
            const absoluteUrl: string = `${log.protocol}//${log.host}${portDetails}${log.path}`;
            log.url = absoluteUrl;
            return log;
        }
    }
    _logConsoleEvent(content: $TSFixMe, type: $TSFixMe): void {
        const timelineObj = {
            category: 'console',
            data: {
                content,
            },
            type,
            eventId: this.currentEventId,
        };
        // add timeline to the stack
        this.timelineObj.addToTimeline(timelineObj);
    }
    _logXHREvent(content: $TSFixMe, type: $TSFixMe): void {
        const timelineObj = {
            category: 'xhr',
            data: {
                content,
            },
            type,
            eventId: this.currentEventId,
        };
        // add timeline to the stack
        this.timelineObj.addToTimeline(timelineObj);
    }
    _logFetchEvent(content: $TSFixMe, type: $TSFixMe): void {
        const timelineObj = {
            category: 'fetch',
            data: {
                content,
            },
            type,
            eventId: this.currentEventId,
        };
        // add timeline to the stack
        this.timelineObj.addToTimeline(timelineObj);
    }
    _logHttpRequestEvent(content: $TSFixMe, type: $TSFixMe): void {
        const timelineObj = {
            category: type, // HTTP
            data: {
                content,
            },
            type,
            eventId: this.currentEventId,
        };
        // add timeline to the stack
        this.timelineObj.addToTimeline(timelineObj);
    }
    logErrorEvent(content: $TSFixMe, category = 'exception'): void {
        const timelineObj = {
            category,
            data: {
                content,
            },
            type: this.utilObj.getErrorType().ERROR,
            eventId: this.currentEventId,
        };
        // add timeline to the stack
        this.timelineObj.addToTimeline(timelineObj);
    }
    logCustomTimelineEvent(timelineObj: $TSFixMe): void {
        timelineObj.eventId = this.currentEventId;

        // add timeline to the stack
        this.timelineObj.addToTimeline(timelineObj);
    }
    _logClickEvent(event: $TSFixMe, type: $TSFixMe): void {
        // preepare the event tree
        const content = this._getEventTree(event);
        const timelineObj = {
            category: `ui.${event.type}`,
            data: {
                content,
            },
            type,
            eventId: this.currentEventId,
        };
        // add timeline to the stack
        this.timelineObj.addToTimeline(timelineObj);
    }
    _getEventTree(event: $TSFixMe): void {
        const tree = [];
        const MAX_UP_TREE = 5; // we just want to go up the DOM for 5 times
        let current = 0;
        const fullPath = [];
        while (current < MAX_UP_TREE && event.path[current]) {
            // the current element has a path and we havent got up to 5 items, and its not an html tag
            const currentElem = event.path[current];
            if (currentElem.localName !== 'html') {
                let elementPath = '';

                elementPath += `${currentElem.localName}`;
                // attach ID if it has
                if (currentElem.id) {
                    elementPath += `${currentElem.id}`;
                }
                // for classes
                let classes = [];
                classes = currentElem.classList; // get all classes
                let classesForElement = '';
                classes.forEach((element: $TSFixMe) => {
                    classesForElement += `.${element}`;
                });
                elementPath += classesForElement;

                // get attributes
                const attributes = this._getElementAttributes(currentElem);
                if (attributes.length > 0) {
                    let attributesForElement = '';
                    attributes.forEach(element => {
                        if (element.key !== 'id') {
                            attributesForElement += `${element.key}=${element.value},`;
                        }
                    });
                    if (attributesForElement !== '') {
                        attributesForElement = attributesForElement.substring(
                            0,
                            attributesForElement.length - 1
                        );
                        elementPath += `[${attributesForElement}]`;
                    }
                }
                fullPath.push(elementPath);
                // setting up the whole object for the element
                tree.push({
                    name: currentElem.localName,
                    class: classes,
                    attribute: attributes,
                });
            }

            // increate the counter
            current = current + 1;
        }
        let path = fullPath.reverse();

        path = path.join(' > ');
        return { tree, path }; // return the final tree which contains a max of 5 elements
    }
    _getElementAttributes(elem: $TSFixMe): void {
        const attributes = [];
        const elementAtrributes = elem.attributes; // get all the attritubtes related to the element
        const excludedAttributes = ['class', 'value']; // exclude items that are nnot needed

        for (const [, value] of Object.entries(elementAtrributes)) {
            if (!excludedAttributes.includes(value.name)) {
                // if each attribute doesnt exist in the excluded one, we get the value and make an object

                const attribute = elem[value.name];
                attributes.push({
                    key: value.name,
                    value: attribute,
                });
            }
        }
        return attributes; // return the final list of attributes
    }
}
export default OneUptimeListener;
