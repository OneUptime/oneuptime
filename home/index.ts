import 'common-server/utils/env';
import 'common-server/utils/process';
import logger from 'common-server/utils/logger';
import Express, { ExpressRequest, ExpressResponse } from 'common-server/utils/express';
const app = Express.getExpressApp();

import bodyParser from 'body-parser';
import path from 'path';

import compression from 'compression';

import minify from 'minify';

import tryToCatch from 'try-to-catch';
import productCompare from './config/product-compare';
import axios from 'axios';
import builder from 'xmlbuilder2';

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

if (process.env['NODE_ENV'] === 'production') {
    app.use(compression());
}

//View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

/**
 * @param {string} val : The value to be parsed.
 * @description Resolves or Parses any value to boolean value.
 * @returns Boolean true or false
 */

//Routes
app.get('/', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('index', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/support', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('support', {
        support: true,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/pricing', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('pricing', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/enterprise/demo', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('demo', {
        support: false,
        footerCards: false,
        cta: false,
        blackLogo: true,
        requestDemoCta: false,
    });
});

app.get('/product/status-page', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/public-status-page');
});

app.get('/status-page', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/public-status-page');
});

app.get('/product/public-status-page', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('public-status-page', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        footerCtaText:
            'Start with Status Pages, expand into everything else. Sign up today.',
    });
});

app.get('/public-status-page', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/public-status-page');
});

app.get('/product/private-status-page', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('private-status-page', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        footerCtaText:
            'Start with Status Pages, expand into everything else. Sign up today.',
    });
});

app.get('/private-status-page', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/private-status-page');
});

app.get('/status', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('https://status.oneuptime.com');
});

app.get('/product/uptime-monitoring', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('uptime-monitoring', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/uptime-monitoring', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/uptime-monitoring');
});

app.get('/product/logs-management', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('logs-management', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/logs-management', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/logs-management');
});

app.get('/product/error-tracking', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('error-tracking', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/error-tracking', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/error-tracking');
});

app.get(
    '/unsubscribe/:monitorId/:subscriberId',
    async (req: ExpressRequest, res: ExpressResponse) => {
        const { monitorId, subscriberId } = req.params;
        let apiHost;
        if (process.env.ONEUPTIME_HOST) {
            apiHost = 'https://' + process.env.ONEUPTIME_HOST + '/api';
        } else {
            apiHost = 'http://localhost:3002/api';
        }

        try {
            const subscriptions = await axios({
                method: 'GET',
                url: `${apiHost}/subscriber/monitorList/${subscriberId}`,
            });

            if (subscriptions.data.data.length < 1) {
                res.render('unsubscribe', {
                    message: 'You are currently not subscribed to any monitor',
                });
            } else {
                res.render('subscriberMonitors', {
                    subscriptions: subscriptions.data.data,
                    defaultMonitor: monitorId,
                });
            }
        } catch (err) {
            res.render('unsubscribe', {
                message:
                    'Encountered an error while trying to display your monitor list',
            });
        }
    }
);

app.post('/unsubscribe', async (req: ExpressRequest, res: ExpressResponse) => {
    let apiHost: $TSFixMe;
    if (process.env.ONEUPTIME_HOST) {
        apiHost = 'https://' + process.env.ONEUPTIME_HOST + '/api';
    } else {
        apiHost = 'http://localhost:3002/api';
    }

    try {
        const { email, monitors } = req.body;
        if (
            !email ||
            email[0] === null ||
            email[0] === undefined ||
            email[0] === ''
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
            monitors.forEach(async (monitorId: $TSFixMe) => {
                await axios({
                    method: 'PUT',
                    url: `${apiHost}/subscriber/unsubscribe/${monitorId}/${email}`,
                });
            });

            res.render('unsubscribe', {
                message: 'You have been successfully unsubscribed.',
            });
        }
    } catch (err) {
        res.render('unsubscribe', {
            message:
                'Encountered an error while trying to unsubscribe you from this monitor',
        });
    }
});

app.get(
    '/product/docker-container-security',
    (req: ExpressRequest, res: ExpressResponse) => {
        res.render('container-security', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get('/docker-container-security', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/docker-container-security');
});

app.get('/product/app-security', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('app-security', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/app-security', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/app-security');
});

app.get('/product/api-monitoring', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('api-monitoring', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
        footerCtaText:
            'Start with API monitoring, expand into everything else. Sign up today.',
    });
});

