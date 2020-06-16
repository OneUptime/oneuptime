# Fyipe Application Logger

A fyipe application logger that can be used to send logs about your applications created on your fypie dashboard

## Installation

### NPM Install
TODO 

### Development
- Clone repository
- run `npm i` to install dependencies
- run `npm run test` to run tests
- run `npm run build` to build for production.

<a name="module_api"></a>

## Basic Usage

```javascript
import Logger from 'log-js';

// constructor
const logger = new Logger('API_URL','APPLICATION_LOG_ID','APPLICATION_LOG_KEY')

// Sending a string log to the server
const item = 'This is a simple log';

logger.log(item).then(res => {
    // A success response
}).catch(err => {
    // An error response
})

// Sending a JSON object log to the server
const item = {
    user: 'Test User',
    page: {
        title: 'Landing Page',
        loadTime: '6s',
    }
}

logger.log(item).then(res => {
    // A success response
}).catch(err => {
    // An error response
})
```

## API Documentation

Main API to send logs to the server.


**Author**: HackerBay, Inc.

- [Fyipe Application Logger](#fyipe-application-logger)
  - [Installation](#installation)
    - [NPM Install](#npm-install)
    - [Development](#development)
  - [Basic Usage](#basic-usage)
  - [API Documentation](#api-documentation)
    - [new Logger(apiUrl, applicationId, applicationKey)](#new-loggerapiurl-applicationid-applicationkey)
      - [logger.log(log)](#loggerloglog)
      - [logger.warning(log)](#loggerwarninglog)
      - [logger.error(log)](#loggererrorlog)
  - [TODO](#todo)

<a name="logger_api--logger"></a>

### new Logger(apiUrl, applicationId, applicationKey)

Create a constructor from the class, which will be used to send logs to the server. Throws an error when the wrong Server URL is passed

**Kind**: Constructor 
**Returns**: <code>null</code>

| Param             | Type                    | Description                |
| ----------------- | ----------------------- | -------------------------- |
| apiUrl            | <code>string</code>     | The Server URL.            |
| applicationId     | <code>string</code>     | The Application Log ID.    |
| applicationKey    | <code>string</code>     | The Application Log Key.   |

#### logger.log(log)

Logs a request of type `info` to the server.

**Kind**: method of [<code>new Logger</code>](#logger_api--logger)
**Returns**: <code>Promise</code> - A promise response of a success or failure.

| Param     | Type                                         | Description                                                             |
| --------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| log       | <code>string</code> \| <code>Object</code>   | The content to the logged on the server.                                |

#### logger.warning(log)

Logs a request of type `warning` to the server.

**Kind**: method of [<code>new Logger</code>](#logger_api--logger)
**Returns**: <code>Promise</code> - A promise response of a success or failure.

| Param     | Type                                         | Description                                                             |
| --------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| warning   | <code>string</code> \| <code>Object</code>   | The content to the logged on the server.                                |

#### logger.error(log)

Logs a request of type `error` to the server.

**Kind**: method of [<code>new Logger</code>](#logger_api--logger)
**Returns**: <code>Promise</code> - A promise response of a success or failure.

| Param     | Type                                         | Description                                                             |
| --------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| error     | <code>string</code> \| <code>Object</code>   | The content to the logged on the server.                                |

## TODO
 - Tags
 - TBD 
