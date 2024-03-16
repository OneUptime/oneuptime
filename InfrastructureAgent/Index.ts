#!/usr/bin/env ts-node

//@ts-ignore
import yargs from 'yargs';
import MonitorInfrastructure from './Jobs/MonitorInfrastructure';

const usage: string =
    '\nUsage: oneuptime-infrastructure-agent --secret-key <secret-key>';

const argv: {
    [x: string]: unknown;
    k: string;
    h: string | undefined;
    _: (string | number)[];
    $0: string;
} | Promise<{
    [x: string]: unknown;
    k: string;
    h: string | undefined;
    _: (string | number)[];
    $0: string;
}> = yargs
    .usage(usage)
    .option('k', {
        alias: 'secret-key',
        describe:
            'Secret Key for this agent. You will find this on OneUptime Dashboard',
        type: 'string',
        demandOption: true,
    })
    .option('h', {
        alias: 'oneuptime-host',
        describe: 'OneUptime Host. By default this is https://oneuptime.com',
        type: 'string',
        demandOption: false,
    })
    .help(true).argv;

const secretKey: string | undefined = (argv as any)['secret-key'];
const oneuptimeHost: string = (argv as any)['oneuptime-host'] || 'https://oneuptime.com'

if (!secretKey) {
    throw new Error(
        'No secret-key argument found. You can find secret key for this monitor on OneUptime Dashboard'
    );
}

MonitorInfrastructure.initJob(secretKey, oneuptimeHost);
