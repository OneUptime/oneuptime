const express = require('express')
// If your env supports require                  
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

app.get('/', function(req, res){
    res.send({status: "ok"})
})

app.get('/error', function(req, res){
    res.status(500).send({error: "Error"})
})

app.get('/outgoing-requests', async function(req, res){
    await axios('https://google.com');
    res.send({status: "ok"})
})

app.get('/user/:id', async function(req, res){
    res.send({user: req.params.id})
})

app.post('/post', async function(req, res){
    res.send({"status": "this is a post request"})
})

app.listen(4050, function(){
    console.log("Server running on PORT: "+4050)
});