const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');

const { NODE_ENV } = process.env;

if (NODE_ENV === 'local' || NODE_ENV === 'development')
    require('custom-env').env(process.env.NODE_ENV);

global.httpServerResponse = {
    statusCode: 200,
    responseType: { values: ['json', 'html'], currentType: 'json' },
    responseTime: 0,
    body: { status: 'ok' },
};

app.use('*', function(req, res, next) {
    if (process.env && process.env.PRODUCTION) {
        res.set('Cache-Control', 'public, max-age=86400');
    } else res.set('Cache-Control', 'no-cache');
    next();
});

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static('public'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(require('./backend/api/settings'));

app.get('/', function(req, res) {
    res.status(global.httpServerResponse.statusCode);
    setTimeout(function() {
        if (global.httpServerResponse.responseType.currentType === 'html') {
            res.setHeader('Content-Type', 'text/html');
            return res.send(global.httpServerResponse.body);
        } else {
            res.setHeader('Content-Type', 'application/json');
            return res.send(global.httpServerResponse.body);
        }
    }, global.httpServerResponse.responseTime);
});

const hook = {};

app.post('/api/webhooks/:id', function(req, res) {
    const { id } = req.params;
    hook[id] = req.body;
    return res.status(200).json(req.body);
});

app.get('/api/webhooks/:id', function(req, res) {
    const { id } = req.params;
    if (hook[id] === undefined) return res.status(404).json({});
    return res.status(200).json(hook[id]);
});

app.use('/*', function(req, res) {
    res.status(404).render('notFound.ejs', {});
});

app.set('port', process.env.PORT || 3010);

app.listen(app.get('port'), function() {
    //eslint-disable-next-line
    console.log('Server running on port : ' + app.get('port'));
});
