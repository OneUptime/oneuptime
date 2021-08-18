const { customUpdate } = require('../util/db');

const statusPageCollection = 'statuspages';

async function run() {
    await customUpdate(
        statusPageCollection,
        {
            'layout.invisible.key': {
                $nin: ['language'],
            },
            'layout.visible.key': {
                $nin: ['language'],
            },
        },
        {
            $push: {
                'layout.invisible': {
                    name: 'Language',
                    key: 'language',
                },
            },
        }
    );
    return `Script completed`;
}

module.exports = run;
