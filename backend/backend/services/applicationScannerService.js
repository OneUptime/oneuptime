module.exports = {
    create: async function(data) {
        try {
            const _this = this;
            let applicationScannerKey;
            if (data.applicationScannerKey) {
                applicationScannerKey = data.applicationScannerKey;
            } else {
                applicationScannerKey = uuidv1();
            }
            const storedApplicationScanner = await _this.findOneBy({
                applicationScannerName: data.applicationScannerName,
            });
            if (
                storedApplicationScanner &&
                storedApplicationScanner.applicationScannerName
            ) {
                const error = new Error(
                    'applicationScanner name already exists.'
                );
                error.code = 400;
                ErrorService.log('applicationScanner.create', error);
                throw error;
            } else {
                const applicationScanner = new ApplicationScannerModel();
                applicationScanner.applicationScannerKey = applicationScannerKey;
                applicationScanner.applicationScannerName =
                    data.applicationScannerName;
                applicationScanner.version = data.applicationScannerVersion;
                const savedApplicationScanner = await applicationScanner.save();
                return savedApplicationScanner;
            }
        } catch (error) {
            ErrorService.log('applicationScannerService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const applicationScanner = await ApplicationScannerModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );
            return applicationScanner;
        } catch (error) {
            ErrorService.log('applicationScannerService.updateOneBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const applicationScanner = await ApplicationScannerModel.findOne(
                query,
                {
                    deleted: false,
                }
            ).lean();
            return applicationScanner;
        } catch (error) {
            ErrorService.log('applicationScannerService.findOneBy', error);
            throw error;
        }
    },

    updateApplicationScannerStatus: async function(applicationScannerId) {
        try {
            const applicationScanner = await ApplicationScannerModel.findOneAndUpdate(
                { _id: applicationScannerId },
                { $set: { lastAlive: Date.now() } },
                { new: true }
            );
            return applicationScanner;
        } catch (error) {
            ErrorService.log(
                'applicationScannerService.updateApplicationScannerStatus',
                error
            );
            throw error;
        }
    },

    scanApplicationSecurity: async security => {
        try {
            let securityDir = 'application_security_dir';
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
            let applicationSecurity = await ApplicationSecurityService.updateOneBy(
                {
                    _id: security._id,
                },
                { scanning: true }
            );
            global.io.emit(
                `security_${applicationSecurity._id}`,
                applicationSecurity
            );

            return new Promise((resolve, reject) => {
                git(securityDir)
                    .silent(true)
                    .clone(remote, cloneDirectory)
                    .then(() => {
                        const output = spawn('npm', ['install'], {
                            cwd: repoPath,
                        });
                        output.on('error', error => {
                            error.code = 500;
                            throw error;
                        });

                        output.on('close', () => {
                            let auditOutput = '';
                            const audit = spawn('npm', ['audit', '--json'], {
                                cwd: repoPath,
                            });

                            audit.on('error', error => {
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
                                for (const key in auditOutput.advisories) {
                                    advisories.push(
                                        auditOutput.advisories[key]
                                    );
                                }

                                const criticalArr = [],
                                    highArr = [],
                                    moderateArr = [],
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
                                    ...criticalArr,
                                    ...highArr,
                                    ...moderateArr,
                                    ...lowArr,
                                ];

                                const auditData = {
                                    dependencies:
                                        auditOutput.metadata.dependencies,
                                    devDependencies:
                                        auditOutput.metadata.devDependencies,
                                    optionalDependencies:
                                        auditOutput.metadata
                                            .optionalDependencies,
                                    totalDependencies:
                                        auditOutput.metadata.totalDependencies,
                                    vulnerabilities:
                                        auditOutput.metadata.vulnerabilities,
                                    advisories,
                                };

                                const securityLog = await ApplicationSecurityLogService.create(
                                    {
                                        securityId: security._id,
                                        componentId: security.componentId._id,
                                        data: auditData,
                                    }
                                );

                                await ApplicationSecurityService.updateScanTime(
                                    {
                                        _id: security._id,
                                    }
                                );

                                await deleteFolderRecursive(repoPath);
                                return resolve(securityLog);
                            });
                        });
                    })
                    .catch(async error => {
                        applicationSecurity = await ApplicationSecurityService.updateOneBy(
                            {
                                _id: security._id,
                            },
                            { scanning: false }
                        );
                        global.io.emit(
                            `security_${applicationSecurity._id}`,
                            applicationSecurity
                        );
                        await deleteFolderRecursive(repoPath);
                        ErrorService.log(
                            'applicationScannerService.scanApplicationSecurity',
                            error
                        );
                        error.code = 400;
                        error.message =
                            'Authentication failed please check your git credentials or git repository url';
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

/**
 * verifies if a specific script condition satisfies
 * @param {'and' | 'or'} conditionLogic
 * @returns {{ valid : boolean, reason : string} | undefined} whether the condition is satisfied
 */

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

const ApplicationScannerModel = require('../models/applicationScanner');
const ErrorService = require('./errorService');
const uuidv1 = require('uuid/v1');
const git = require('simple-git/promise');
const fs = require('fs');
const { spawn } = require('child_process');
const Path = require('path');
const ApplicationSecurityLogService = require('./applicationSecurityLogService');
const ApplicationSecurityService = require('./applicationSecurityService');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const rmdir = promisify(fs.rmdir);
const unlink = promisify(fs.unlink);
