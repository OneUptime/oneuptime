# OneUptime Logger Quickstart

A oneuptime application logger that can be used to send logs about your applications and log them to oneuptime dashboard.

## Installation

### NPM Install

You can install to use in your project:

```
$ cd project
$ npm install oneuptime
```

## Basic Usage

### Using it as an npm module

```javascript
// In a FrontEnd Environment
// If your env supports import
import OneUptime from 'oneuptime';

// If your env supports require
const OneUptime = require('oneuptime');

// set up tracking configurations
const options = {
    maxTimeline: 10,
    captureCodeSnippet: true,
};

// constructor
const logger = new OneUptime.Logger(
    'API_URL', // https://oneuptime.com/api
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

### Using it as a script tag

```javascript
<script src="https://unpkg.com/oneuptime"></script>
<script>
    function logError() {
        // constructor
        const logger = new OneUptime.Logger(
            'API_URL', // https://oneuptime.com/api
            'APPLICATION_LOG_ID',
            'APPLICATION_LOG_KEY'
        );

        // Sending a string log to the server
        const item = 'This is a simple log';

        logger.log(item); // returns a promise

        // Alternatively, Logs can be tagged with either a string or an array of strings
        const item = 'This is a simple log';
        const tags = ['server', 'monitor'];
        logger.log(item, tags);
    }
</script>
```

## API Reference

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
