# Fyipe Application Logger

A fyipe application logger that can be used to send logs about your applications created on your fypie dashboard

## Installation

### Composer Install

Via Composer

```
$ cd project
$ composer require fyipe/log-php
```

### Development

-   Clone repository
-   run `composer install` to install dependencies
-   run `composer test` to run tests

<a name="module_api"></a>

## Basic Usage

```php
import Logger from 'log-js';

// constructor
$logger = new Fyipe\Logger(
    'API_URL', // https:fyipe.com/api
    'APPLICATION_LOG_ID',
    'APPLICATION_LOG_KEY'
);


// Sending a string log to the server
$item = 'This is a simple log';

$response = $logger->log($item);
// response after logging a request
var_dump($response);


// Sending an object log to the server
$item = new stdClass();
$item->user = 'Test User';
$item->page = 'Landing Page';

$response = $logger->log($item);
// response after logging a request
var_dump($response);
```

## API Documentation

Main API to send logs to the server.

**Author**: HackerBay, Inc.

-   [Fyipe Application Logger](#fyipe-application-logger)
    -   [Installation](#installation)
        -   [Composer Install](#composer-install)
        -   [Development](#development)
    -   [Basic Usage](#basic-usage)
    -   [API Documentation](#api-documentation)
        -   [new Logger(apiUrl, applicationId, applicationKey)](#new-loggerapiurl-applicationid-applicationkey)
            -   [$logger->log($log)](#math-xmlnshttpwwww3org1998mathmathmlsemanticsmrowmilmimiomimigmimigmimiemimirmimomomomomilmimiomimigmimo-stretchyfalsemomrowannotation-encodingapplicationx-texlogger-logannotationsemanticsmathloggerloglog)
            -   [$logger->warning($warning)](#math-xmlnshttpwwww3org1998mathmathmlsemanticsmrowmilmimiomimigmimigmimiemimirmimomomomomiwmimiamimirmiminmimiimiminmimigmimo-stretchyfalsemomrowannotation-encodingapplicationx-texlogger-warningannotationsemanticsmathloggerwarningwarning)
            -   [logger.error(\$error)](#loggererrorerror)
    -   [TODO](#todo)

<a name="logger_api--logger"></a>

### new Logger(apiUrl, applicationId, applicationKey)

Create a constructor from the class, which will be used to send logs to the server.

**Kind**: Constructor
**Returns**: <code>null</code>

| Param            | Type                | Description              |
| ---------------- | ------------------- | ------------------------ |
| \$apiUrl         | <code>string</code> | The Server URL.          |
| \$applicationId  | <code>string</code> | The Application Log ID.  |
| \$applicationKey | <code>string</code> | The Application Log Key. |

#### $logger->log($log)

Logs a request of type `info` to the server.

**Kind**: method of [<code>new Fyipe\Logger</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param | Type                                       | Description                              |
| ----- | ------------------------------------------ | ---------------------------------------- |
| \$log | <code>string</code> \| <code>Object</code> | The content to the logged on the server. |

#### $logger->warning($warning)

Logs a request of type `warning` to the server.

**Kind**: method of [<code>new FyiLogger</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param     | Type                                       | Description                              |
| --------- | ------------------------------------------ | ---------------------------------------- |
| \$warning | <code>string</code> \| <code>Object</code> | The content to the logged on the server. |

#### logger.error(\$error)

Logs a request of type `error` to the server.

**Kind**: method of [<code>new Fyipe\Logger</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param   | Type                                       | Description                              |
| ------- | ------------------------------------------ | ---------------------------------------- |
| \$error | <code>string</code> \| <code>Object</code> | The content to the logged on the server. |

## TODO

-   Tags
-   TBD