app.get('/api-monitoring', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/api-monitoring');
});

app.get(
    '/product/kubernetes-monitoring',
    (req: ExpressRequest, res: ExpressResponse) => {
        res.render('kubernetes-monitoring', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get('/kubernetes-monitoring', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/kubernetes-monitoring');
});

app.get(
    '/product/performance-monitoring',
    (req: ExpressRequest, res: ExpressResponse) => {
        res.render('performance-monitoring', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get('/performance-monitoring', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/performance-monitoring');
});

app.get('/product/server-monitoring', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('server-monitoring', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/server-monitoring', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/server-monitoring');
});

app.get('/product/website-monitoring', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('website-monitoring', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/website-monitoring', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/website-monitoring');
});

app.get(
    '/product/iot-device-monitoring',
    (req: ExpressRequest, res: ExpressResponse) => {
        res.render('iot-device-monitoring', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get('/iot-device-monitoring', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/iot-device-monitoring');
});

app.get('/product/incident-management', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('incident-management', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/incident-management', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/incident-management');
});

app.get('/product/oncall-management', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('oncall-management', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/oncall-management', (req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/oncall-management');
});

app.get('/customers', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('customers', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: true,
        requestDemoCta: false,
    });
});

app.get('/enterprise/resources', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('resources', {
        support: false,
        footerCards: false,
        cta: true,
        blackLogo: true,
        requestDemoCta: false,
    });
});

app.get('/enterprise/overview', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('enterprise-overview.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: true,
    });
});

app.get('/legal', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'terms',
        requestDemoCta: false,
    });
});

app.get('/legal/terms', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'terms',
        requestDemoCta: false,
    });
});

app.get('/legal/privacy', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'privacy',
        requestDemoCta: false,
    });
});

app.get('/legal/contact', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'contact',
        requestDemoCta: false,
    });
});

app.get('/legal/subprocessors', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'subprocessors',
        requestDemoCta: false,
    });
});

app.get('/legal/ccpa', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'ccpa',
        requestDemoCta: false,
    });
});

app.get('/legal/hipaa', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'hipaa',
        requestDemoCta: false,
    });
});

app.get('/legal/dmca', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'dmca',
        requestDemoCta: false,
    });
});

app.get('/legal/pci', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'pci',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27001', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'iso-27001',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27017', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'iso-27017',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27018', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'iso-27018',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27017', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'iso-27017',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27018', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'iso-27018',
        requestDemoCta: false,
    });
});

app.get('/legal/soc-2', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'soc-2',
        requestDemoCta: false,
    });
});

app.get('/legal/soc-3', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'soc-3',
        requestDemoCta: false,
    });
});

app.get('/legal/data-residency', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'data-residency',
        requestDemoCta: false,
    });
});

app.get('/legal/gdpr', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'gdpr',
        requestDemoCta: false,
    });
});

app.get('/legal/sla', (req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'sla',
        requestDemoCta: false,
    });
});

app.get(
    '/enterprise/download-resource/:resourceName',
    (req: ExpressRequest, res: ExpressResponse) => {
        res.render('download-resource.ejs', {
            footerCards: false,
            support: false,
            cta: false,
            blackLogo: true,
            requestDemoCta: false,
        });
    }
);

