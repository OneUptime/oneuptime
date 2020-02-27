/**
 *
 * Copyright HackerBay, Inc.
 *
 */

module.exports = {
    attachments: [
        {
            text: 'An incident occured with your project',
            fallback: 'There was an incident with',
            callback_id: 'wopr_game',
            color: '#5646DF',
            attachment_type: 'default',
            actions: [
                {
                    name: 'acknowledge',
                    text: 'Acknowledge',
                    type: 'button',
                    value: 'ack_inc',
                    confirm: {
                        title: 'Are you sure?',
                        text: 'You are about to acknowledge incident',
                        ok_text: 'Yes',
                        dismiss_text: 'No',
                    },
                },
                {
                    name: 'resolve',
                    text: 'Resolve',
                    style: 'success',
                    type: 'button',
                    value: 'res_inc',
                    confirm: {
                        title: 'Are you sure?',
                        text: 'You have resolve this incident',
                        ok_text: 'Yes',
                        dismiss_text: 'No',
                    },
                },
            ],
        },
    ],
};
