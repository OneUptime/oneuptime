# OneUptime SDK

A oneuptime sdk for application logger that can be used to send logs about your applications created on your fypie dashboard which can also used for error tracking

## Installation

### Gem Install

Via Gem

```
 gem install oneuptime
```

<a name="module_api"></a>

## Basic Usage for Logging

```ruby
require 'oneuptime'

# constructor
logger = OneUptimeLogger.new(
    'API_URL', # https://oneuptime.com/api
    'APPLICATION_LOG_ID',
    'APPLICATION_LOG_KEY'
)


# Sending a string log to the server
item = 'This is a simple log'

response = logger.log(item)

# response after logging a request
puts response


# Sending an object log to the server
item = {
    "name" => "Tony Lewinsky",
    "location" => "Liverpool"
}

response = logger.log(item)
# response after logging a request
puts response

# alternatively, tags can be added to the logged item.
item = 'This is a simple log'
# using a tag string
tag = 'server-side-error'
response = logger.log(item, tag)
# response after logging a request
puts response

# Using an array of strings
tags = ['error', 'server']
response = logger.log(item, tags)
# response after logging a request
puts response
```

## Basic Usage for Tracking

```ruby
require 'oneuptime'

# set up tracking configurations
options = {
    "maxTimeline": 50,
    "captureCodeSnippet": true
}

# constructor
tracker = OneUptimeLogger.new(
    'API_URL', # https://oneuptime.com/api
    'ERROR_TRACKER_ID',
    'ERROR_TRACKER_KEY',
    options # optional
)

# capturing a timeline manually
timelineContent = {}

timelineContent["account"] = "debit"
timelineContent["amount"] = "6000.00"
timelineContent["userId"] = 471
tracker.addToTimeline('payment', timelineContent, 'info')

# setting custom tags
tracker.setTag('category', 'QA Tester') # a single tag

# multiple tags
tags = []

# create two tags
tagOne = {}
tagOne["key"] = 'type'
tagOne["value"] = 'notification'
tagTwo = {}
tagTwo["key"] = 'location'
tagTwo["value"] = 'Oslo'

# add the two items to the array
tags = [tagOne, tagTwo]

# setting the array of tags
tracker.setTags(tags)


# all error exception captured are sent to your oneuptime dashboard

# capturing errors in a begin and rescue
begin
    # some code that might fail
    result = 5/0 # Should throw a division by zero error
rescue => ex
    tracker.captureException(ex)
end

# capturing errors using the message signature
tracker.captureMessage('some error text')

# capturing errors authomatically
NonExistingMethod() # calling this will trigger an error and its sent to your oneuptime dashboard

```

## API Documentation

Main API to send logs to the server.

**Author**: HackerBay, Inc.

