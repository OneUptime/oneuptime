import Transport = require("winston-transport");

declare class SlackHook extends Transport {
    constructor (opts: SlackHook.SlackHookOptions);
}

declare namespace SlackHook {
    interface TransformableInfo {
        level: string;
        message: string;
        [key: string]: any;
    }

    interface SlackMessage {
        text?: string
        attachments?: any[]
        blocks?: any[]
    }

    interface SlackHookOptions {
        /**
         * Slack incoming webhook URL. 
         * 
         * {@link https://api.slack.com/messaging/webhooks Follow steps 1 through 3 at this link to create a new webhook if you don't already have one}.
         */
        webhookUrl: string;
        name?: string;
        /**
         * Custom function to format messages with. This function accepts the `info` object ({@link https://github.com/winstonjs/winston/blob/master/README.md#streams-objectmode-and-info-objects see Winston documentation}) and must return an object with at least one of the following three keys: `text` (string), `attachments` (array of {@link https://api.slack.com/messaging/composing/layouts#attachments attachment objects}), `blocks` (array of {@link https://api.slack.com/messaging/composing/layouts#adding-blocks layout block objects}). These will be used to structure the format of the logged Slack message. By default, messages will use the format of `[level]: [message]` with no attachments or layout blocks. Return `false` to prevent this plugin from posting to Slack.
         */
        formatter?: (info: TransformableInfo) => SlackMessage | false;
        /**
         * Level to log. Global settings will apply if left undefined.
         */
        level?: string;
        /**
         * Enables or disables {@link https://api.slack.com/reference/messaging/link-unfurling#no_unfurling_please link unfurling}. (Default: `false`)
         */
        unfurlLinks?: boolean;
        /**
         * Enables or disables {@link https://api.slack.com/reference/messaging/link-unfurling#no_unfurling_please media unfurling}. (Default: `false`)
         */
        unfurlMedia?: boolean;
        /**
         * Enables or disables {@link https://api.slack.com/reference/surfaces/formatting#basics `mrkdwn` formatting} within attachments or layout blocks. (Default: `false`)
         */
        mrkdwn?: boolean;
        /**
         * Allows specifying a proxy server that {@link https://github.com/axios/axios#request-config gets passed directly down to Axios} (Default: `undefined`)
         */
        proxy?: any
    }
}

export = SlackHook;
