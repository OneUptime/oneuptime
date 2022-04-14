import crypto from 'crypto';
import EncryptionKeys from './encryptionKeys';
const algorithm: $TSFixMe = EncryptionKeys.algorithm;
const key: $TSFixMe = EncryptionKeys.key;
import BadDataException from 'Common/Types/Exception/BadDataException';
import { v1 as uuidv1 } from 'uuid';
import fs from 'fs';
import Path from 'path';
import { promisify } from 'util';
const unlink: $TSFixMe = promisify(fs.unlink);
import { spawn } from 'child_process';
import {
    updateContainerSecurityToScanning,
    updateContainerSecurityLogService,
    updateContainerSecurityScanTime,
    updateContainerSecurityToFailed,
} from './containerSecurityUpdate';
import flattenArray from './flattenArray';

export default {
    scan: async function (security): void {
        const decryptedSecurity: $TSFixMe = await this.decryptPassword(
            security
        );
        await this.scanContainerSecurity(decryptedSecurity);
    },

    decryptPassword: async function (security): void {
        const values: $TSFixMe = [];
        for (let i = 0; i <= 15; i++) {
            values.push(security.dockerCredential.iv[i]);
        }
        const iv: $TSFixMe = Buffer.from(values);
        security.dockerCredential.dockerPassword = await this.decrypt(
            security.dockerCredential.dockerPassword,
            iv
        );
        return security;
    },

    decrypt: (encText, iv) => {
        const promise = new Promise((resolve, reject): $TSFixMe => {
            try {
                const decipher: $TSFixMe = crypto.createDecipheriv(
                    algorithm,
                    key,
                    iv
                );
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
        const { imagePath, imageTags }: $TSFixMe = security;
        const testPath: $TSFixMe = imageTags
            ? `${imagePath}:${imageTags}`
            : imagePath;
        const outputFile: string = `${uuidv1()}result.json`;
        let securityDir = 'container_security_dir';

        securityDir = await createDir(securityDir);
        const exactFilePath: $TSFixMe = Path.resolve(securityDir, outputFile);
        // update container security to scanning true
        // so the cron job does not pull it multiple times due to network delays
        // since the cron job runs every minute
        await updateContainerSecurityToScanning(security);

        return new Promise((resolve, reject) => {
            // use trivy open source package to audit a container
            const scanCommand: string = `trivy image -f json -o ${outputFile} ${testPath}`;
            const clearCommand: string = `trivy image --clear-cache ${testPath}`;

            const output: $TSFixMe = spawn(scanCommand, {
                cwd: securityDir,
                shell: true,
            });

            output.on('error', async error => {
                const errorMessage: $TSFixMe =
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
                    const error: $TSFixMe = new BadDataException(
                        'Scanning failed please check your docker credential or image path/tag'
                    );

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

                const clearCache: $TSFixMe = spawn('trivy', [clearCommand], {
                    cwd: securityDir,
                    shell: true,
                });

                clearCache.on('error', async error => {
                    error.code = 400;
                    error.message = 'Unable to clear cache, try again later';
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
                    const auditData: $TSFixMe = {
                        vulnerabilityInfo: {},
                        vulnerabilityData: [],
                    };
                    const counter: $TSFixMe = {
                        low: 0,
                        moderate: 0,
                        high: 0,
                        critical: 0,
                    };

                    auditLogs.map(auditLog => {
                        const log: $TSFixMe = {
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

                                const vulObj: $TSFixMe = {
                                    vulnerabilityId:
                                        vulnerability.VulnerabilityID,
                                    library: vulnerability.PkgName,
                                    installedVersion:
                                        vulnerability.InstalledVersion,
                                    fixedVersions: vulnerability.FixedVersion,
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

                    const arrayData: $TSFixMe = auditData.vulnerabilityData.map(
                        log => log.vulnerabilities
                    );

                    auditData.vulnerabilityData = flattenArray(arrayData);

                    const criticalArr: $TSFixMe = [],
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

                    const securityLog: $TSFixMe =
                        await updateContainerSecurityLogService({
                            securityId: security._id,
                            componentId: security.componentId._id,
                            data: auditData,
                        });

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
    },
};

function createDir(dirPath): void {
    return new Promise((resolve, reject) => {
        const workPath: $TSFixMe = Path.resolve(process.cwd(), dirPath);
        if (fs.existsSync(workPath)) {
            resolve(workPath);
        }

        fs.mkdir(workPath, error => {
            if (error) {
                reject(error);
            }
            resolve(workPath);
        });
    });
}

function readFileContent(filePath): void {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(filePath)) {
            fs.readFile(filePath, { encoding: 'utf8' }, (error, data): void => {
                if (error) {
                    reject(error);
                }
                resolve(data);
            });
        }
    });
}

async function deleteFile(file): void {
    if (fs.existsSync(file)) {
        await unlink(file);
    }
}
