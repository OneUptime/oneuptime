[![maven](https://img.shields.io/maven-central/v/io.hackerbay.oneuptime/JavaSDK)](https://search.maven.org/artifact/io.hackerbay.oneuptime/JavaSDK)

# OneUptime SDK

A oneuptime sdk for application logger that can be used to send logs about your applications created on your fypie dashboard which can also used for error tracking

## Installation

### Maven Install

You can install to use in your project by adding the following to your `pom.xml` file:

```xml
<dependency>
    <groupId>io.hackerbay.oneuptime</groupId>
    <artifactId>JavaSDK</artifactId>
    <version>CURRENT_VERSION</version>
</dependency>
```

### Others

Check [Maven Central Repository](https://search.maven.org/artifact/io.hackerbay.oneuptime/JavaSDK) for other modes of installation.

<a name="module_api"></a>

## Basic Usage for Logging

```java
import com.google.gson.JsonObject;
import io.hackerbay.oneuptime.OneUptimeLogger;
import java.io.IOException;

public class SampleClass {

    // set up the OneUptimeLogger
    public OneUptimeLogger logger = new OneUptimeLogger(
        "API_URL", // https://oneuptime.com/api
        "APPLICATION_LOG_ID",
        "APPLICATION_LOG_KEY"
    );

    // Logging a string information
    public void logStringInformation() throws IOException {
        String content = "Content to be logged";
        JsonObject response = logger.log(content); // returns a JsonObject of response
        System.out.println(response);
    }

    // Logging any object of a class
    public void logACustomClassInformation(CustomClass customClass) throws IOException {
        String content = new Gson().toJson(customClass); // converts your custom class to a json object
        JsonObject response = logger.log(content); // returns a JsonObject of response
        System.out.println(response);
    }

    // Logging a string with a series of tags
    public void logStringInformation() throws IOException {
        String content = "Content to be logged";
        String [] tags = { "server", "monitoring", "logs" };
        JsonObject response = logger.log(content, tags); // returns a JsonObject of response
        System.out.println(response);
    }
}
```

## Basic Usage for Tracking

```java
import com.google.gson.JsonObject;
import io.hackerbay.oneuptime.OneUptimeTracker;
import java.io.IOException;
import io.hackerbay.oneuptime.model.Tag;
import io.hackerbay.oneuptime.model.TrackerOption;


public class SampleClass {

    // set up option
    TrackerOption trackerOption = new TrackerOption(50); // set maximum timeline per event

    // set up the OneUptimeTracker
    public OneUptimeTracker tracker = new OneUptimeTracker(
        "API_URL", // https://oneuptime.com/api
        "ERROR_TRACKER_ID",
        "ERROR_TRACKER_KEY",
        trackerOption
    );

    // set up a timeline to be recorded
    JsonObject object = new JsonObject();
    object.addProperty("account", "debit");
    object.addProperty("amount", "6000.00");
    object.addProperty("userId", 471);
    tracker.addToTimeline("cart", object ," info");

    // setting custom tags
    Tag tag = new Tag("category", "customer");
    tracker.setTag(tag); // a single tag

    // multiple tags
    ArrayList<Tag> sampleTags = new ArrayList<Tag>();

    // create two tags and add to the array
    sampleTags.add(new Tag("type", "notification"));
    sampleTags.add(new Tag("location", "Oslo"));

    // setting the array of tags
    tracker.setTags(sampleTags);

    // capturing errors in a try and catch
    try {
        // some code that might fail
    } catch(Exception e) {
        tracker.captureException(e); // this is sent to your oneuptime dashboard
    }

    // capturing errors using the message signature
    tracker.captureMessage('some error text');

    // capturing errors authomatically

    throw new Exception("Something went wrong"); // calling this will trigger an error and its sent to your oneuptime dashboard
}
```

## API Documentation

Main API to send logs to the server.

**Author**: OneUptime Limited.

-   [OneUptime SDK](#oneuptime-sdk)
    -   [Installation](#installation)
        -   [Maven Install](#maven-install)
        -   [Others](#others)
    -   [Basic Usage for Logging](#basic-usage-for-logging)
    -   [Basic Usage for Tracking](#basic-usage-for-tracking)
    -   [API Documentation](#api-documentation)
        -   [new OneUptimeLogger(apiUrl, applicationId, applicationKey)](#new-oneuptimeloggerapiurl-applicationid-applicationkey)
            -   [logger.log(log, tags)](#loggerloglog-tags)
            -   [logger.warning(warning, tags)](#loggerwarningwarning-tags)
            -   [logger.error(error, tags)](#loggererrorerror-tags)
        -   [new OneUptimeTracker(apiUrl, errorTrackerId, errorTrackerKey, option)](#new-oneuptimetrackerapiurl-errortrackerid-errortrackerkey-option)
            -   [TrackerOption options](#trackeroption-options)
            -   [tracker.setTag(Tag tag)](#trackersettagtag-tag)
            -   [tracker.setTags(ArrayList<Tag> tags)](#trackersettagsarraylisttag-tags)
            -   [tracker.setFingerprint(ArrayList<String> fingerprints)](#trackersetfingerprintarrayliststring-fingerprints)
            -   [tracker.addToTimeline(category, content, type)](#trackeraddtotimelinecategory-content-type)
            -   [tracker.captureMessage(message)](#trackercapturemessagemessage)
            -   [tracker.captureException(error)](#trackercaptureexceptionerror)
    -   [Contribution](#contribution)

<a name="logger_api--logger"></a>

### new OneUptimeLogger(apiUrl, applicationId, applicationKey)

Create a constructor from the class, which will be used to send logs to the server.

**Kind**: Constructor
**Returns**: <code>null</code>

| Param          | Type                | Description              |
| -------------- | ------------------- | ------------------------ |
| apiUrl         | <code>String</code> | The Server URL.          |
| applicationId  | <code>String</code> | The Application Log ID.  |
| applicationKey | <code>String</code> | The Application Log Key. |

#### logger.log(log, tags)

Logs a request of type `info` to the server.

**Kind**: method of [<code>new OneUptimeLogger</code>](#logger_api--logger)
**Returns**: <code>JsonObject</code> - A response of a success or failure.

| Param | Type                  | Description                                                 |
| ----- | --------------------- | ----------------------------------------------------------- |
| log   | <code>String</code>   | The content to the logged on the server.                    |
| tags  | <code>String[]</code> | The tag(s) to be attached to the logged item on the server. |

#### logger.warning(warning, tags)

Logs a request of type `warning` to the server.

**Kind**: method of [<code>new OneUptimeLogger</code>](#logger_api--logger)
**Returns**: <code>JsonObject</code> - A response of a success or failure.

| Param   | Type                  | Description                                                 |
| ------- | --------------------- | ----------------------------------------------------------- |
| warning | <code>String</code>   | The content to the logged on the server.                    |
| tags    | <code>String[]</code> | The tag(s) to be attached to the logged item on the server. |

#### logger.error(error, tags)

Logs a request of type `error` to the server.

**Kind**: method of [<code>new OneUptimeLogger</code>](#logger_api--logger)
**Returns**: <code>JsonObject</code> - A response of a success or failure.

| Param | Type                  | Description                                                 |
| ----- | --------------------- | ----------------------------------------------------------- |
| error | <code>String</code>   | The content to the logged on the server.                    |
| tags  | <code>String[]</code> | The tag(s) to be attached to the logged item on the server. |

<a name="tracker_api--tracker"></a>

### new OneUptimeTracker(apiUrl, errorTrackerId, errorTrackerKey, option)

Create a constructor from the class, which will be used to track errors sent to the server.

**Kind**: Constructor
**Returns**: <code>null</code>

| Param           | Type                       | Description                                 |
| --------------- | -------------------------- | ------------------------------------------- |
| apiUrl          | <code>string</code>        | The Server URL.                             |
| errorTrackerId  | <code>string</code>        | The Error Tracker ID.                       |
| errorTrackerKey | <code>string</code>        | The Error Trakcer Key.                      |
| option          | <code>TrackerOption</code> | The options to be considred by the tracker. |

#### TrackerOption options

| Param       | Type             | Description                                                         |
| ----------- | ---------------- | ------------------------------------------------------------------- |
| maxTimeline | <code>int</code> | The total amount of timeline that should be captured, defaults to 5 |

#### tracker.setTag(Tag tag)

Set tag for the error to be sent to the server.

**Kind**: method of [<code>new OneUptime\OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param | Type             | Description     |
| ----- | ---------------- | --------------- |
| tag   | <code>Tag</code> | The tag object. |

#### tracker.setTags(ArrayList<Tag> tags)

Set multiple tags for the error to be sent to the server. Takes in an array

**Kind**: method of [<code>new OneUptime\OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param | Type                          | Description                                  |
| ----- | ----------------------------- | -------------------------------------------- |
| tags  | <code>ArrayList of Tag</code> | The list of tags to be added to the tracker. |

#### tracker.setFingerprint(ArrayList<String> fingerprints)

Set fingerprint for the next error to be captured.

**Kind**: method of [<code>new OneUptime\OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param       | Type                                                     | Description                                                   |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| fingerprint | <code>string</code> \| <code>ArrayList of strings</code> | The set of string used to group error messages on the server. |

#### tracker.addToTimeline(category, content, type)

Add a custom timeline element to the next error to be sent to the server

**Kind**: method of [<code>new OneUptime\OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param    | Type                    | Description                         |
| -------- | ----------------------- | ----------------------------------- |
| category | <code>string</code>     | The category of the timeline event. |
| content  | <code>JsonObject</code> | The content of the timeline event.  |
| type     | <code>string</code>     | The type of timeline event.         |

#### tracker.captureMessage(message)

Capture a custom error message to be sent to the server

**Kind**: method of [<code>new OneUptime\OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>Promise</code>

| Param    | Type                | Description                           |
| -------- | ------------------- | ------------------------------------- |
| \message | <code>string</code> | The message to be sent to the server. |

#### tracker.captureException(error)

Capture a custom error object to be sent to the server

**Kind**: method of [<code>new OneUptime\OneUptimeTracker</code>](#tracker_api--tracker)
**Returns**: <code>Promise</code>

| Param  | Type                   | Description                                |
| ------ | ---------------------- | ------------------------------------------ |
| \error | <code>Throwable</code> | The Error Object to be sent to the server. |

## Contribution

-   Clone repository
-   run `mvn clean install` to install dependencies
-   run `mvn test` to run tests
-   run `mvn package` to build for production.
