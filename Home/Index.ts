import 'ejs';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
    ExpressApplication,
} from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';
import Dictionary from 'Common/Types/Dictionary';
import path from 'path';

import OneUptimeDate from 'Common/Types/Date';
import URL from 'Common/Types/API/URL';
import productCompare, { Product } from './config/product-compare';
import builder from 'xmlbuilder2';
import { XMLBuilder } from 'xmlbuilder2/lib/interfaces';

export const APP_NAME: string = 'home';
const app: ExpressApplication = Express.getExpressApp();

//View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

/**
 * @param {string} val : The value to be parsed.
 * @description Resolves or Parses any value to boolean value.
 * @returns Boolean true or false
 */

//Routes
app.get('/', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('index', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/support', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('support', {
        support: true,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/pricing', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('pricing', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        requestDemoCta: false,
    });
});

app.get('/enterprise/demo', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('demo', {
        support: false,
        footerCards: false,
        cta: false,
        blackLogo: true,
        requestDemoCta: false,
    });
});

app.get(
    '/product/status-page',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.redirect('/product/public-status-page');
    }
);

app.get(
    '/status',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.status(200).send({"status": "ok"})
    }
);

app.get('/status-page', (_req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/public-status-page');
});

app.get(
    '/product/public-status-page',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('public-status-page', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
            footerCtaText:
                'Start with Status Pages, expand into everything else. Sign up today.',
        });
    }
);

app.get('/public-status-page', (_req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/public-status-page');
});

app.get(
    '/product/private-status-page',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('private-status-page', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
            footerCtaText:
                'Start with Status Pages, expand into everything else. Sign up today.',
        });
    }
);

app.get(
    '/private-status-page',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.redirect('/product/private-status-page');
    }
);

app.get(
    '/product/uptime-monitoring',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('uptime-monitoring', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get('/uptime-monitoring', (_req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/uptime-monitoring');
});

app.get(
    '/product/logs-management',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('logs-management', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get('/logs-management', (_req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/logs-management');
});

app.get(
    '/product/error-tracking',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('error-tracking', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get('/error-tracking', (_req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/error-tracking');
});

app.get(
    '/product/docker-container-security',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('container-security', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get(
    '/docker-container-security',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.redirect('/product/docker-container-security');
    }
);

app.get(
    '/product/app-security',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('app-security', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get('/app-security', (_req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/app-security');
});

app.get(
    '/product/api-monitoring',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('api-monitoring', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
            footerCtaText:
                'Start with API monitoring, expand into everything else. Sign up today.',
        });
    }
);

app.get('/api-monitoring', (_req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/api-monitoring');
});

app.get(
    '/product/kubernetes-monitoring',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('kubernetes-monitoring', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get(
    '/kubernetes-monitoring',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.redirect('/product/kubernetes-monitoring');
    }
);

app.get(
    '/product/performance-monitoring',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('performance-monitoring', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get(
    '/performance-monitoring',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.redirect('/product/performance-monitoring');
    }
);

app.get(
    '/product/server-monitoring',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('server-monitoring', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get('/server-monitoring', (_req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/server-monitoring');
});

app.get(
    '/product/website-monitoring',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('website-monitoring', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get('/website-monitoring', (_req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/website-monitoring');
});

app.get(
    '/product/iot-device-monitoring',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('iot-device-monitoring', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get(
    '/iot-device-monitoring',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.redirect('/product/iot-device-monitoring');
    }
);

app.get(
    '/product/incident-management',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('incident-management', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get(
    '/incident-management',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.redirect('/product/incident-management');
    }
);

app.get(
    '/product/oncall-management',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('oncall-management', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: false,
        });
    }
);

app.get('/oncall-management', (_req: ExpressRequest, res: ExpressResponse) => {
    res.redirect('/product/oncall-management');
});

app.get('/customers', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('customers', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: true,
        requestDemoCta: false,
    });
});

app.get(
    '/enterprise/resources',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('resources', {
            support: false,
            footerCards: false,
            cta: true,
            blackLogo: true,
            requestDemoCta: false,
        });
    }
);

app.get(
    '/enterprise/overview',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('enterprise-overview.ejs', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            requestDemoCta: true,
        });
    }
);

app.get('/legal', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'terms',
        requestDemoCta: false,
    });
});

app.get('/legal/terms', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'terms',
        requestDemoCta: false,
    });
});

app.get('/legal/privacy', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'privacy',
        requestDemoCta: false,
    });
});

