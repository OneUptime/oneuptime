const slackin = require('slackin-extended');
const server = slackin.default({
    token: process.env.SLACK_TOKEN, // Fyipe Legacy token - required
    interval: 24 * 60 * 60 * 1000, //check slack registered users every day.
    org: 'fyipehelp', // fyipehelp.slack.com - required
    silent: false, // suppresses warning
    accent: 'black',
    proxy: true,
    path: '/slack',
});

//to handle /slack path for application running behind ingress.
server.app.use('/', function(req, res, next) {
    if (req.url.startsWith('/slack')) {
        req.url = req.url.split('/slack')[1];
        if (req.url === '') {
            req.url = '/';
        }
        server.app.handle(req, res);
    } else {
        next();
    }
});

server.listen(1267);
