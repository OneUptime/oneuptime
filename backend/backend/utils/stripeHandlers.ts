
import { postApi } from './api';
const SLACK_URL = process.env.SLACK_BILLING_WEBHOOK;

export default {
    // webhook notification to slack channel
    sendSlackAlert: async (
        title: $TSFixMe,
        identifier: $TSFixMe,
        reason: $TSFixMe,
        code: $TSFixMe,
        invoiceUrl: $TSFixMe
    ) => {
        let data = {
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: 'Stripe Payment Alert',
                        emoji: true,
                    },
                },
                {
                    type: 'section',
                    fields: [
                        {
                            type: 'mrkdwn',
                            text: `*Title:*\n${title}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Error Code:*\n${code}`,
                        },
                    ],
                },
                {
                    type: 'section',
                    fields: [
                        {
                            type: 'mrkdwn',
                            text: `*Description:*\n${reason}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Affected Service:*\n${identifier}`,
                        },
                    ],
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `<${invoiceUrl}|View Invoice>`,
                    },
                },
            ],
        };

        if (title !== 'Stripe Webhook Event') {
            data = {
                blocks: [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: 'Stripe Payment Alert',
                            emoji: true,
                        },
                    },
                    {
                        type: 'section',
                        fields: [
                            {
                                type: 'mrkdwn',
                                text: `*Title:*\n${title}`,
                            },
                            {
                                type: 'mrkdwn',
                                text: `*Error Code:*\n${code}`,
                            },
                        ],
                    },
                    {
                        type: 'section',
                        fields: [
                            {
                                type: 'mrkdwn',
                                text: `*Description:*\n${reason}`,
                            },
                            {
                                type: 'mrkdwn',
                                text: `*Affected Service:*\n${identifier}`,
                            },
                        ],
                    },
                ],
            };
        }

        await postApi(SLACK_URL, data);
    },
};
