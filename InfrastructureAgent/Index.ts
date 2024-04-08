#!/usr/bin/env tsx

import yargs from 'yargs';
import { ChildProcess, spawn } from 'node:child_process';
import Logger from './Utils/Logger';
import PackageJson from './package.json';

export interface ArgumentType {
    [x: string]: unknown;
    k: string;
    u: string | undefined;
    _: (string | number)[];
    $0: string;
}

let daemon: ChildProcess | null = null;

const usage: string =
    '\nUsage: oneuptime-infrastructure-agent start --secret-key <secret-key>.';


yargs
    .scriptName('oneuptime-infrastructure-agent')
    .usage(usage)
    .version(PackageJson.version)
    .command('start', 'Start the app as a daemon', (y: any) => {

        return y.option('k', {
            alias: 'secret-key',
            describe:
                'Secret Key for this agent. You will find this on OneUptime Dashboard',
            type: 'string',
            demandOption: true,
        })
            .option('u', {
                alias: 'oneuptime-url',
                describe: 'OneUptime Host. By default this is https://oneuptime.com',
                type: 'string',
                demandOption: false,
            });
    }, (y: any) => {

        const argv = y.argv as ArgumentType;

        // add secrt key and oneuptime url

        const startArguments: Array<string> = ['Start.ts'];

        if (argv['secret-key']) {
            startArguments.push('--secret-key=' + argv['secret-key'].toString());
        } else {
            Logger.info('No --secret-key argument found. You can find secret key for this monitor on OneUptime Dashboard');
            process.exit(1);
        }

        if (argv['oneuptime-url']) {
            startArguments.push('--oneuptime-url=' + argv['oneuptime-url'].toString());
        } else {
            startArguments.push('--oneuptime-url=https://oneuptime.com');
        }


        daemon = spawn('tsx', startArguments, {
            detached: true,
            stdio: 'ignore'
        });
        daemon.unref();
        Logger.info('OneUptime Infrastructure Agent started as daemon');
    })
    .command('stop', 'Stop the daemon', () => {
        if (daemon && daemon.pid) {
            process.kill(daemon.pid);
            Logger.info('OneUptime Infrastructure Agent stopped');
        } else {
            Logger.info('OneUptime Infrastructure Agent not running');
        }
    })
    .command('$0', 'the default command', () => { }, (_) => {
        yargs.showHelp();
    })
    .help(true).argv;