app.get('/legal/contact', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'contact',
        requestDemoCta: false,
    });
});

app.get(
    '/legal/subprocessors',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('legal.ejs', {
            support: false,
            footerCards: true,
            cta: true,
            blackLogo: false,
            section: 'subprocessors',
            requestDemoCta: false,
        });
    }
);

app.get('/legal/ccpa', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'ccpa',
        requestDemoCta: false,
    });
});

app.get('/legal/hipaa', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'hipaa',
        requestDemoCta: false,
    });
});

app.get('/legal/dmca', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'dmca',
        requestDemoCta: false,
    });
});

app.get('/legal/pci', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'pci',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27001', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        support: false,
        footerCards: true,
        cta: true,
        blackLogo: false,
        section: 'iso-27001',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27017', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'iso-27017',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27018', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'iso-27018',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27017', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'iso-27017',
        requestDemoCta: false,
    });
});

app.get('/legal/iso-27018', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'iso-27018',
        requestDemoCta: false,
    });
});

app.get('/legal/soc-2', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'soc-2',
        requestDemoCta: false,
    });
});

app.get('/legal/soc-3', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'soc-3',
        requestDemoCta: false,
    });
});

app.get(
    '/legal/data-residency',
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.render('legal.ejs', {
            footerCards: true,
            support: false,
            cta: true,
            blackLogo: false,
            section: 'data-residency',
            requestDemoCta: false,
        });
    }
);

app.get('/legal/gdpr', (_req: ExpressRequest, res: ExpressResponse) => {
    res.render('legal.ejs', {
        footerCards: true,
        support: false,
        cta: true,
        blackLogo: false,
        section: 'gdpr',
        requestDemoCta: false,
    });
});

