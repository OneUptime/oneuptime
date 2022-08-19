# OneUptime SDK

A oneuptime sdk for application logger that can be used to send logs about your applications created on your fypie dashboard which can also used for error tracking

## Installation

### Composer Install

Via Composer

```
$ composer require oneuptime/log-php
```

<a name="module_api"></a>

## Basic Usage for Logging

```php
use OneUptime\OneUptimeLogger;

// constructor
$logger = new OneUptimeLogger(
    'API_URL', // https://oneuptime.com/api
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
$tag = 'server-side-error';
$response = $logger->log($item, $tag);
// response after logging a request
var_dump($response);

// Using an array of strings
$tags = ['error', 'server'];
$response = $logger->log($item, $tags);
// response after logging a request
var_dump($response);
```

## Basic Usage for Tracking

```php
use OneUptime\OneUptimeTracker;

// set up tracking configurations, this is entirely optional
$option = new stdClass();
$option->maxTimeline = 5; // determine the maximum number of items allowed as timeline elements
$option->captureCodeSnippet = true; // determine if you want the library to scan your code base for the error code snippet
// constructor
$tracker = new OneUptimeTracker(
    'API_URL', // https://oneuptime.com/api
    'ERROR_TRACKER_ID',
    'ERROR_TRACKER_KEY',
    $option // optional
);

// capturing a timeline manually
$timelineContent = new stdClass();
$timelineContent->account = 'debit';
$timelineContent->amount = '6000.00';
$timelineContent->userId = 471;
$tracker->addToTimeline('payment', $timelineContent, 'info');

// setting custom tags
$tracker->setTag('category', 'QA Tester'); // a single tag

// multiple tags
$tags = [];

// create two tags
$tagOne = new stdClass();
$tagOne->key = 'type';
$tagOne->value = 'notification';
$tagTwo = new stdClass();
$tagTwo->key = 'location';
$tagTwo->value = 'Oslo';

// add the two items to the array
array_push($tags, $tagOne, $tagTwo);

// setting the array of tags
$tracker->setTags($tags);

// capturing errors in a try and catch
try {
    // some code that might fail
} catch(Exception $e) {
    $tracker->captureException($e); // this is sent to your oneuptime dashboard
}

// capturing errors using the message signature
$tracker->captureMessage('some error text');

// capturing errors authomatically

NonExistingMethod(); // calling this will trigger an error and its sent to your oneuptime dashboard
```

## API Documentation

Main API to send logs to the server.

**Author**: OneUptime Limited.

