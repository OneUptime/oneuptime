// In a FrontEnd Environment
import fyipe from 'fyipe-staging';
const Logger = fyipe.Logger;

// constructor
const logger = new Logger(
    'https://staging.fyipe.com/api',
    '6053aae39b79460013b35102',                    
    '4904db2d-968c-4656-b6c0-aac450c97ee2'
);
                
// Sending a JSON object log to the server    
                
const item = {
    user: 'Test User',
    page: {
        title: 'Landing Page',
        loadTime: '6s',
    },
};

logger.log(item); // returns a promise