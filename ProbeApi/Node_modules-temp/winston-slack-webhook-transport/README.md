# winston-slack-webhook-transport

A Slack transport for Winston 3+ that logs to a channel via webhooks.

![Continuous Integration](https://github.com/TheAppleFreak/winston-slack-webhook-transport/actions/workflows/tests.yml/badge.svg) [![npm version](https://badge.fury.io/js/winston-slack-webhook-transport.svg)](https://www.npmjs.com/package/winston-slack-webhook-transport) [![downloads](https://img.shields.io/npm/dw/winston-slack-webhook-transport)]((https://www.npmjs.com/package/winston-slack-webhook-transport))

## Installation

```
npm install winston winston-slack-webhook-transport
```

## Usage

### Set up with transports

```javascript
const winston = require("winston");
const SlackHook = require("winston-slack-webhook-transport");

const logger = winston.createLogger({
    level: "info",
    transports: [
        new SlackHook({
            webhookUrl: "https://hooks.slack.com/services/xxx/xxx/xxx"
        })
    ]
});

logger.info("This should now appear on Slack");
```

### Set up by adding

```javascript
const winston = require("winston");
const SlackHook = require("winston-slack-webhook-transport");

const logger = winston.createLogger({});

logger.add(new SlackHook({ webhookUrl: "https://hooks.slack.com/services/xxx/xxx/xxx" }));
```

### Options

* `webhookUrl` **REQUIRED** - Slack incoming webhook URL. [Follow steps 1 through 3 at this link to create a new webhook if you don't already have one](https://api.slack.com/messaging/webhooks).
* `formatter` - Custom function to format messages with. This function accepts the `info` object ([see Winston documentation](https://github.com/winstonjs/winston/blob/master/README.md#streams-objectmode-and-info-objects)) and must return an object with at least one of the following three keys: `text` (string), `attachments` (array of [attachment objects](https://api.slack.com/messaging/composing/layouts#attachments)), `blocks` (array of [layout block objects](https://api.slack.com/messaging/composing/layouts#adding-blocks)). These will be used to structure the format of the logged Slack message. By default, messages will use the format of `[level]: [message]` with no attachments or layout blocks. A value of `false` can also be returned to prevent a message from being sent to Slack.
* `level` - Level to log. Global settings will apply if left undefined.
* `unfurlLinks` - Enables or disables [link unfurling.](https://api.slack.com/reference/messaging/link-unfurling#no_unfurling_please) (Default: `false`)
* `unfurlMedia` - Enables or disables [media unfurling.](https://api.slack.com/reference/messaging/link-unfurling#no_unfurling_please) (Default: `false`)
* `mrkdwn` - Enables or disables [`mrkdwn` formatting](https://api.slack.com/reference/surfaces/formatting#basics) within attachments or layout blocks (Default: `false`)
* `proxy` - Allows specifying a proxy server that [gets passed directly down to Axios](https://github.com/axios/axios#request-config) (Default: `undefined`)

### Message formatting

`winston-slack-webhook-transport` supports the ability to format messages using Slack's message layout features. To do this, supply a custom formatter function that returns the [requisite object structure](https://api.slack.com/messaging/composing/layouts) to create the desired layout. You can use the [Slack Block Kit Builder](https://app.slack.com/block-kit-builder/) to quickly and easily prototype advanced layouts using Block Kit.

If for some reason you don't want to send a message to Slack, you can also return `false` to prevent the log message from being sent.

Note that if you're using Block Kit using either the `attachments` or `blocks` keys, the `text` parameter will function as a fallback for surfaces that do not support Block Kit, such as IRC clients or push notifications. It is recommended to include `text` when possible in these cases.

```javascript
const winston = require("winston");
const SlackHook = require("winston-slack-webhook-transport");
 
const logger = winston.createLogger({
    level: "info",
    transports: [
        new SlackHook({
            webhookUrl: "https://hooks.slack.com/services/xxx/xxx/xxx",
            formatter: info => {
                return {
                    text: "This will function as a fallback for surfaces that don't support Block Kit, like IRC clients or mobile push notifications.",
                    attachments: [
                        {
                            text: "Or don't pass anything. That's fine too"
                        }
                    ],
                    blocks: [
                        {
                            type: "section",
                            text: {
                                type: "plain_text",
                                text: "You can pass more info to the formatter by supplying additional parameters in the logger call"
                            }
                        }
                    ]
                }
            }
        })
    ]
});

logger.info("Definitely try playing around with this.")
```