-   [OneUptime SDK](#oneuptime-sdk)
    -   [Installation](#installation)
        -   [Composer Install](#composer-install)
    -   [Basic Usage for Logging](#basic-usage-for-logging)
    -   [Basic Usage for Tracking](#basic-usage-for-tracking)
    -   [API Documentation](#api-documentation)
        -   [new OneUptimeLogger($apiUrl, $applicationId, \$applicationKey)](#new-oneuptimeloggerapiurl-applicationid-applicationkey)
            -   [$logger->log($log, \$tags)](#logger-loglog-tags)
            -   [$logger->warning($warning, \$tags)](#logger-warningwarning-tags)
            -   [$logger->error($error, \$tags)](#logger-errorerror-tags)
        -   [new OneUptimeTracker($apiUrl, $errorTrackerId, $errorTrackerKey, $option)](#new-oneuptimetrackerapiurl-errortrackerid-errortrackerkey-option)
            -   [\$options](#options)
            -   [$tracker->setTag($key, \$value)](#tracker-settagkey-value)
            -   [$tracker->setTags([$key, \$value])](#tracker-settagskey-value)
            -   [$tracker->setFingerprint($fingerprint)](#tracker-setfingerprintfingerprint)
            -   [$tracker->addToTimeline($category, $content, $type)](#tracker-addtotimelinecategory-content-type)
            -   [$tracker->captureMessage($message)](#tracker-capturemessagemessage)
            -   [$tracker->captureException($error)](#tracker-captureexceptionerror)
    -   [Contribution](#contribution)

<a name="logger_api--logger"></a>

### new OneUptimeLogger($apiUrl, $applicationId, \$applicationKey)

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

**Kind**: method of [<code>new OneUptime\OneUptimeLogger</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param  | Type                                       | Description                                                 |
| ------ | ------------------------------------------ | ----------------------------------------------------------- |
| \$log  | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| \$tags | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

#### $logger->warning($warning, \$tags)

Logs a request of type `warning` to the server.

**Kind**: method of [<code>new OneUptime\OneUptimeLogger</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param     | Type                                       | Description                                                 |
| --------- | ------------------------------------------ | ----------------------------------------------------------- |
| \$warning | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| \$tags    | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

#### $logger->error($error, \$tags)

Logs a request of type `error` to the server.

**Kind**: method of [<code>new OneUptime\OneUptimeLogger</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param   | Type                                       | Description                                                 |
| ------- | ------------------------------------------ | ----------------------------------------------------------- |
| \$error | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| \$tags  | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

<a name="tracker_api--tracker"></a>

### new OneUptimeTracker($apiUrl, $errorTrackerId, $errorTrackerKey, $option)

Create a constructor from the class, which will be used to track errors sent to the server.

**Kind**: Constructor
**Returns**: <code>null</code>

| Param             | Type                | Description                                 |
| ----------------- | ------------------- | ------------------------------------------- |
| \$apiUrl          | <code>string</code> | The Server URL.                             |
| \$errorTrackerId  | <code>string</code> | The Error Tracker ID.                       |
| \$errorTrackerKey | <code>string</code> | The Error Trakcer Key.                      |
| \$option          | <code>object</code> | The options to be considred by the tracker. |

#### \$options

| Param                | Type                 | Description                                                                                               |
| -------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| \$maxTimeline        | <code>int</code>     | The total amount of timeline that should be captured, defaults to 5                                       |
| \$captureCodeSnippet | <code>boolean</code> | When set as `true` stack traces are automatically attached to all error sent to your oneuptime dashboard. |

#### $tracker->setTag($key, \$value)

Set tag for the error to be sent to the server.

**Kind**: method of [<code>new OneUptime\OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param   | Type                | Description            |
| ------- | ------------------- | ---------------------- |
| \$key   | <code>string</code> | The key for the tag.   |
| \$value | <code>string</code> | The value for the tag. |

#### $tracker->setTags([$key, \$value])

Set multiple tags for the error to be sent to the server. Takes in an array

**Kind**: method of [<code>new OneUptime\OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param   | Type                | Description            |
| ------- | ------------------- | ---------------------- |
| \$key   | <code>string</code> | The key for the tag.   |
| \$value | <code>string</code> | The value for the tag. |

#### $tracker->setFingerprint($fingerprint)

Set fingerprint for the next error to be captured.

**Kind**: method of [<code>new OneUptime\OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param         | Type                                                 | Description                                                   |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| \$fingerprint | <code>string</code> \| <code>array of strings</code> | The set of string used to group error messages on the server. |

#### $tracker->addToTimeline($category, $content, $type)

Add a custom timeline element to the next error to be sent to the server

**Kind**: method of [<code>new OneUptime\OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param      | Type                                       | Description                         |
| ---------- | ------------------------------------------ | ----------------------------------- |
| \$category | <code>string</code>                        | The category of the timeline event. |
| \$content  | <code>string</code> \| <code>Object</code> | The content of the timeline event.  |
| \$type     | <code>string</code>                        | The type of timeline event.         |

#### $tracker->captureMessage($message)

Capture a custom error message to be sent to the server

**Kind**: method of [<code>new OneUptime\OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>Promise</code>

| Param     | Type                | Description                           |
| --------- | ------------------- | ------------------------------------- |
| \$message | <code>string</code> | The message to be sent to the server. |

#### $tracker->captureException($error)

Capture a custom error object to be sent to the server

**Kind**: method of [<code>new OneUptime\OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>Promise</code>

| Param   | Type                | Description                                |
| ------- | ------------------- | ------------------------------------------ |
| \$error | <code>object</code> | The Error Object to be sent to the server. |

## Contribution

-   Clone repository
-   run `composer install` to install dependencies
-   run `composer test` to run tests
