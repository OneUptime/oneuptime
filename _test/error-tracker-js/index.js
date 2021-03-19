import fyipe from 'fyipe-staging'

// constructor

// set up tracking configurations
const options = {
    maxTimeline: 10,
};

// constructor                    
const tracker = new fyipe.ErrorTracker(                    
    'https://staging.fyipe.com/api',
    '6050f9c65039a2001285d874',
    'f713e405-c4d4-481f-bf00-2afae72a7267',
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
