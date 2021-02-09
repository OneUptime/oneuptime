import fyipe from 'fyipe-staging'

// constructor

// set up tracking configurations
const options = {
    maxTimeline: 10,
};
const tracker = new fyipe.ErrorTracker(
    'https://staging.fyipe.com/api',
    '600a7517992d2b0012843954',
    'ac12b24f-c70a-4f34-b84d-af6ec621e59d',
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
