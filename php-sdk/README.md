# Fyipe Application Logger

A fyipe application logger that can be used to send logs about your applications created on your fypie dashboard

## Installation

### Composer Install

Via Composer

```
$ cd project
$ composer require fyipe/sdk
```

<a name="module_api"></a>

## Basic Usage

```php
use Fyipe\FyipeLogger;

// constructor
$logger = new Fyipe\FyipeLogger(
    'API_URL', // https://fyipe.com/api
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

// alternatively, tags can be added to the logged item.
$item = 'This is a simple log';
// using a tag string
$tag = 'server-side-error'
$response = $logger->log($item, $tag);
// response after logging a request
var_dump($response);

// Using an array of strings
$tags = ['error', 'server']
$response = $logger->log($item, $tags);
// response after logging a request
var_dump($response);
```

## API Documentation

Main API to send logs to the server.

**Author**: HackerBay, Inc.

-   [Fyipe Application Logger](#fyipe-application-logger)
    -   [Installation](#installation)
        -   [Composer Install](#composer-install)
    -   [Basic Usage](#basic-usage)
    -   [API Documentation](#api-documentation)
        -   [new FyipeLogger($apiUrl, $applicationId, \$applicationKey)](#new-fyipeloggerapiurl-applicationid-applicationkey)
            -   [$logger->log($log, \$tags)](#logger-loglog-tags)
            -   [$logger->warning($warning, \$tags)](#logger-warningwarning-tags)
            -   [$logger->error($error, \$tags)](#logger-errorerror-tags)
    -   [Contribution](#contribution)

<a name="logger_api--logger"></a>

### new FyipeLogger($apiUrl, $applicationId, \$applicationKey)

Create a constructor from the class, which will be used to send logs to the server.

**Kind**: Constructor
**Returns**: <code>null</code>

| Param            | Type                | Description              |
| ---------------- | ------------------- | ------------------------ |
| \$apiUrl         | <code>string</code> | The Server URL.          |
| \$applicationId  | <code>string</code> | The Application Log ID.  |
| \$applicationKey | <code>string</code> | The Application Log Key. |

#### $logger->log($log, \$tags)

Logs a request of type `info` to the server.

**Kind**: method of [<code>new Fyipe\FyipeLogger</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param  | Type                                       | Description                                                 |
| ------ | ------------------------------------------ | ----------------------------------------------------------- |
| \$log  | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| \$tags | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

#### $logger->warning($warning, \$tags)

Logs a request of type `warning` to the server.

**Kind**: method of [<code>new Fyipe\FyipeLogger</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param     | Type                                       | Description                                                 |
| --------- | ------------------------------------------ | ----------------------------------------------------------- |
| \$warning | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| \$tags    | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

#### $logger->error($error, \$tags)

Logs a request of type `error` to the server.

**Kind**: method of [<code>new Fyipe\FyipeLogger</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param   | Type                                       | Description                                                 |
| ------- | ------------------------------------------ | ----------------------------------------------------------- |
| \$error | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| \$tags  | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

## Contribution

-   Clone repository
-   run `composer install` to install dependencies
-   run `composer test` to run tests
