[![npm](https://img.shields.io/npm/v/fyipe-log-js)](https://www.npmjs.com/package/fyipe-log-js)

# Fyipe Application Logger

A fyipe application logger that can be used to send logs about your applications created on your fypie dashboard

## Installation

### NPM Install

You can install to use in your project:

```
$ cd project
$ npm install fyipe-log-js
```

### Development

-   Clone repository
-   run `npm i` to install dependencies
-   run `npm run test` to run tests
-   run `npm run build` to build for production.

<a name="module_api"></a>

## Basic Usage

```javascript
import Logger from 'log-js';

// constructor
const logger = new Logger(
    'API_URL', // https:fyipe.com/api
    'APPLICATION_LOG_ID',
    'APPLICATION_LOG_KEY'
);

// Sending a string log to the server
const item = 'This is a simple log';

logger.log(item); // returns a promise

// Sending a JSON object log to the server
const item = {
    user: 'Test User',
    page: {
        title: 'Landing Page',
        loadTime: '6s',
    },
};

logger.log(item); // returns a promise

// Alternatively, Logs can be tagged with either a string or an array of strings
const item = 'This is a simple log';
const tags = ['server', 'script', 'dev'];
logger.log(item, tags);

const tag = 'testing';
logger.log(item, tag);
```

## API Documentation

Main API to send logs to the server.

**Author**: HackerBay, Inc.

-   [Fyipe Application Logger](#fyipe-application-logger)
    -   [Installation](#installation)
        -   [NPM Install](#npm-install)
        -   [Development](#development)
    -   [Basic Usage](#basic-usage)
    -   [API Documentation](#api-documentation)
        -   [new Logger(apiUrl, applicationId, applicationKey)](#new-loggerapiurl-applicationid-applicationkey)
            -   [logger.log(log, tags)](#loggerloglog-tags)
            -   [logger.warning(log, tags)](#loggerwarninglog-tags)
            -   [logger.error(log, tags)](#loggererrorlog-tags)

<a name="logger_api--logger"></a>

### new Logger(apiUrl, applicationId, applicationKey)

Create a constructor from the class, which will be used to send logs to the server.

**Kind**: Constructor
**Returns**: <code>null</code>

| Param          | Type                | Description              |
| -------------- | ------------------- | ------------------------ |
| apiUrl         | <code>string</code> | The Server URL.          |
| applicationId  | <code>string</code> | The Application Log ID.  |
| applicationKey | <code>string</code> | The Application Log Key. |

#### logger.log(log, tags)

Logs a request of type `info` to the server.

**Kind**: method of [<code>new Logger</code>](#logger_api--logger)
**Returns**: <code>Promise</code> - A promise response of a success or failure.

| Param | Type                                       | Description                                                 |
| ----- | ------------------------------------------ | ----------------------------------------------------------- |
| log   | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| tags  | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

#### logger.warning(log, tags)

Logs a request of type `warning` to the server.

**Kind**: method of [<code>new Logger</code>](#logger_api--logger)
**Returns**: <code>Promise</code> - A promise response of a success or failure.

| Param | Type                                       | Description                                                 |
| ----- | ------------------------------------------ | ----------------------------------------------------------- |
| log   | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| tags  | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

#### logger.error(log, tags)

Logs a request of type `error` to the server.

**Kind**: method of [<code>new Logger</code>](#logger_api--logger)
**Returns**: <code>Promise</code> - A promise response of a success or failure.

| Param | Type                                       | Description                                                 |
| ----- | ------------------------------------------ | ----------------------------------------------------------- |
| log   | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| tags  | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |
