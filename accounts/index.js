const express = require('express');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, 'build')));

var env = {
  TEST: 'TEST',
  FYIPE_HOSTED: process.env.FYIPE_HOSTED,
  HOST: process.env.HOST,
  ACCOUNTS_HOST: process.env.ACCOUNTS_HOST,
  BACKEND_HOST: process.env.BACKEND_HOST
}

app.get('/env', function (req, res) {
  res.send(JSON.stringify(env));
})
app.get('/*', function (req, res) {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(3003);