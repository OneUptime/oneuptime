const express = require('express');
const path = require('path');
const app = express();
const envfile = require('envfile');
const sourcePath = '.env';
const fs = require('fs');

var env = {
  REACT_APP_FYIPE_HOSTED: process.env.FYIPE_HOSTED,
  REACT_APP_HOST: process.env.HOST,
  REACT_APP_ACCOUNTS_HOST: process.env.ACCOUNTS_HOST,
  REACT_APP_BACKEND_HOST: process.env.BACKEND_HOST
}

let parsedFile = envfile.parseFileSync(sourcePath);
parsedFile = env;
fs.writeFileSync('./.env', envfile.stringifySync(parsedFile));

app.use(express.static(path.join(__dirname, 'build')));

app.get('/*', function (req, res) {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(3003);