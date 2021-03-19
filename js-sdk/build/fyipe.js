#!/usr/bin/env node
"use strict";

var _require = require('../../package.json'),
    version = _require.version;

var program = require('commander');

program.name('fyipe').version(version, '-v, --version').description('Fyipe SDK cli');
program.command('server-monitor [options]', 'Fyipe Monitoring shell', {
  executableFile: './server-monitor/bin/index'
});
program.parse(process.argv);