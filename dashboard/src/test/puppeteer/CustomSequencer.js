const TestSequencer = require('@jest/test-sequencer').default;

class CustomSequencer extends TestSequencer {
    sort(tests) {
        const orderPath = [
            'MonitorDetailScheduledEvents.test.js',
            'MonitorDetail.test.js',
            'IncidentTimeline.test.js',
            'Monitor.test.js',
            'IncidentSubProject.test.js',
        ];
        const copyTests = Array.from(tests);
        return copyTests.sort((testA, testB) => {
            const indexA = orderPath.indexOf(testA.path.split('/').pop());
            const indexB = orderPath.indexOf(testB.path.split('/').pop());

            if (indexA === indexB) return 0; // do not swap when tests both are not specified in order.

            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA < indexB ? -1 : 1;
        });
    }
}

module.exports = CustomSequencer;
