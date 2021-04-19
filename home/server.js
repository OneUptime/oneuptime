process.on('exit', () => {
    /* eslint-disable no-console */
    console.log('Shutting Shutdown');
});

process.on('unhandledRejection', err => {
    /* eslint-disable no-console */
    console.error('Unhandled rejection in process occurred');
    /* eslint-disable no-console */
    console.error(err);
});

process.on('uncaughtException', err => {
    /* eslint-disable no-console */
    console.error('Uncaught exception in process occurred');
    /* eslint-disable no-console */
    console.error(err);
});

const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const path = require('path');
const compression = require('compression');
const minify = require('minify');
const tryToCatch = require('try-to-catch');
const productCompare = require('./config/product-compare');
const axios = require('axios');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'production') {
    app.use(compression());
}

//View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

//Routes
app.get('/', function(req, res) {
    res.render('index', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/support', function(req, res) {
    res.render('support', {
        support: true,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/pricing', function(req, res) {
    res.render('pricing', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/enterprise/demo', function(req, res) {
    res.render('demo', {
        support: false,
        footerCards: false,
        cta: false,
        blackLogo: true,
        requestDemoCta: false,
    });
});

app.get('/product/status-page', function(req, res) {
    res.render('status-page', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/status-page', function(req, res) {
    res.redirect('/product/status-page');
});

app.get('/product/public-status-page', function(req, res) {
    res.render('public-status-page', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/public-status-page', function(req, res) {
    res.redirect('/product/public-status-page');
});

app.get('/product/private-status-page', function(req, res) {
    res.render('private-status-page', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/private-status-page', function(req, res) {
    res.redirect('/product/private-status-page');
});

app.get('/status', function(req, res) {
    res.redirect('https://status.fyipe.com');
});

app.get('/product/uptime-monitoring', function(req, res) {
    res.render('uptime-monitoring', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/uptime-monitoring', function(req, res) {
    res.redirect('/product/uptime-monitoring');
});

app.get('/product/logs-management', function(req, res) {
    res.render('logs-management', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/logs-management', function(req, res) {
    res.redirect('/product/logs-management');
});

app.get('/product/error-tracking', function(req, res) {
    res.render('error-tracking', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/error-tracking', function(req, res) {
    res.redirect('/product/error-tracking');
});

app.get('/unsubscribe/:monitorId/:subscriberId', async function(req, res) {
    const { monitorId, subscriberId } = req.params;
    let apiHost;
    if (process.env.FYIPE_HOST) {
        apiHost = 'https://' + process.env.FYIPE_HOST + '/api';
    } else {
        apiHost = 'http://localhost:3002/api';
    }

    try {
        let subscriptions = await axios({
            method: 'GET',
            url: `${apiHost}/subscriber/monitorList/${subscriberId}`,
        });

        res.render('subscriberMonitors', {
            subscriptions: subscriptions.data.data,
            defaultMonitor: monitorId,
            subscriberId,
        });
    } catch (err) {
        res.render('unsubscribe', {
            message:
                'Encountered an error while trying to display your monitor list',
        });
    }
});

app.post('/unsubscribe', async function(req, res) {
    let apiHost;
    if (process.env.FYIPE_HOST) {
        apiHost = 'https://' + process.env.FYIPE_HOST + '/api';
    } else {
        apiHost = 'http://localhost:3002/api';
    }

    try {
        console.log(req.body);
        const { subscriberId, monitors } = req.body;

        if (
            !subscriberId ||
            subscriberId[0] === null ||
            subscriberId[0] === undefined ||
            subscriberId[0] === ''
        ) {
            throw Error;
        } else if (
            !monitors ||
            monitors === null ||
            monitors === undefined ||
            monitors.length === 0
        ) {
            res.render('unsubscribe', {
                message: 'No monitor was selected',
            });
        } else {
            monitors.forEach(async monitorId => {
                await axios({
                    method: 'PUT',
                    url: `${apiHost}/subscriber/unsubscribe/${monitorId}/${subscriberId}`,
                });
            });

            res.render('unsubscribe', {
                message: 'You have successfully unsubscribed from this monitor',
            });
        }
    } catch (err) {
        res.render('unsubscribe', {
            message:
                'Encountered an error while trying to unsubscribe you from this monitor',
        });
    }
});

app.get('/product/docker-container-security', function(req, res) {
    res.render('container-security', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/docker-container-security', function(req, res) {
    res.redirect('/product/docker-container-security');
});

app.get('/product/app-security', function(req, res) {
    res.render('app-security', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/app-security', function(req, res) {
    res.redirect('/product/app-security');
});

app.get('/product/api-monitoring', function(req, res) {
    res.render('api-monitoring', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/api-monitoring', function(req, res) {
    res.redirect('/product/api-monitoring');
});

app.get('/product/kubernetes-monitoring', function(req, res) {
    res.render('kubernetes-monitoring', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/kubernetes-monitoring', function(req, res) {
    res.redirect('/product/kubernetes-monitoring');
});

app.get('/product/server-monitoring', function(req, res) {
    res.render('server-monitoring', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/server-monitoring', function(req, res) {
    res.redirect('/product/server-monitoring');
});

app.get('/product/website-monitoring', function(req, res) {
    res.render('website-monitoring', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/website-monitoring', function(req, res) {
    res.redirect('/product/website-monitoring');
});

app.get('/product/iot-device-monitoring', function(req, res) {
    res.render('iot-device-monitoring', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/iot-device-monitoring', function(req, res) {
    res.redirect('/product/iot-device-monitoring');
});

app.get('/product/incident-management', function(req, res) {
    res.render('incident-management', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/incident-management', function(req, res) {
    res.redirect('/product/incident-management');
});

app.get('/product/oncall-management', function(req, res) {
    res.render('oncall-management', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/oncall-management', function(req, res) {
    res.redirect('/product/oncall-management');
});

app.get('/customers', function(req, res) {
    res.render('customers', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: true,
        requestDemoCta: false,
    });
});

app.get('/enterprise/resources', function(req, res) {
    res.render('resources', {
        support: false,
        footerCards: false,
        cta: true,
        blackLogo: true,
        requestDemoCta: false,
    });
});

app.get('/enterprise/overview', function(req, res) {
    res.render('enterprise-overview.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: true,
    });
});

app.get('/legal', function(req, res) {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'terms',
        requestDemoCta: false,
    });
});

app.get('/legal/terms', function(req, res) {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'terms',
        requestDemoCta: false,
    });
});

app.get('/legal/privacy', function(req, res) {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'privacy',
        requestDemoCta: false,
    });
});

app.get('/legal/contact', function(req, res) {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'contact',
        requestDemoCta: false,
    });
});

app.get('/legal/subprocessors', function(req, res) {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'subprocessors',
        requestDemoCta: false,
    });
});

app.get('/legal/ccpa', function(req, res) {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'ccpa',
        requestDemoCta: false,
    });
});

app.get('/legal/hipaa', function(req, res) {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'hipaa',
        requestDemoCta: false,
    });
});

app.get('/legal/dmca', function(req, res) {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'dmca',
        requestDemoCta: false,
    });
});

app.get('/legal/pci', function(req, res) {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'pci',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27001', function(req, res) {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'iso-27001',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27017', function(req, res) {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'iso-27017',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27018', function(req, res) {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'iso-27018',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27017', function(req, res) {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'iso-27017',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27018', function(req, res) {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'iso-27018',
        requestDemoCta: false,
    });
});

app.get('/legal/soc-2', function(req, res) {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'soc-2',
        requestDemoCta: false,
    });
});

