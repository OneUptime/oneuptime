# OneUptime Error Tracker

A oneuptime error tracker is used to automatically log errors which happen in your app and log them to OneUptime dashboard.

## Installation

### NPM Install

You can install to use in your project:

```
$ cd project
$ npm install oneuptime
```

## Basic Usage

```javascript
// If your env supports import
import OneUptime from 'oneuptime';

// If your env supports require
import OneUptime from 'oneuptime';

// set up tracking configurations
const options: $TSFixMe = {
    maxTimeline: 10,
    captureCodeSnippet: true,
};

// constructor
const tracker = new OneUptime.ErrorTracker(
    'API_URL', // https://oneuptime.com/api
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

// capturing error exception manually and sent to your oneuptime dashboard
try {
    // your code logic
    NonExistingMethodCall();
} catch (error) {
    tracker.captureException(error); // returns a promise
}

// capturing error message
tracker.captureMessage('Message'); // returns a promise
```

## API Reference

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

#### options

| Param              | Type                 | Description                                                                                               |
| ------------------ | -------------------- | --------------------------------------------------------------------------------------------------------- |
| maxTimeline        | <code>int</code>     | The total amount of timeline that should be captured, defaults to 5                                       |
| captureCodeSnippet | <code>boolean</code> | When set as `true` stack traces are automatically attached to all error sent to your oneuptime dashboard. |

#### tracker.setTag(key, value)

Set a tag for the error to be captured.

**Kind**: method of [<code>new ErrorTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param | Type                | Description            |
| ----- | ------------------- | ---------------------- |
| key   | <code>string</code> | The key for the tag.   |
| value | <code>string</code> | The value for thr tag. |

#### tracker.setTags([{key, value}])

Set an array of tags for the error to be captured.

**Kind**: method of [<code>new ErrorTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param | Type                | Description            |
| ----- | ------------------- | ---------------------- |
| key   | <code>string</code> | The key for the tag.   |
| value | <code>string</code> | The value for the tag. |

#### tracker.setFingerprint(fingerprint)

Set fingerprint for the next error to be captured.

**Kind**: method of [<code>new ErrorTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param       | Type                                                 | Description                                                   |
| ----------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| fingerprint | <code>string</code> \| <code>array of strings</code> | The set of string used to group error messages on the server. |

#### tracker.addToTimeline(category, content, type)

Add a custom timeline element to the next error to be sent to the server

**Kind**: method of [<code>new ErrorTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param    | Type                                       | Description                         |
| -------- | ------------------------------------------ | ----------------------------------- |
| category | <code>string</code>                        | The category of the timeline event. |
| content  | <code>string</code> \| <code>Object</code> | The content of the timeline event.  |
| type     | <code>string</code>                        | The type of timeline event.         |

#### tracker.captureMessage(message)

Capture a custom error message to be sent to the server

**Kind**: method of [<code>new ErrorTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param   | Type                | Description                           |
| ------- | ------------------- | ------------------------------------- |
| message | <code>string</code> | The message to be sent to the server. |

#### tracker.captureException(error)

Capture a custom error object to be sent to the server

**Kind**: method of [<code>new ErrorTracker</code>](#tracker_api--tracker)
**Returns**: <code>null</code>

| Param | Type                | Description                                |
| ----- | ------------------- | ------------------------------------------ |
| error | <code>object</code> | The Error Object to be sent to the server. |
