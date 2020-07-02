# Fyipe Application Logger

A fyipe application logger that can be used to send logs about your applications created on your fypie dashboard

## Installation

### Maven Install

You can install to use in your project by adding the following to your `pom.xml` file:

// Todo

### Development

-   Clone repository
-   run `mvn clean install` to install dependencies
-   run `mvn test` to run tests
-   run `mvn package` to build for production.

<a name="module_api"></a>

## Basic Usage

```java
import com.google.gson.JsonObject;
import io.hackerbay.fyipe.Logger;

public class SampleClass {

    // constructor
    Logger logger = new Logger(
        "API_URL", // https:fyipe.com/api
        "APPLICATION_LOG_ID",
        "APPLICATION_LOG_KEY"
    );

    // Logging a string information
    public void logStringInformation() {
        String content = "Content to be logged";
        JsonObject response = logger.log(content); // returns a JsonObject of response
        System.out.println(response);
    }

    // Logging any object of a class
    public void logACustomClassInformation(CustomClass customClass) {
        String content = new Gson().toJson(customClass); // converts your custom class to a json object
        JsonObject response = logger.log(content); // returns a JsonObject of response
        System.out.println(response);
    }
}
```

## API Documentation

Main API to send logs to the server.

**Author**: HackerBay, Inc.

-   [Fyipe Application Logger](#fyipe-application-logger)
    -   [Installation](#installation)
        -   [Maven Install](#maven-install)
        -   [Development](#development)
    -   [Basic Usage](#basic-usage)
    -   [API Documentation](#api-documentation)
        -   [new Logger(apiUrl, applicationId, applicationKey)](#new-loggerapiurl-applicationid-applicationkey)
            -   [logger.log(log)](#loggerloglog)
            -   [logger.warning(log)](#loggerwarninglog)
            -   [logger.error(log)](#loggererrorlog)
    -   [TODO](#todo)

<a name="logger_api--logger"></a>

### new Logger(apiUrl, applicationId, applicationKey)

Create a constructor from the class, which will be used to send logs to the server.

**Kind**: Constructor
**Returns**: <code>null</code>

| Param          | Type                | Description              |
| -------------- | ------------------- | ------------------------ |
| apiUrl         | <code>String</code> | The Server URL.          |
| applicationId  | <code>String</code> | The Application Log ID.  |
| applicationKey | <code>String</code> | The Application Log Key. |

#### logger.log(log)

Logs a request of type `info` to the server.

**Kind**: method of [<code>new Logger</code>](#logger_api--logger)
**Returns**: <code>JsonObject</code> - A response of a success or failure.

| Param | Type                | Description                              |
| ----- | ------------------- | ---------------------------------------- |
| log   | <code>String</code> | The content to the logged on the server. |

#### logger.warning(log)

Logs a request of type `warning` to the server.

**Kind**: method of [<code>new Logger</code>](#logger_api--logger)
**Returns**: <code>JsonObject</code> - A response of a success or failure.

| Param   | Type                | Description                              |
| ------- | ------------------- | ---------------------------------------- |
| warning | <code>String</code> | The content to the logged on the server. |

#### logger.error(log)

Logs a request of type `error` to the server.

**Kind**: method of [<code>new Logger</code>](#logger_api--logger)
**Returns**: <code>JsonObject</code> - A response of a success or failure.

| Param | Type                | Description                              |
| ----- | ------------------- | ---------------------------------------- |
| error | <code>String</code> | The content to the logged on the server. |

## TODO

-   Tags
-   TBD
