import fyipe from 'fyipe-staging'

// constructor

// set up tracking configurations
const options = {
    maxTimeline: 10,
};
const tracker = new fyipe.ErrorTracker(
    'https://staging.fyipe.com/api',
    '6032095890b38500151c0a5c',
    '15efd1fb-e423-46f8-a2aa-b25710205644',
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

// capturing error exception authomatically
NonExistingMethodCall(); // this is authomatically captured and sent to your fyipe dashboard

// capturing error exception manually
try {
    // your code logic
    NonExistingMethodCall();
} catch (error) {
    tracker.captureException(error);
}

// capturing error message
tracker.captureMessage('Message');