app.get('/table/:product', (req: ExpressRequest, res: ExpressResponse) => {
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

app.get('/compare/:product', (req: ExpressRequest, res: ExpressResponse) => {
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
app.get('/js/default.js', async (req: ExpressRequest, res: ExpressResponse) => {
    res.setHeader('Content-Type', 'text/javascript');
    const [error, data] = await tryToCatch(minify, './public/js/default.js');

    if (error) {
        return res.status(500).send();
    }

    res.send(data);
});

// minify
app.get('/css/home.css', async (req: ExpressRequest, res: ExpressResponse) => {
    res.setHeader('Content-Type', 'text/css');
    const [error, data] = await tryToCatch(minify, './public/css/home.css');
    if (error) {
        return res.status(500).send();
    }
    res.send(data);
});

// minify
app.get('/css/comparision.css', async (req: ExpressRequest, res: ExpressResponse) => {
    res.setHeader('Content-Type', 'text/css');
    const [error, data] = await tryToCatch(
        minify,
        './public/css/comparision.css'
    );

    if (error) {
        return res.status(500).send();
    }

    res.send(data);
});

// generate sitemap
app.get('/sitemap.xml', async (req: ExpressRequest, res: ExpressResponse) => {
    const siteUrls = [
        'https://oneuptime.com/',
        'https://oneuptime.com/pricing',
        'https://oneuptime.com/support',
        'https://oneuptime.com/product/public-status-page',
        'https://oneuptime.com/product/private-status-page',
        'https://oneuptime.com/product/uptime-monitoring',
        'https://oneuptime.com/product/incident-management',
        'https://oneuptime.com/product/app-security',
        'https://oneuptime.com/product/api-monitoring',
        'https://oneuptime.com/product/server-monitoring',
        'https://oneuptime.com/product/logs-management',
        'https://oneuptime.com/product/docker-container-security',
        'https://oneuptime.com/product/oncall-management',
        'https://oneuptime.com/customers',
        'https://oneuptime.com/enterprise/overview',
        'https://oneuptime.com/enterprise/demo',
        'https://oneuptime.com/enterprise/resources',
        'https://oneuptime.com/legal/terms',
        'https://oneuptime.com/legal/privacy',
        'https://oneuptime.com/legal/gdpr',
        'https://oneuptime.com/legal/ccpa',
        'https://oneuptime.com/legal',
        'https://oneuptime.com/compare/pagerduty',
        'https://oneuptime.com/compare/pingdom',
        'https://oneuptime.com/compare/statuspage.io',
        'https://oneuptime.com/table/pagerduty',
        'https://oneuptime.com/table/pingdom',
        'https://oneuptime.com/table/statuspage.io',
        'https://oneuptime.com/legal/soc-2',
        'https://oneuptime.com/legal/soc-3',
        'https://oneuptime.com/legal/iso-27017',
        'https://oneuptime.com/legal/iso-27018',
        'https://oneuptime.com/legal/hipaa',
        'https://oneuptime.com/legal/pci',
        'https://oneuptime.com/enterprise/download-resource/website-monitoring',
        'https://oneuptime.com/enterprise/download-resource/speed-equals-revenue',
        'https://oneuptime.com/enterprise/download-resource/best-practices',
        'https://oneuptime.com/enterprise/download-resource/planning-for-peak-performance',
        'https://oneuptime.com/legal/sla',
        'https://oneuptime.com/legal/iso-27001',
        'https://oneuptime.com/legal/data-residency',
        'https://oneuptime.com/legal/dmca',
        'https://oneuptime.com/legal/subprocessors',
        'https://oneuptime.com/legal/contact',
        'https://oneuptime.com/files/soc-3.pdf',
        'https://oneuptime.com/files/iso-27017.pdf',
        'https://oneuptime.com/files/iso-27018.pdf',
        'https://oneuptime.com/files/pci.pdf',
        'https://oneuptime.com/files/iso-27001.pdf',
    ];

    // build xml
    const urlsetAttr = [
        { xmlns: 'http://www.sitemaps.org/schemas/sitemap/0.9' },
        { 'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance' },
        {
            'xsi:schemaLocation':
                'http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd',
        },
    ];

    // get previous day's date/timestamp
    const today = new Date();
    today.setDate(today.getDate() - 1);

    const timestamp = today.toISOString();

    const urlset = builder.create().ele('urlset');

    // apply attributes to root element
    urlsetAttr.forEach(attr => {
        urlset.att(attr);
    });

    //append urls to root element
    siteUrls.forEach(url => {
        const urlElement = urlset.ele('url');
        urlElement.ele('loc').txt(url);
        urlElement.ele('lastmod').txt(timestamp);
    });

    // generate xml file
    const xml = urlset.end({ prettyPrint: true });

    res.setHeader('Content-Type', 'text/xml');
    res.send(xml);
});

// cache policy for static contents
// loads up the site faster
app.use(
    express.static(path.join(__dirname, 'public'), {
        setHeaders(res: Response) {
            res.setHeader('Cache-Control', 'public,max-age=31536000,immutable');
        },
    })
);

app.get('/*', (req: ExpressRequest, res: ExpressResponse) => {
    res.status(404);
    res.render('notFound.ejs', {
        footerCards: false,
        support: false,
        cta: false,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.set('port', process.env['PORT'] || 1444);

app.listen(app.get('port'), function () {
    logger.info('Server running on port : ' + app.get('port'));
});
