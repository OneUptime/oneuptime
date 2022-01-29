#!/usr/bin/env node
const { version } = require('../../package.json');
const program = require('commander');
program
    .name('oneuptime')
    .version(version, '-v, --version')
    .description('OneUptime SDK cli');

program.command('server-monitor [options]', 'OneUptime Monitoring shell', {
    executableFile: './server-monitor/bin/index',
});

program.parse(process.argv);