-   [OneUptime SDK](#oneuptime-sdk)
    -   [Installation](#installation)
        -   [Gem Install](#gem-install)
    -   [Basic Usage for Logging](#basic-usage-for-logging)
    -   [Basic Usage for Tracking](#basic-usage-for-tracking)
    -   [API Documentation](#api-documentation)
        -   [OneUptimeLogger.new(apiUrl, applicationId, applicationKey)](#oneuptimeloggernewapiurl-applicationid-applicationkey)
            -   [logger.log(log, \tags)](#loggerloglog-tags)
            -   [logger.warning(warning, \tags)](#loggerwarningwarning-tags)
            -   [logger.error(error, \tags)](#loggererrorerror-tags)
        -   [OneUptimeTracker.new(apiUrl, errorTrackerId, errorTrackerKey)](#oneuptimetrackernewapiurl-errortrackerid-errortrackerkey)
            -   [options](#options)
            -   [tracker.setTag(key, value)](#trackersettagkey-value)
            -   [tracker.setTags([{key, value}])](#trackersettagskey-value)
            -   [tracker.setFingerprint(fingerprint)](#trackersetfingerprintfingerprint)
            -   [tracker.addToTimeline(category, content, type)](#trackeraddtotimelinecategory-content-type)
            -   [tracker.captureMessage(message)](#trackercapturemessagemessage)
            -   [tracker.captureException(error)](#trackercaptureexceptionerror)
    -   [Contribution](#contribution)

<a name="logger_api--logger"></a>

### OneUptimeLogger.new(apiUrl, applicationId, applicationKey)

Create a constructor from the class, which will be used to send logs to the server.

**Kind**: Constructor
**Returns**: <code>null</code>

| Param           | Type                | Description              |
| --------------- | ------------------- | ------------------------ |
| \apiUrl         | <code>string</code> | The Server URL.          |
| \applicationId  | <code>string</code> | The Application Log ID.  |
| \applicationKey | <code>string</code> | The Application Log Key. |

#### logger.log(log, \tags)

Logs a request of type `info` to the server.

**Kind**: method of [<code>OneUptimeLogger.new</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param | Type                                       | Description                                                 |
| ----- | ------------------------------------------ | ----------------------------------------------------------- |
| \log  | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| \tags | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

#### logger.warning(warning, \tags)

Logs a request of type `warning` to the server.

**Kind**: method of [<code>OneUptimeLogger.new</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param    | Type                                       | Description                                                 |
| -------- | ------------------------------------------ | ----------------------------------------------------------- |
| \warning | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| \tags    | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

#### logger.error(error, \tags)

Logs a request of type `error` to the server.

**Kind**: method of [<code>OneUptimeLogger.new</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param  | Type                                       | Description                                                 |
| ------ | ------------------------------------------ | ----------------------------------------------------------- |
| \error | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| \tags  | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

<a name="tracker_api--tracker"></a>

### OneUptimeTracker.new(apiUrl, errorTrackerId, errorTrackerKey)

Create a constructor from the class, which will be used to track errors sent to the server.

**Kind**: Constructor
**Returns**: <code>null</code>

| Param           | Type                | Description                                 |
| --------------- | ------------------- | ------------------------------------------- |
| apiUrl          | <code>string</code> | The Server URL.                             |
| errorTrackerId  | <code>string</code> | The Error Tracker ID.                       |
| errorTrackerKey | <code>string</code> | The Error Tracker Key.                      |
| option          | <code>object</code> | The options to be considred by the tracker. |

#### options

| Param              | Type                 | Description                                                                                               |
| ------------------ | -------------------- | --------------------------------------------------------------------------------------------------------- |
| maxTimeline        | <code>int</code>     | The total amount of timeline that should be captured, defaults to 5                                       |
| captureCodeSnippet | <code>boolean</code> | When set as `true` stack traces are automatically attached to all error sent to your oneuptime dashboard. |

#### tracker.setTag(key, value)

Set tag for the error to be sent to the server.

**Kind**: method of [<code>OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param | Type                | Description            |
| ----- | ------------------- | ---------------------- |
| key   | <code>string</code> | The key for the tag.   |
| value | <code>string</code> | The value for the tag. |

#### tracker.setTags([{key, value}])

Set multiple tags for the error to be sent to the server. Takes in a list

**Kind**: method of [<code>OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param | Type                | Description            |
| ----- | ------------------- | ---------------------- |
| key   | <code>string</code> | The key for the tag.   |
| value | <code>string</code> | The value for the tag. |

#### tracker.setFingerprint(fingerprint)

Set fingerprint for the next error to be captured.

**Kind**: method of [<code>OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param       | Type                                                | Description                                                   |
| ----------- | --------------------------------------------------- | ------------------------------------------------------------- |
| fingerprint | <code>string</code> \| <code>list of strings</code> | The set of string used to group error messages on the server. |

#### tracker.addToTimeline(category, content, type)

Add a custom timeline element to the next error to be sent to the server

**Kind**: method of [<code>OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param    | Type                                       | Description                         |
| -------- | ------------------------------------------ | ----------------------------------- |
| category | <code>string</code>                        | The category of the timeline event. |
| content  | <code>string</code> \| <code>object</code> | The content of the timeline event.  |
| type     | <code>string</code>                        | The type of timeline event.         |

#### tracker.captureMessage(message)

Capture a custom error message to be sent to the server

**Kind**: method of [<code>OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>Promise</code>

| Param   | Type                | Description                           |
| ------- | ------------------- | ------------------------------------- |
| message | <code>string</code> | The message to be sent to the server. |

#### tracker.captureException(error)

Capture a custom error object to be sent to the server

**Kind**: method of [<code>OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>Promise</code>

| Param | Type                          | Description                                |
| ----- | ----------------------------- | ------------------------------------------ |
| error | <code>Exception object</code> | The Error Object to be sent to the server. |

## Contribution

-   Clone repository
-   run `cd ruby-sdk/oneuptime`
-   run `bundle install` to install dependencies
-   run `bundle exec rspec` to run tests
