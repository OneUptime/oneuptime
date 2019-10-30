var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var request = require('request'); //eslint-disable-line
var path = require('path');
var compression = require('compression');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));

app.use(compression());

app.use('*', function(req, res, next) {
	if(process.env && process.env.PRODUCTION){
		res.set('Cache-Control', 'public, max-age=86400');
	}
	else
		res.set('Cache-Control', 'no-cache');
	next();
});

//View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

//Routes
app.get('/', function(req, res) {
    res.render('index', {footerCards: true, cta:true, blackLogo:false,requestDemoCta:false});
});

app.get('/support', function(req, res) {
    res.render('support', {footerCards: true, cta:true, blackLogo:false,requestDemoCta:false});
});

app.get('/pricing', function(req, res) {
    res.render('pricing', {footerCards: true, cta:true, blackLogo:false,requestDemoCta:false});
});

app.get('/enterprise/demo', function(req, res) {
    res.render('demo', {footerCards: false, cta:false, blackLogo:true,requestDemoCta:false});
});

app.get('/product/status-page', function(req, res) {
    res.render('status-page', {footerCards: true, cta:true, blackLogo:false,requestDemoCta:false});
});

app.get('/product/uptime-monitoring', function(req, res) {
    res.render('uptime-monitoring', {footerCards: true, cta:true, blackLogo:false,requestDemoCta:false});
});

app.get('/product/oncall-management', function(req, res) {
    res.render('oncall-management', {footerCards: true, cta:true, blackLogo:false,requestDemoCta:false});
});

app.get('/customers', function(req, res) {
    res.render('customers', {footerCards: true, cta:true, blackLogo:true,requestDemoCta:false});
});

app.get('/enterprise/resources', function(req, res) {
    res.render('resources', {footerCards: false, cta:true, blackLogo:true,requestDemoCta:false});
});

app.get('/enterprise/overview', function(req, res) {
    res.render('enterprise-overview.ejs', {footerCards: true, cta:true, blackLogo:false, requestDemoCta:true});
});

app.get('/legal', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'terms',requestDemoCta:false});
});

app.get('/legal/terms', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'terms',requestDemoCta:false});
});

app.get('/legal/privacy', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'privacy',requestDemoCta:false});
});

app.get('/legal/contact', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'contact',requestDemoCta:false});
});

app.get('/legal/hipaa', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'hipaa',requestDemoCta:false});
});

app.get('/legal/pci', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'pci',requestDemoCta:false});
});

app.get('/legal/iso-27001', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'iso-27001',requestDemoCta:false});
});

app.get('/legal/iso-27017', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'iso-27017',requestDemoCta:false});
});

app.get('/legal/iso-27018', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'iso-27018',requestDemoCta:false});
});

app.get('/legal/soc-2', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'soc-2',requestDemoCta:false});
});

app.get('/legal/soc-3', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'soc-3',requestDemoCta:false});
});

app.get('/legal/data-residency', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'data-residency',requestDemoCta:false});
});

app.get('/legal/gdpr', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'gdpr',requestDemoCta:false});
});

app.get('/legal/sla', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false, section: 'sla',requestDemoCta:false});
});

app.get('/enterprise/download-resource/:resourceName', function(req, res) {
    res.render('download-resource.ejs', {footerCards: false, cta:false, blackLogo:true,requestDemoCta:false});
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: 2592000 }));

app.get('/*', function(req, res) {
    res.render('notFound.ejs', {footerCards: true, cta:true, blackLogo:false,  section: 'terms',requestDemoCta:false});
});

app.set('port', process.env.PORT || 1444);

app.listen(app.get('port'), function() {
//eslint-disable-next-line
console.log('Server running on port : '+app.get('port'));
});

