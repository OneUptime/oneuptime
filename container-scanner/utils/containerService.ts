import crypto from 'crypto'
import EncryptionKeys from './encryptionKeys'
const algorithm = EncryptionKeys.algorithm;
const key = EncryptionKeys.key;
import { v1: uuidv1 } from 'uuid'
import fs from 'fs'
import Path from 'path'
import { promisify } from 'util'
const unlink = promisify(fs.unlink);
import { spawn } from 'child_process'
import ErrorService from './errorService'
const {
    updateContainerSecurityToScanning,
    updateContainerSecurityLogService,
    updateContainerSecurityScanTime,
    updateContainerSecurityToFailed,
} = require('./containerSecurityUpdate');
import flattenArray from '../utils/flattenArray'

export default {
    scan: async function(security) {
        const decryptedSecurity = await this.decryptPassword(security);
        await this.scanContainerSecurity(decryptedSecurity);
    },
    decryptPassword: async function(security) {
        try {
            const values = [];
            for (let i = 0; i <= 15; i++) {
                values.push(security.dockerCredential.iv[i]);
            }
            const iv = Buffer.from(values);
            security.dockerCredential.dockerPassword = await this.decrypt(
                security.dockerCredential.dockerPassword,
                iv
            );
            return security;
        } catch (error) {
            ErrorService.log('containerSecurityService.decryptPassword', error);
            throw error;
        }
    },
    decrypt: (encText, iv) => {
        const promise = new Promise((resolve, reject) => {
            try {
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
    scanContainerSecurity: async security => {
        try {
            const { imagePath, imageTags } = security;
            const testPath = imageTags
                ? `${imagePath}:${imageTags}`
                : imagePath;
            const outputFile = `${uuidv1()}result.json`;
            let securityDir = 'container_security_dir';
            securityDir = await createDir(securityDir);
            const exactFilePath = Path.resolve(securityDir, outputFile);
            // update container security to scanning true
            // so the cron job does not pull it multiple times due to network delays
            // since the cron job runs every minute
            await updateContainerSecurityToScanning(security);

            return new Promise((resolve, reject) => {
                // use trivy open source package to audit a container
                const scanCommand = `trivy image -f json -o ${outputFile} ${testPath}`;
                const clearCommand = `trivy image --clear-cache ${testPath}`;

                const output = spawn(scanCommand, {
                    cwd: securityDir,
                    shell: true,
                });

                output.on('error', async error => {
                    const errorMessage =
                        'Scanning failed please check your docker credential or image path/tag';
                    error.code = 400;
                    error.message = errorMessage;
                    await Promise.all([
                        await updateContainerSecurityToFailed(
                            {
                                _id: security._id,
                            },
                            { scanning: false }
                        ),
                        await updateContainerSecurityScanTime({
                            _id: security._id,
                        }),

                        deleteFile(exactFilePath),
                    ]);
                    return reject(error);
                });

                output.on('close', async () => {
                    let auditLogs = await readFileContent(exactFilePath);
                    // if auditLogs is empty, then scanning was unsuccessful
                    // the provided credentials or image path must have been wrong
                    if (
                        !auditLogs ||
                        (typeof auditLogs === 'string' &&
                            !JSON.stringify(auditLogs).trim())
                    ) {
                        const error = new Error(
                            'Scanning failed please check your docker credential or image path/tag'
                        );
                        error.code = 400;

                        await Promise.all([
                            await updateContainerSecurityToFailed(
                                {
                                    _id: security._id,
                                },
                                { scanning: false }
                            ),
                            await updateContainerSecurityScanTime({
                                _id: security._id,
                            }),
                            deleteFile(exactFilePath),
                        ]);
                        return reject(error);
                    }

                    if (typeof auditLogs === 'string') {
                        auditLogs = JSON.parse(auditLogs); // parse the stringified logs
                    }

                    const clearCache = spawn('trivy', [clearCommand], {
                        cwd: securityDir,
                        shell: true,
                    });

                    clearCache.on('error', async error => {
                        error.code = 400;
                        error.message =
                            'Unable to clear cache, try again later';
                        await Promise.all([
                            await updateContainerSecurityToFailed(
                                {
                                    _id: security._id,
                                },
                                { scanning: false }
                            ),
                            deleteFile(exactFilePath),
                        ]);
                        return reject(error);
                    });

                    clearCache.on('close', async () => {
                        const auditData = {
                            vulnerabilityInfo: {},
                            vulnerabilityData: [],
                        };
                        const counter = {
                            low: 0,
                            moderate: 0,
                            high: 0,
                            critical: 0,
                        };

                        auditLogs.map(auditLog => {
                            const log = {
                                type: auditLog.Type,
                                vulnerabilities: [],
                            };

                            if (
                                auditLog.Vulnerabilities &&
                                auditLog.Vulnerabilities.length > 0
                            ) {
                                auditLog.Vulnerabilities.map(vulnerability => {
                                    let severity;
                                    if (vulnerability.Severity === 'LOW') {
                                        counter.low += 1;
                                        severity = 'low';
                                    }
                                    if (vulnerability.Severity === 'MEDIUM') {
                                        counter.moderate += 1;
                                        severity = 'moderate';
                                    }
                                    if (vulnerability.Severity === 'HIGH') {
                                        counter.high += 1;
                                        severity = 'high';
                                    }
                                    if (vulnerability.Severity === 'CRITICAL') {
                                        counter.critical += 1;
                                        severity = 'critical';
                                    }

                                    const vulObj = {
                                        vulnerabilityId:
                                            vulnerability.VulnerabilityID,
                                        library: vulnerability.PkgName,
                                        installedVersion:
                                            vulnerability.InstalledVersion,
                                        fixedVersions:
                                            vulnerability.FixedVersion,
                                        title: vulnerability.Title,
                                        description: vulnerability.Description,
                                        severity,
                                    };
                                    log.vulnerabilities.push(vulObj);

                                    return vulnerability;
                                });
                            }

                            auditData.vulnerabilityData.push(log);
                            return auditLog;
                        });

                        auditData.vulnerabilityInfo = counter;

                        const arrayData = auditData.vulnerabilityData.map(
                            log => log.vulnerabilities
                        );

                        auditData.vulnerabilityData = flattenArray(arrayData);

                        const criticalArr = [],
                            highArr = [],
                            moderateArr = [],
                            lowArr = [];
                        auditData.vulnerabilityData.map(vulnerability => {
                            if (vulnerability.severity === 'critical') {
                                criticalArr.push(vulnerability);
                            }
                            if (vulnerability.severity === 'high') {
                                highArr.push(vulnerability);
                            }
                            if (vulnerability.severity === 'moderate') {
                                moderateArr.push(vulnerability);
                            }
                            if (vulnerability.severity === 'low') {
                                lowArr.push(vulnerability);
                            }
                            return vulnerability;
                        });

                        auditData.vulnerabilityData = [
                            ...criticalArr,
                            ...highArr,
                            ...moderateArr,
                            ...lowArr,
                        ];

                        const securityLog = await updateContainerSecurityLogService(
                            {
                                securityId: security._id,
                                componentId: security.componentId._id,
                                data: auditData,
                            }
                        );

                        await Promise.all([
                            await updateContainerSecurityScanTime({
                                _id: security._id,
                            }),
                            deleteFile(exactFilePath),
                        ]);
                        resolve(securityLog);
                    });
                });
            });
        } catch (error) {
            ErrorService.log('probeService.scanContainerSecurity', error);
            throw error;
        }
    },
};
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
function readFileContent(filePath) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(filePath)) {
            fs.readFile(filePath, { encoding: 'utf8' }, function(error, data) {
                if (error) {
                    reject(error);
                }
                resolve(data);
            });
        }
    });
}
async function deleteFile(file) {
    if (fs.existsSync(file)) {
        await unlink(file);
    }
}
