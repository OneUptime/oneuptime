
import oneuptime from 'oneuptime-staging'

// constructor

// set up tracking configurations
const options: $TSFixMe = {
    maxTimeline: 10,
};

// constructor                    
const tracker = new oneuptime.ErrorTracker(                    
    'https://staging.oneuptime.com/api',
    '605bad70ae110c0013e14005',
    'cb4b107a-7f28-464d-9fda-32715fa4cd68',
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

NonExistingMethodCall(); // this is authomatically captured and sent to your oneuptime dashboard

// capturing error exception manually
try {
    // your code logic
    
    NonExistingMethodCall();
} catch (error) {
    tracker.captureException(error);
}

// capturing error message
tracker.captureMessage('Message');