app.get('/legal/sla', (_req: ExpressRequest, res: ExpressResponse) => {
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
    (_req: ExpressRequest, res: ExpressResponse) => {
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
    const productConfig: Product = productCompare(
        req.params['product'] as string
    );

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
    const productConfig: Product = productCompare(
        req.params['product'] as string
    );

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

// Minify default.js
app.get(
    '/js/default.js',
    async (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.sendFile('./public/js/default.js', { root: __dirname });
    }
);

app.get('/css/home.css', async (_req: ExpressRequest, res: ExpressResponse) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile('./public/css/home.css', { root: __dirname });
});

app.get(
    '/css/comparision.css',
    async (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Content-Type', 'text/css');
        res.sendFile('./public/css/comparision.css', { root: __dirname });
    }
);

// Generate sitemap
app.get('/sitemap.xml', async (_req: ExpressRequest, res: ExpressResponse) => {
    const siteUrls: Array<URL> = [
        URL.fromString('https://oneuptime.com/'),
        URL.fromString('https://oneuptime.com/pricing'),
        URL.fromString('https://oneuptime.com/support'),
        URL.fromString('https://oneuptime.com/product/public-status-page'),
        URL.fromString('https://oneuptime.com/product/private-status-page'),
        URL.fromString('https://oneuptime.com/product/uptime-monitoring'),
        URL.fromString('https://oneuptime.com/product/incident-management'),
        URL.fromString('https://oneuptime.com/product/app-security'),
        URL.fromString('https://oneuptime.com/product/api-monitoring'),
        URL.fromString('https://oneuptime.com/product/server-monitoring'),
        URL.fromString('https://oneuptime.com/product/logs-management'),
        URL.fromString(
            'https://oneuptime.com/product/docker-container-security'
        ),
        URL.fromString('https://oneuptime.com/product/oncall-management'),
        URL.fromString('https://oneuptime.com/customers'),
        URL.fromString('https://oneuptime.com/enterprise/overview'),
        URL.fromString('https://oneuptime.com/enterprise/demo'),
        URL.fromString('https://oneuptime.com/enterprise/resources'),
        URL.fromString('https://oneuptime.com/legal/terms'),
        URL.fromString('https://oneuptime.com/legal/privacy'),
        URL.fromString('https://oneuptime.com/legal/gdpr'),
        URL.fromString('https://oneuptime.com/legal/ccpa'),
        URL.fromString('https://oneuptime.com/legal'),
        URL.fromString('https://oneuptime.com/compare/pagerduty'),
        URL.fromString('https://oneuptime.com/compare/pingdom'),
        URL.fromString('https://oneuptime.com/compare/status-page.io'),
        URL.fromString('https://oneuptime.com/table/pagerduty'),
        URL.fromString('https://oneuptime.com/table/pingdom'),
        URL.fromString('https://oneuptime.com/table/status-page.io'),
        URL.fromString('https://oneuptime.com/legal/soc-2'),
        URL.fromString('https://oneuptime.com/legal/soc-3'),
        URL.fromString('https://oneuptime.com/legal/iso-27017'),
        URL.fromString('https://oneuptime.com/legal/iso-27018'),
        URL.fromString('https://oneuptime.com/legal/hipaa'),
        URL.fromString('https://oneuptime.com/legal/pci'),
        URL.fromString(
            'https://oneuptime.com/enterprise/download-resource/website-monitoring'
        ),
        URL.fromString(
            'https://oneuptime.com/enterprise/download-resource/speed-equals-revenue'
        ),
        URL.fromString(
            'https://oneuptime.com/enterprise/download-resource/best-practices'
        ),
        URL.fromString(
            'https://oneuptime.com/enterprise/download-resource/planning-for-peak-performance'
        ),
        URL.fromString('https://oneuptime.com/legal/sla'),
        URL.fromString('https://oneuptime.com/legal/iso-27001'),
        URL.fromString('https://oneuptime.com/legal/data-residency'),
        URL.fromString('https://oneuptime.com/legal/dmca'),
        URL.fromString('https://oneuptime.com/legal/subprocessors'),
        URL.fromString('https://oneuptime.com/legal/contact'),
        URL.fromString('https://oneuptime.com/files/soc-3.pdf'),
        URL.fromString('https://oneuptime.com/files/iso-27017.pdf'),
        URL.fromString('https://oneuptime.com/files/iso-27018.pdf'),
        URL.fromString('https://oneuptime.com/files/pci.pdf'),
        URL.fromString('https://oneuptime.com/files/iso-27001.pdf'),
    ];

    // Build xml
    const urlsetAttr: Dictionary<string> = {
        xmlns: 'http://www.sitemaps.org/schemas/sitemap/0.9',
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        'xsi:schemaLocation':
            'http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd',
    };

    // Get previous day's date/timestamp
    const today: Date = OneUptimeDate.getOneDayAgo();
    const timestamp: string = today.toISOString();

    const urlset: XMLBuilder = builder.create().ele('urlset');

    // Apply attributes to root element
    for (const key in urlsetAttr) {
        urlset.att({ key: urlsetAttr[key] });
    }

    //Append urls to root element
    siteUrls.forEach((url: URL) => {
        const urlElement: XMLBuilder = urlset.ele('url');
        urlElement.ele('loc').txt(url.toString());
        urlElement.ele('lastmod').txt(timestamp);
    });

    // Generate xml file
    const xml: string = urlset.end({ prettyPrint: true });

    res.setHeader('Content-Type', 'text/xml');
    res.send(xml);
});

/*
 * Cache policy for static contents
 * Loads up the site faster
 */
app.use(
    ExpressStatic(path.join(__dirname, 'public'), {
        setHeaders(res: ExpressResponse) {
            res.setHeader('Cache-Control', 'public,max-age=31536000,immutable');
        },
    })
);

app.get('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(404);
    res.render('notFound.ejs', {
        footerCards: false,
        support: false,
        cta: false,
        blackLogo: false,
        requestDemoCta: false,
    });
});

App(APP_NAME);
