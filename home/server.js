var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var request = require('request');
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
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false, blackLogo:false, section: 'terms',requestDemoCta:false});
});

app.get('/legal/terms', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false, blackLogo:false, section: 'terms',requestDemoCta:false});
});

app.get('/legal/privacy', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false, blackLogo:false, section: 'privacy',requestDemoCta:false});
});

app.get('/legal/sla', function(req, res) {
    res.render('legal.ejs', {footerCards: true, cta:true, blackLogo:false, section: 'sla',requestDemoCta:false});
});

app.get('/enterprise/download-resource/:resourceName', function(req, res) {
    res.render('download-resource.ejs', {footerCards: false, cta:false, blackLogo:true,requestDemoCta:false});
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: 2592000 }));

app.get('/*', function(req, res) {
    res.render('notFound.ejs', {footerCards: true, cta:true, blackLogo:false, blackLogo:false, section: 'terms',requestDemoCta:false});
});

app.set('port', process.env.PORT || 1444);

var server = app.listen(app.get('port'), function() {
	console.log('Server running on port : '+app.get('port'));
});
