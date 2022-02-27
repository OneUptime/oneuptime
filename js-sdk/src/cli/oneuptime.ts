#!/usr/bin/env node
// @ts-expect-error ts-migrate(2732) FIXME: Cannot find module '../../package.json'. Consider ... Remove this comment to see the full error message
import { version } from '../../package.json';
import program from 'commander';
program
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'typeof imp... Remove this comment to see the full error message
    .name('oneuptime')
    .version(version, '-v, --version')
    .description('OneUptime SDK cli');

// @ts-expect-error ts-migrate(2551) FIXME: Property 'command' does not exist on type 'typeof ... Remove this comment to see the full error message
program.command('server-monitor [options]', 'OneUptime Monitoring shell', {
    executableFile: './server-monitor/bin/index',
});

// @ts-expect-error ts-migrate(2339) FIXME: Property 'parse' does not exist on type 'typeof im... Remove this comment to see the full error message
program.parse(process.argv);
