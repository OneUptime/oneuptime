#!/usr/bin/env tsx

import yargs from 'yargs';
import { ChildProcess, spawn } from 'node:child_process';
import Logger from './Utils/Logger';
import PackageJson from './package.json';
import MonitorInfrastructure from './Jobs/MonitorInfrastructure';
import fs from 'fs';

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

const returnValue:
    | {
          [x: string]: unknown;
          _: (string | number)[];
          $0: string;
      }
    | Promise<{
          [x: string]: unknown;
          _: (string | number)[];
          $0: string;
      }> = yargs
    .scriptName('oneuptime-infrastructure-agent')
    .usage(usage)
    .version(PackageJson.version)
    .command(
        'start',
        'Start the app as a daemon',
        (y: any) => {
            return y
                .option('k', {
                    alias: 'secret-key',
                    describe:
                        'Secret Key for this agent. You will find this on OneUptime Dashboard',
                    type: 'string',
                    demandOption: true,
                })
                .option('u', {
                    alias: 'oneuptime-url',
                    describe:
                        'OneUptime Host. By default this is https://oneuptime.com',
                    type: 'string',
                    demandOption: false,
                });
        },
        async (y: any) => {
            const argv: ArgumentType = y.argv as ArgumentType;

            // add secrt key and oneuptime url

            const startArguments: Array<string> = ['Start.ts'];

            const secretKey: string | undefined = argv['secret-key'] as
                | string
                | undefined;

            if (secretKey) {
                startArguments.push('--secret-key=' + secretKey.toString());
            } else {
                Logger.info(
                    'No --secret-key argument found. You can find secret key for this monitor on OneUptime Dashboard'
                );
                process.exit(1);
            }

            const oneuptimeUrl: string | undefined =
                (argv['oneuptime-url'] as string | undefined) ||
                'https://oneuptime.com';

            startArguments.push('--oneuptime-url=' + oneuptimeUrl.toString());

            // before we run as daemon, we need to verify if the credentials are correct

            try {
                const isValidSecretKey: boolean =
                    await MonitorInfrastructure.checkIfSecretKeyIsValid({
                        oneuptimeUrl: oneuptimeUrl,
                        secretKey: secretKey,
                    });

                if (!isValidSecretKey) {
                    Logger.error('Invalid secret key or OneUptime URL');
                    process.exit(1);
                }

                const out: number = fs.openSync('./out.log', 'a');
                const err: number = fs.openSync('./err.log', 'a');

                // clean up logs
                fs.writeFileSync('./out.log', '');
                fs.writeFileSync('./err.log', '');

                daemon = spawn('tsx', startArguments, {
                    detached: true,
                    stdio: ['ignore', out, err],
                });

                daemon.unref();
                Logger.info('OneUptime Infrastructure Agent started as daemon');
            } catch (err) {
                Logger.error(err);
                process.exit(1);
            }
        }
    )
    .command(
        'stop',
        'Stop the daemon',
        () => {},
        () => {
            if (daemon && daemon.pid) {
                process.kill(daemon.pid);
                Logger.info('OneUptime Infrastructure Agent stopped');
            } else {
                Logger.info('OneUptime Infrastructure Agent not running');
            }
        }
    )
    .command(
        'status',
        'Show status of daemon',
        () => {},
        () => {
            if (daemon && daemon.pid) {
                Logger.info('OneUptime Infrastructure Agent is running');
            } else {
                Logger.info('OneUptime Infrastructure Agent is not running');
            }
        }
    )
    .command(
        'logs',
        'Show logs',
        () => {},
        () => {
            // show logs from daemon

            if (daemon && daemon.pid) {
                const logs: string = fs.readFileSync('./out.log', 'utf-8');
                Logger.info(logs);
            } else {
                Logger.info('OneUptime Infrastructure Agent is not running');
            }
        }
    )
    .command(
        '$0',
        'the default command',
        () => {},
        () => {
            yargs.showHelp();
        }
    )
    .help(true).argv;

if (returnValue instanceof Promise) {
    returnValue.catch((err: Error) => {
        Logger.error(err);
        process.exit(1);
    });
}
