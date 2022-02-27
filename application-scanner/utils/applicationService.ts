import crypto from 'crypto';
import EncryptionKeys from './encryptionKeys';
const algorithm = EncryptionKeys.algorithm;
const key = EncryptionKeys.key;
import git from 'simple-git/promise';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v1 as uuidv1 } from 'uuid';
import Path from 'path';
import ErrorService from './errorService';
import fs from 'fs';
import { promisify } from 'util';
const readdir = promisify(fs.readdir);
const rmdir = promisify(fs.rmdir);
const unlink = promisify(fs.unlink);
import { spawn } from 'child_process';
const {
    updateApplicationSecurityToScanning,
    updateApplicationSecurityLogService,
    updateApplicationSecurityScanTime,
    updateApplicationSecurityToFailed,
} = require('./applicationSecurityUpdate');

// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'ssh2... Remove this comment to see the full error message
import { Client } from 'ssh2';
export default {
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'security' implicitly has an 'any' type.
    scan: async function(security) {
        if (
            security.gitCredential.gitUsername &&
            security.gitCredential.gitPassword
        ) {
            const decryptedSecurity = await this.decryptPassword(security);
            await this.scanApplicationSecurity(decryptedSecurity);
        }
        if (
            security.gitCredential.sshTitle &&
            security.gitCredential.sshPrivateKey
        ) {
            await this.sshScanApplicationSecurity(security);
        }
    },
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'security' implicitly has an 'any' type.
    decryptPassword: async function(security) {
        try {
            const values = [];
            for (let i = 0; i <= 15; i++) {
                values.push(security.gitCredential.iv[i]);
            }
            const iv = Buffer.from(values);
            security.gitCredential.gitPassword = await this.decrypt(
                security.gitCredential.gitPassword,
                iv
            );
            return security;
        } catch (error) {
            ErrorService.log(
                'applicationSecurityService.decryptPassword',
                error
            );
            throw error;
        }
    },
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'encText' implicitly has an 'any' type.
    decrypt: (encText, iv) => {
        const promise = new Promise((resolve, reject) => {
            try {
                // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
                const decipher = crypto.createDecipheriv(algorithm, key, iv);
                let decoded = decipher.update(encText, 'hex', 'utf8');
                decoded += decipher.final('utf8');
                resolve(decoded);
            } catch (error) {
                reject(error);
            }
        });
        return promise;
    },
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'security' implicitly has an 'any' type.
    sshScanApplicationSecurity: async security => {
        try {
            let securityDir = 'application_security_dir';
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'unknown' is not assignable to type 'string'.
            securityDir = await createDir(securityDir);
            const cloneDirectory = `${uuidv1()}security`; // always create unique paths
            const repoPath = Path.resolve(securityDir, cloneDirectory);
            const conn = new Client();

            const url = security.gitRepositoryUrl.split(
                'https://github.com/'
            )[1];

            conn.on('ready', () => {
                // eslint-disable-next-line no-console
                console.log('SSH Client :: ready');
                return new Promise((resolve, reject) => {
                    git(securityDir)
                        .silent(true)
                        .clone(`git@github.com:${url}.git`, cloneDirectory)
                        .then(() => {
                            const output = spawn('npm', ['install'], {
                                cwd: repoPath,
                            });
                            output.on('error', error => {
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
                                error.code = 500;
                                throw error;
                            });

                            output.on('close', () => {
                                let auditOutput = '';
                                const audit = spawn(
                                    'npm',
                                    ['audit', '--json'],
                                    {
                                        cwd: repoPath,
                                    }
                                );

                                audit.on('error', error => {
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
                                    error.code = 500;
                                    throw error;
                                });

                                audit.stdout.on('data', data => {
                                    const strData = data.toString();
                                    auditOutput += strData;
                                });

                                audit.on('close', async () => {
                                    let advisories = [];
                                    auditOutput = JSON.parse(auditOutput); // parse the stringified json
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'vulnerabilities' does not exist on type ... Remove this comment to see the full error message
                                    for (const key in auditOutput.vulnerabilities) {
                                        advisories.push(
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'vulnerabilities' does not exist on type ... Remove this comment to see the full error message
                                            auditOutput.vulnerabilities[key]
                                        );
                                    }

                                    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'criticalArr' implicitly has type 'any[]'... Remove this comment to see the full error message
                                    const criticalArr = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'highArr' implicitly has type 'any[]' in ... Remove this comment to see the full error message
                                        highArr = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'moderateArr' implicitly has type 'any[]'... Remove this comment to see the full error message
                                        moderateArr = [],
                                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'lowArr' implicitly has type 'any[]' in s... Remove this comment to see the full error message
                                        lowArr = [];
                                    advisories.map(advisory => {
                                        if (advisory.severity === 'critical') {
                                            criticalArr.push(advisory);
                                        }
                                        if (advisory.severity === 'high') {
                                            highArr.push(advisory);
                                        }
                                        if (advisory.severity === 'moderate') {
                                            moderateArr.push(advisory);
                                        }
                                        if (advisory.severity === 'low') {
                                            lowArr.push(advisory);
                                        }
                                        return advisory;
                                    });

                                    // restructure advisories from the most critical case to the least critical(low)
                                    advisories = [
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'criticalArr' implicitly has an 'any[]' t... Remove this comment to see the full error message
                                        ...criticalArr,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'highArr' implicitly has an 'any[]' type.
                                        ...highArr,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'moderateArr' implicitly has an 'any[]' t... Remove this comment to see the full error message
                                        ...moderateArr,
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'lowArr' implicitly has an 'any[]' type.
                                        ...lowArr,
                                    ];

                                    const auditData = {
                                        dependencies:
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'metadata' does not exist on type 'string... Remove this comment to see the full error message
                                            auditOutput.metadata.dependencies,
                                        devDependencies:
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'metadata' does not exist on type 'string... Remove this comment to see the full error message
                                            auditOutput.metadata
                                                .devDependencies,
                                        optionalDependencies:
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'metadata' does not exist on type 'string... Remove this comment to see the full error message
                                            auditOutput.metadata
                                                .optionalDependencies,
                                        totalDependencies:
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'metadata' does not exist on type 'string... Remove this comment to see the full error message
                                            auditOutput.metadata
                                                .totalDependencies,
                                        vulnerabilities:
                                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'metadata' does not exist on type 'string... Remove this comment to see the full error message
                                            auditOutput.metadata
                                                .vulnerabilities,
                                        advisories,
                                    };

                                    const resolvedLog = await updateApplicationSecurityLogService(
                                        {
                                            securityId: security._id,
                                            componentId:
                                                security.componentId._id,
                                            data: auditData,
                                        }
                                    );
                                    await updateApplicationSecurityScanTime({
                                        _id: security._id,
                                    });
                                    await deleteFolderRecursive(repoPath);
                                    return resolve(resolvedLog);
                                });
                            });
                        })
                        .catch(async error => {
                            await updateApplicationSecurityToFailed(security);
                            error.message =
                                'Authentication failed please check your git credentials or git repository url';
                            ErrorService.log(
                                'applicationSecurityUpdate.updateApplicationSecurityToFailed',
                                error
                            );

                            await deleteFolderRecursive(repoPath);
                            return reject(error);
                        });
                });
            }).connect({
                // This is where we use the ssh private Key to connect to github
                host: 'github.com',
                username: 'git',
                privateKey: security.gitCredential.sshPrivateKey,
            });
        } catch (error) {
            ErrorService.log(
                'applicationScannerService.scanApplicationSecurity',
                error
            );
            throw error;
        }
    },
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'security' implicitly has an 'any' type.
    scanApplicationSecurity: async security => {
        try {
            let securityDir = 'application_security_dir';
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'unknown' is not assignable to type 'string'.
            securityDir = await createDir(securityDir);

            const USER = security.gitCredential.gitUsername;
            const PASS = security.gitCredential.gitPassword;
            // format the url
            const REPO = formatUrl(security.gitRepositoryUrl);
            const remote = `https://${USER}:${PASS}@${REPO}`;
            const cloneDirectory = `${uuidv1()}security`; // always create unique paths
            const repoPath = Path.resolve(securityDir, cloneDirectory);

            // update application security to scanning true
            // to prevent pulling an applicaiton security multiple times by running cron job
            // due to network delay
            await updateApplicationSecurityToScanning(security);

            return new Promise((resolve, reject) => {
                git(securityDir)
                    .silent(true)
                    .clone(remote, cloneDirectory)
                    .then(() => {
                        const output = spawn('npm', ['install'], {
                            cwd: repoPath,
                        });
                        output.on('error', error => {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
                            error.code = 500;
                            throw error;
                        });

                        output.on('close', () => {
                            let auditOutput = '';
                            const audit = spawn('npm', ['audit', '--json'], {
                                cwd: repoPath,
                            });

                            audit.on('error', error => {
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
                                error.code = 500;
                                throw error;
                            });

                            audit.stdout.on('data', data => {
                                const strData = data.toString();
                                auditOutput += strData;
                            });

                            audit.on('close', async () => {
                                let advisories = [];
                                auditOutput = JSON.parse(auditOutput); // parse the stringified json
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'vulnerabilities' does not exist on type ... Remove this comment to see the full error message
                                for (const key in auditOutput.vulnerabilities) {
                                    advisories.push(
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'vulnerabilities' does not exist on type ... Remove this comment to see the full error message
                                        auditOutput.vulnerabilities[key]
                                    );
                                }

                                // @ts-expect-error ts-migrate(7034) FIXME: Variable 'criticalArr' implicitly has type 'any[]'... Remove this comment to see the full error message
                                const criticalArr = [],
                                    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'highArr' implicitly has type 'any[]' in ... Remove this comment to see the full error message
                                    highArr = [],
                                    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'moderateArr' implicitly has type 'any[]'... Remove this comment to see the full error message
                                    moderateArr = [],
                                    // @ts-expect-error ts-migrate(7034) FIXME: Variable 'lowArr' implicitly has type 'any[]' in s... Remove this comment to see the full error message
                                    lowArr = [];
                                advisories.map(advisory => {
                                    if (advisory.severity === 'critical') {
                                        criticalArr.push(advisory);
                                    }
                                    if (advisory.severity === 'high') {
                                        highArr.push(advisory);
                                    }
                                    if (advisory.severity === 'moderate') {
                                        moderateArr.push(advisory);
                                    }
                                    if (advisory.severity === 'low') {
                                        lowArr.push(advisory);
                                    }
                                    return advisory;
                                });

                                // restructure advisories from the most critical case to the least critical(low)
                                advisories = [
                                    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'criticalArr' implicitly has an 'any[]' t... Remove this comment to see the full error message
                                    ...criticalArr,
                                    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'highArr' implicitly has an 'any[]' type.
                                    ...highArr,
                                    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'moderateArr' implicitly has an 'any[]' t... Remove this comment to see the full error message
                                    ...moderateArr,
                                    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'lowArr' implicitly has an 'any[]' type.
                                    ...lowArr,
                                ];

                                const auditData = {
                                    dependencies:
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'metadata' does not exist on type 'string... Remove this comment to see the full error message
                                        auditOutput.metadata.dependencies,
                                    devDependencies:
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'metadata' does not exist on type 'string... Remove this comment to see the full error message
                                        auditOutput.metadata.devDependencies,
                                    optionalDependencies:
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'metadata' does not exist on type 'string... Remove this comment to see the full error message
                                        auditOutput.metadata
                                            .optionalDependencies,
                                    totalDependencies:
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'metadata' does not exist on type 'string... Remove this comment to see the full error message
                                        auditOutput.metadata.totalDependencies,
                                    vulnerabilities:
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'metadata' does not exist on type 'string... Remove this comment to see the full error message
                                        auditOutput.metadata.vulnerabilities,
                                    advisories,
                                };

                                const resolvedLog = await updateApplicationSecurityLogService(
                                    {
                                        securityId: security._id,
                                        componentId: security.componentId._id,
                                        data: auditData,
                                    }
                                );
                                await updateApplicationSecurityScanTime({
                                    _id: security._id,
                                });
                                await deleteFolderRecursive(repoPath);
                                return resolve(resolvedLog);
                            });
                        });
                    })
                    .catch(async error => {
                        await updateApplicationSecurityToFailed(security);
                        error.message =
                            'Authentication failed please check your git credentials or git repository url';
                        ErrorService.log(
                            'applicationSecurityUpdate.updateApplicationSecurityToFailed',
                            error
                        );

                        await deleteFolderRecursive(repoPath);
                        return reject(error);
                    });
            });
        } catch (error) {
            ErrorService.log(
                'applicationScannerService.scanApplicationSecurity',
                error
            );
            throw error;
        }
    },
};
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'dir' implicitly has an 'any' type.
async function deleteFolderRecursive(dir) {
    if (fs.existsSync(dir)) {
        const entries = await readdir(dir, { withFileTypes: true });
        await Promise.all(
            entries.map(entry => {
                const fullPath = Path.join(dir, entry.name);
                return entry.isDirectory()
                    ? deleteFolderRecursive(fullPath)
                    : unlink(fullPath);
            })
        );
        await rmdir(dir); // finally remove now empty directory
    }
}
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'url' implicitly has an 'any' type.
function formatUrl(url) {
    // remove https://www. from url
    if (url.indexOf('https://www.') === 0) {
        return url.slice(12);
    }
    // remove http://www. from url
    if (url.indexOf('http://www.') === 0) {
        return url.slice(11);
    }
    // remove https:// from url
    if (url.indexOf('https://') === 0) {
        return url.slice(8);
    }
    // remove http:// from url
    if (url.indexOf('http://') === 0) {
        return url.slice(7);
    }
    // remove www. from url
    if (url.indexOf('www.') === 0) {
        return url.slice(4);
    }

    return url;
}

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'dirPath' implicitly has an 'any' type.
function createDir(dirPath) {
    return new Promise((resolve, reject) => {
        const workPath = Path.resolve(process.cwd(), dirPath);
        if (fs.existsSync(workPath)) {
            resolve(workPath);
        }

        fs.mkdir(workPath, error => {
            if (error) reject(error);
            resolve(workPath);
        });
    });
}
