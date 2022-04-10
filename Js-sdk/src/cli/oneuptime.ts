#!/usr/bin/env node

import { version } from '../../package.json';
import program from 'commander';
program

    .name('oneuptime')
    .version(version, '-v, --version')
    .description('OneUptime SDK cli');

program.command('server-monitor [options]', 'OneUptime Monitoring shell', {
    executableFile: './server-monitor/bin/index',
});

program.parse(process.argv);
