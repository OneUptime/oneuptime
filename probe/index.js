var express = require('express');
var app = express();
var http = require('http').createServer(app);
var cors = require('cors');
const Main = require('./workers/main');
const cron = require('node-cron');

app.use(cors());
app.set('port', process.env.PORT || 3008);

http.listen(app.get('port'), function () {
    // eslint-disable-next-line
    console.log('Server Started on port ' + app.get('port'));
});

app.get('/', function (req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({
        status: 200,
        message: 'Service Status - OK',
    }));
});

// This cron runs every minute
cron.schedule('* * * * *',() =>{Main.runJob();});

module.exports = app;
