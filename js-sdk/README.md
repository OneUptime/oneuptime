[![npm](https://img.shields.io/npm/v/fyipe)](https://www.npmjs.com/package/fyipe)

# Fyipe Application Logger

A fyipe application logger that can be used to send logs about your applications created on your fypie dashboard. It also provides a way to track errors in your application.

## Installation

### NPM Install

You can install to use in your project:

```
$ cd project
$ npm install fyipe
```

<a name="module_api"></a>

## Basic Usage

### In a Node.js Project

```javascript
// In a FrontEnd Environment
import { Logger } from 'fyipe';

// In a Backend Environment
const { Logger } = require('fyipe');

// in a Backend Environment with ES6
import Fyipe from 'fyipe';
const { Logger } = Fyipe;

// constructor

const logger = new Logger(
    'API_URL', // https://fyipe.com/api
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

### In the Browser

```javascript
<script src="https://unpkg.com/fyipe"></script>
<script>
    function logError() {
        // constructor
        const logger = new Fyipe.Logger(
            'API_URL', // https://fyipe.com/api
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

### Error Tracking APIs

```javascript
// In a FrontEnd Environment
import { ErrorTracker } from 'fyipe';

// In a Backend Environment
const { ErrorTracker } = require('fyipe');

// in a Backend Environment with ES6
import Fyipe from 'fyipe';
const { ErrorTracker } = Fyipe;

// set up tracking configurations
const options = {
    maxTimeline: 10,
    captureCodeSnippet: true,
};
// constructor
const tracker = new ErrorTracker(
    'API_URL', // https://fyipe.com/api
    'ERROR_TRACKER_ID',
    'ERROR_TRACKER_KEY',
    options // Optional Field
);

// capturing a timeline manually
tracker.addToTimeline(
    'payment',
    { account: 'debit', amount: '6000.00', userId: 401 },
    'info'
);

// setting custom tags
tracker.setTag('category', 'Customer'); // a single tag
tracker.setTags([
    { key: 'type', value: 'notice' },
    { key: 'location', value: 'online' },
]); // an array of tags

// capturing error exception manually and sent to your fyipe dashboard
try {
    // your code logic
    NonExistingMethodCall();
} catch (error) {
    tracker.captureException(error); // returns a promise
}

// capturing error message
tracker.captureMessage('Message'); // returns a promise
```

## API Documentation

Main API to send logs to the server.

**Author**: HackerBay, Inc.

-   [Fyipe Application Logger](#fyipe-application-logger)
    -   [Installation](#installation)
        -   [NPM Install](#npm-install)
    -   [Basic Usage](#basic-usage)
        -   [In a Node.js Project](#in-a-nodejs-project)
        -   [In the Browser](#in-the-browser)
        -   [Error Tracking APIs](#error-tracking-apis)
    -   [API Documentation](#api-documentation)
        -   [new Logger(apiUrl, applicationId, applicationKey)](#new-loggerapiurl-applicationid-applicationkey)
        -   [new ErrorTracker(apiUrl, errorTrackerId, errorTrackerKey, options)](#new-errortrackerapiurl-errortrackerid-errortrackerkey-options)
            -   [logger.log(log, tags)](#loggerloglog-tags)
            -   [logger.warning(log, tags)](#loggerwarninglog-tags)
            -   [logger.error(log, tags)](#loggererrorlog-tags)
            -   [tracker.setTag(key, value)](#trackersettagkey-value)
            -   [tracker.setTags([{key, value}])](#trackersettagskey-value)
            -   [tracker.setFingerprint(fingerprint)](#trackersetfingerprintfingerprint)
            -   [tracker.addToTimeline(category, content, type)](#trackeraddtotimelinecategory-content-type)
            -   [tracker.captureMessage(message)](#trackercapturemessagemessage)
            -   [tracker.captureException(error)](#trackercaptureexceptionerror)
    -   [Contribution](#contribution)

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

### new ErrorTracker(apiUrl, errorTrackerId, errorTrackerKey, options)

Create a constructor from the class, which will be used to track events and exceptions to be sent to the server.

**Kind**: Constructor
**Returns**: <code>null</code>

| Param           | Type                | Description                                         |
| --------------- | ------------------- | --------------------------------------------------- |
| apiUrl          | <code>string</code> | The Server URL.                                     |
| errorTrackerId  | <code>string</code> | The Error Tracker ID.                               |
| errorTrackerKey | <code>string</code> | The Error Tracker Key.                              |
| options         | <code>object</code> | Set of configuration to be used for error tracking. |

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

#### tracker.setTag(key, value)

Set a tag for the error to be captured.

**Kind**: method of [<code>new ErrorTracker</code>](#logger_api--logger)
**Returns**: <code>null</code>

| Param | Type                | Description            |
| ----- | ------------------- | ---------------------- |
| key   | <code>string</code> | The key for the tag.   |
| value | <code>string</code> | The value for thr tag. |

#### tracker.setTags([{key, value}])

Set an array of tags for the error to be captured.

**Kind**: method of [<code>new ErrorTracker</code>](#logger_api--logger)
**Returns**: <code>null</code>

| Param | Type                | Description            |
| ----- | ------------------- | ---------------------- |
| key   | <code>string</code> | The key for the tag.   |
| value | <code>string</code> | The value for the tag. |

#### tracker.setFingerprint(fingerprint)

Set fingerprint for the next error to be captured.

**Kind**: method of [<code>new ErrorTracker</code>](#logger_api--logger)
**Returns**: <code>null</code>

| Param       | Type                                                 | Description                                                   |
| ----------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| fingerprint | <code>string</code> \| <code>array of strings</code> | The set of string used to group error messages on the server. |

#### tracker.addToTimeline(category, content, type)

Add a custom timeline element to the next error to be sent to the server

**Kind**: method of [<code>new ErrorTracker</code>](#logger_api--logger)
**Returns**: <code>null</code>

| Param    | Type                                       | Description                         |
| -------- | ------------------------------------------ | ----------------------------------- |
| category | <code>string</code>                        | The category of the timeline event. |
| content  | <code>string</code> \| <code>Object</code> | The content of the timeline event.  |
| type     | <code>string</code>                        | The type of timeline event.         |

#### tracker.captureMessage(message)

Capture a custom error message to be sent to the server

**Kind**: method of [<code>new ErrorTracker</code>](#logger_api--logger)
**Returns**: <code>null</code>

| Param   | Type                | Description                           |
| ------- | ------------------- | ------------------------------------- |
| message | <code>string</code> | The message to be sent to the server. |

#### tracker.captureException(error)

Capture a custom error object to be sent to the server

**Kind**: method of [<code>new ErrorTracker</code>](#logger_api--logger)
**Returns**: <code>null</code>

| Param | Type                | Description                                |
| ----- | ------------------- | ------------------------------------------ |
| error | <code>object</code> | The Error Object to be sent to the server. |

## Contribution

-   Clone repository
-   run `npm i` to install dependencies
-   run `npm run test` to run tests
-   run `npm run build` to build for production.
