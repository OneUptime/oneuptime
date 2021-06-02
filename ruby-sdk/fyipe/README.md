# Fyipe SDK

A fyipe sdk for application logger that can be used to send logs about your applications created on your fypie dashboard which can also used for error tracking

## Installation

### Gem Install

Via Gem

```
 gem install fyipe
```

<a name="module_api"></a>

## Basic Usage for Logging

```ruby
# TODO require properly

# constructor
logger = FyipeLogger.new(
    'API_URL', # https://fyipe.com/api
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

## API Documentation

Main API to send logs to the server.

**Author**: HackerBay, Inc.

-   [Fyipe SDK](#fyipe-sdk)
    -   [Installation](#installation)
        -   [Gem Install](#gem-install)
    -   [Basic Usage for Logging](#basic-usage-for-logging)
    -   [API Documentation](#api-documentation)
        -   [FyipeLogger.new(apiUrl, applicationId, applicationKey)](#fyipeloggernewapiurl-applicationid-applicationkey)
            -   [logger.log(log, \tags)](#loggerloglog-tags)
            -   [logger.warning(warning, \tags)](#loggerwarningwarning-tags)
            -   [logger.error(error, \tags)](#loggererrorerror-tags)
    -   [Contribution](#contribution)

<a name="logger_api--logger"></a>

### FyipeLogger.new(apiUrl, applicationId, applicationKey)

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

**Kind**: method of [<code>FyipeLogger.new</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param | Type                                       | Description                                                 |
| ----- | ------------------------------------------ | ----------------------------------------------------------- |
| \log  | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| \tags | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

#### logger.warning(warning, \tags)

Logs a request of type `warning` to the server.

**Kind**: method of [<code>FyipeLogger.new</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param    | Type                                       | Description                                                 |
| -------- | ------------------------------------------ | ----------------------------------------------------------- |
| \warning | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| \tags    | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

#### logger.error(error, \tags)

Logs a request of type `error` to the server.

**Kind**: method of [<code>FyipeLogger.new</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param  | Type                                       | Description                                                 |
| ------ | ------------------------------------------ | ----------------------------------------------------------- |
| \error | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| \tags  | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

## Contribution

-   Clone repository
-   run `cd ruby-sdk/fyipe`
-   run `bundle install` to install dependencies
-   run `bundle exec rspec` to run tests
