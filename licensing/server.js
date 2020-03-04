var express = require('express');
var app = express();
require('dotenv').config();
var compression = require('compression');
var licenseRoute  = require('./src/routes/licenseRoute.js');
var cors = require('cors');

app.use(compression());app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true}));
app.use(cors());

app.use("/license",licenseRoute);

app.all('*', (req, res) => res.status(404).send({message : 'Not Found'}));

module.exports = app;