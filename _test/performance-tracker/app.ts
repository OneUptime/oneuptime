import express, { Request, Response } from 'common-server/Utils/Express'
import OneUptime from 'oneuptime-staging'
const app = express()


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

app.get('/', (req: ExpressRequest, res: ExpressResponse) => {
    res.send({ status: "ok" })
})

app.get('/error', (req: ExpressRequest, res: ExpressResponse) => {
    res.status(500).send({ error: "Error" })
})

app.get('/outgoing-requests', async (req: ExpressRequest, res: ExpressResponse) => {
    await axios('https://google.com');
    res.send({ status: "ok" })
})

app.get('/user/:id', async (req: ExpressRequest, res: ExpressResponse) => {
    res.send({ user: req.params.id })
})

app.post('/post', async (req: ExpressRequest, res: ExpressResponse) => {
    res.send({ "status": "this is a post request" })
})

app.listen(4050, function () {
    logger.info("Server running on PORT: " + 4050)
});