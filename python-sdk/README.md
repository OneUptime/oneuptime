# Fyipe SDK

A fyipe sdk for application logger that can be used to send logs about your applications created on your fypie dashboard which can also used for error tracking

## Usage

Usage can be found at [Examples and Usage](README.rst)

## API Documentation

Main API to send logs to the server.

**Author**: HackerBay, Inc.

<a name="logger_api--logger"></a>

### FyipeLogger(apiUrl, applicationId, applicationKey)

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

**Kind**: method of [<code>FyipeLogger</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param | Type                                       | Description                                                 |
| ----- | ------------------------------------------ | ----------------------------------------------------------- |
| log   | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| tags  | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

#### logger.warning(warning, tags)

Logs a request of type `warning` to the server.

**Kind**: method of [<code>FyipeLogger</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param   | Type                                       | Description                                                 |
| ------- | ------------------------------------------ | ----------------------------------------------------------- |
| warning | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| tags    | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |

#### logger.error(error, tags)

Logs a request of type `error` to the server.

**Kind**: method of [<code>FyipeLogger</code>](#logger_api--logger)
**Returns**: <code>Object</code> - An object response of a success or failure.

| Param | Type                                       | Description                                                 |
| ----- | ------------------------------------------ | ----------------------------------------------------------- |
| error | <code>string</code> \| <code>Object</code> | The content to the logged on the server.                    |
| tags  | <code>string</code> \| <code>Array</code>  | The tag(s) to be attached to the logged item on the server. |
