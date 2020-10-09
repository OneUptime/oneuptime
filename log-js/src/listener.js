/* eslint-disable no-console */
import FyipeTimelineManager from './timelineManager';

class FyipeListiner {
    // TODO set up event type properly
    #eventType = {
        INFO: 'info',
        WARNING: 'warning',
        ERROR: 'error',
        HTTP: 'http',
    };
    #BASE_URL = 'http://test'; // TODO proper base url config
    #timelineObj;
    constructor() {
        this.#timelineObj = new FyipeTimelineManager();
        this._init();
    }
    _init() {
        this._setUpConsoleListener();
        this._setUpDomListener();
        this._setUpFetchListener();
        this._setUpXhrListener();
    }
    getTimeline() {
        // this always get the current state of the timeline array
        return this.#timelineObj.getTimeline();
    }
    // set up console listener
    _setUpConsoleListener() {
        const _this = this;
        // set up a console listener get the current content, pass it to the normal console and also pass it to the timeline event listener
        const console = (function(oldCons) {
            return {
                log: function(text) {
                    oldCons.log(text);
                    // _this._logConsoleEvent(text, _this.#eventType.INFO);
                },
                info: function(text) {
                    oldCons.info(text);
                    _this._logConsoleEvent(text, _this.#eventType.INFO);
                },
                warn: function(text) {
                    oldCons.warn(text);
                    _this._logConsoleEvent(text, _this.#eventType.WARNING);
                },
                error: function(text) {
                    oldCons.error(text);
                    _this._logConsoleEvent(text, _this.#eventType.ERROR);
                },
            };
        })(window.console);
        //Then redefine the old console
        window.console = console;
    }
    // set up dom listener
    _setUpDomListener() {
        // listen to click and key event
        // todo listen to just keypress and click
        Object.keys(window).forEach(key => {
            if (/^on(key|click)/.test(key)) {
                window.addEventListener(key.slice(2), event => {
                    // set up how to send this log to the server
                    this._logClickEvent(event, this.#eventType.INFO);
                });
            }
        });
    }
    // set up xhr listener
    _setUpXhrListener() {
        const open = window.XMLHttpRequest.prototype.open;
        const _this = this;

        function openReplacement(method, url) {
            this.addEventListener('load', function() {
                // check if it is not a request to Fyipe servers
                if (!url.startsWith(_this.#BASE_URL)) {
                    const obj = {
                        method,
                        url,
                        status_code: this.status,
                    };
                    _this._logXHREvent(obj, _this.#eventType.HTTP);
                }
            });
            // set up how to send this log to the server to take this log
            return open.apply(this, arguments);
        }

        window.XMLHttpRequest.prototype.open = openReplacement;
    }
    // set up fetch listener
    _setUpFetchListener() {
        const currentFetch = window.fetch;
        const _this = this;
        window.fetch = function(url, options) {
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
            if (!url.startsWith(_this.#BASE_URL)) {
                _this._logFetchEvent(obj, _this.#eventType.HTTP);
            }

            return promise;
        };
    }
    _logConsoleEvent(content, type) {
        const timelineObj = {
            category: 'console',
            data: {
                content,
            },
            type,
        };
        // add timeline to the stack
        this.#timelineObj.addToTimeline(timelineObj);
    }
    _logXHREvent(content, type) {
        const timelineObj = {
            category: 'xhr',
            data: {
                content,
            },
            type,
        };
        // add timeline to the stack
        this.#timelineObj.addToTimeline(timelineObj);
    }
    _logFetchEvent(content, type) {
        const timelineObj = {
            category: 'fetch',
            data: {
                content,
            },
            type,
        };
        // add timeline to the stack
        this.#timelineObj.addToTimeline(timelineObj);
    }
    _logClickEvent(event, type) {
        // preepare the event tree
        const content = this._getEventTree(event);
        const timelineObj = {
            category: `ui.${event.type}`,
            data: {
                content,
            },
            type,
        };
        // add timeline to the stack
        this.#timelineObj.addToTimeline(timelineObj);
    }
    _getEventTree(event) {
        const tree = [];
        const MAX_UP_TREE = 5; // we just want to go up the DOM for 5 times
        let current = 0;
        while (current < MAX_UP_TREE && event.path[current]) {
            // the current even has a path and we havent got up to 5 items
            const currentElem = event.path[current];
            // for classes
            let classes = [];
            classes = currentElem.classList; // get all classes

            // get attributes
            const attributes = this._getElementAttributes(currentElem);

            // setting up the whole object for the element
            tree.push({
                name: currentElem.localName,
                class: classes,
                attribute: attributes,
            });

            // increate the counter
            current = current + 1;
        }
        return tree; // return the final tree which contains a max of 5 elements
    }
    _getElementAttributes(elem) {
        const attributes = [];
        const elementAtrributes = elem.attributes; // get all the attritubtes related to the element
        const excludedAttributes = ['class', 'value']; // exclude items that are nnot needed
        // eslint-disable-next-line no-unused-vars
        for (const [key, value] of Object.entries(elementAtrributes)) {
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
export default FyipeListiner;