app.get('/legal/soc-3', function(req, res) {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'soc-3',
        requestDemoCta: false,
    });
});

app.get('/legal/data-residency', function(req, res) {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'data-residency',
        requestDemoCta: false,
    });
});

app.get('/legal/gdpr', function(req, res) {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'gdpr',
        requestDemoCta: false,
    });
});

app.get('/legal/sla', function(req, res) {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'sla',
        requestDemoCta: false,
    });
});

app.get('/enterprise/download-resource/:resourceName', function(req, res) {
    res.render('download-resource.ejs', {
        footerCards: false,
        support: false,
        cta: false,
        blackLogo: true,
        requestDemoCta: false,
    });
});

app.get('/table/:product', function(req, res) {
    const productConfig = productCompare(req.params.product);

    if (!productConfig) {
        res.status(404);
        res.render('notFound.ejs', {
            footerCards: false,
            support: false,
            cta: false,
            blackLogo: false,
            requestDemoCta: false,
        });
    } else {
        res.render('product-compare.ejs', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
            productConfig,
            onlyShowCompareTable: true,
        });
    }
});

app.get('/compare/:product', function(req, res) {
    const productConfig = productCompare(req.params.product);

    if (!productConfig) {
        res.status(404);
        res.render('notFound.ejs', {
            footerCards: false,
            support: false,
            cta: false,
            blackLogo: false,
            requestDemoCta: false,
        });
    } else {
        res.render('product-compare.ejs', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
            productConfig,
            onlyShowCompareTable: false,
        });
    }
});

// minify default.js
app.get('/js/default.js', async function(req, res) {
    res.setHeader('Content-Type', 'text/javascript');
    //eslint-disable-next-line
    const [error, data] = await tryToCatch(minify, './public/js/default.js');
    res.send(data);
});

// minify
app.get('/css/home.css', async function(req, res) {
    res.setHeader('Content-Type', 'text/css');
    //eslint-disable-next-line
    const [error, data] = await tryToCatch(minify, './public/css/home.css');
    res.send(data);
});

// minify
app.get('/css/comparision.css', async function(req, res) {
    res.setHeader('Content-Type', 'text/css');
    //eslint-disable-next-line
    const [error, data] = await tryToCatch(
        minify,
        './public/css/comparision.css'
    );
    res.send(data);
});

// cache policy for static contents
// loads up the site faster
app.use(
    express.static(path.join(__dirname, 'public'), {
        setHeaders(res) {
            res.setHeader('Cache-Control', 'public,max-age=31536000,immutable');
        },
    })
);

app.get('/*', function(req, res) {
    res.status(404);
    res.render('notFound.ejs', {
        footerCards: false,
        support: false,
        cta: false,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.set('port', process.env.PORT || 1444);

app.listen(app.get('port'), function() {
    //eslint-disable-next-line
    console.log('Server running on port : ' + app.get('port'));
});
