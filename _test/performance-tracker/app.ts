import express from 'express'
// If your env supports require                  
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'oneuptime-staging' or its corr... Remove this comment to see the full error message
import OneUptime from 'oneuptime-staging'
const app = express()

// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'axios' or its corresponding ty... Remove this comment to see the full error message
import axios from 'axios'

    
// set up performance tracker configuration
const options = {                    
    apiUrl: 'https://staging.oneuptime.com/api',
    appId: '609975b682d0790014cba640',
    appKey: '9a715493-f7d5-4b50-a229-7ae79a5d2336',
    app, // express app instance (optional field)          
};
                                                    
// constructor                    
new OneUptime.PerformanceTracker(
    options
);

app.get('/', function(req: $TSFixMe, res: $TSFixMe){
    res.send({status: "ok"})
})

app.get('/error', function(req: $TSFixMe, res: $TSFixMe){
    res.status(500).send({error: "Error"})
})

app.get('/outgoing-requests', async function(req: $TSFixMe, res: $TSFixMe){
    await axios('https://google.com');
    res.send({status: "ok"})
})

app.get('/user/:id', async function(req: $TSFixMe, res: $TSFixMe){
    res.send({user: req.params.id})
})

app.post('/post', async function(req: $TSFixMe, res: $TSFixMe){
    res.send({"status": "this is a post request"})
})

app.listen(4050, function(){
    console.log("Server running on PORT: "+4050)
});