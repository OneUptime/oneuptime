import crypto from 'crypto'
import EncryptionKeys from './encryptionKeys'
const algorithm = EncryptionKeys.algorithm;
const key = EncryptionKeys.key;
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v1 as uuidv1} from 'uuid'
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
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'security' implicitly has an 'any' type.
    scan: async function(security) {
        const decryptedSecurity = await this.decryptPassword(security);
        await this.scanContainerSecurity(decryptedSecurity);
    },
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'security' implicitly has an 'any' type.
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
    scanContainerSecurity: async security => {
        try {
            const { imagePath, imageTags } = security;
            const testPath = imageTags
                ? `${imagePath}:${imageTags}`
                : imagePath;
            const outputFile = `${uuidv1()}result.json`;
            let securityDir = 'container_security_dir';
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'unknown' is not assignable to type 'string'.
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
                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
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

                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                        auditLogs.map(auditLog => {
                            const log = {
                                type: auditLog.Type,
                                vulnerabilities: [],
                            };

                            if (
                                auditLog.Vulnerabilities &&
                                auditLog.Vulnerabilities.length > 0
                            ) {
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'vulnerability' implicitly has an 'any' ... Remove this comment to see the full error message
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
                                    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ vulnerabilityId: any; library:... Remove this comment to see the full error message
                                    log.vulnerabilities.push(vulObj);

                                    return vulnerability;
                                });
                            }

                            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ type: any; vulnerabilities: ne... Remove this comment to see the full error message
                            auditData.vulnerabilityData.push(log);
                            return auditLog;
                        });

                        auditData.vulnerabilityInfo = counter;

                        const arrayData = auditData.vulnerabilityData.map(
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'vulnerabilities' does not exist on type ... Remove this comment to see the full error message
                            log => log.vulnerabilities
                        );

                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'any[]' is not assignable to type 'never[]'.
                        auditData.vulnerabilityData = flattenArray(arrayData);

                        // @ts-expect-error ts-migrate(7034) FIXME: Variable 'criticalArr' implicitly has type 'any[]'... Remove this comment to see the full error message
                        const criticalArr = [],
                            // @ts-expect-error ts-migrate(7034) FIXME: Variable 'highArr' implicitly has type 'any[]' in ... Remove this comment to see the full error message
                            highArr = [],
                            // @ts-expect-error ts-migrate(7034) FIXME: Variable 'moderateArr' implicitly has type 'any[]'... Remove this comment to see the full error message
                            moderateArr = [],
                            // @ts-expect-error ts-migrate(7034) FIXME: Variable 'lowArr' implicitly has type 'any[]' in s... Remove this comment to see the full error message
                            lowArr = [];
                        auditData.vulnerabilityData.map(vulnerability => {
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'severity' does not exist on type 'never'... Remove this comment to see the full error message
                            if (vulnerability.severity === 'critical') {
                                criticalArr.push(vulnerability);
                            }
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'severity' does not exist on type 'never'... Remove this comment to see the full error message
                            if (vulnerability.severity === 'high') {
                                highArr.push(vulnerability);
                            }
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'severity' does not exist on type 'never'... Remove this comment to see the full error message
                            if (vulnerability.severity === 'moderate') {
                                moderateArr.push(vulnerability);
                            }
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'severity' does not exist on type 'never'... Remove this comment to see the full error message
                            if (vulnerability.severity === 'low') {
                                lowArr.push(vulnerability);
                            }
                            return vulnerability;
                        });

                        // @ts-expect-error ts-migrate(2322) FIXME: Type 'any[]' is not assignable to type 'never[]'.
                        auditData.vulnerabilityData = [
                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'criticalArr' implicitly has an 'any[]' t... Remove this comment to see the full error message
                            ...criticalArr,
                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'highArr' implicitly has an 'any[]' type.
                            ...highArr,
                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'moderateArr' implicitly has an 'any[]' t... Remove this comment to see the full error message
                            ...moderateArr,
                            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'lowArr' implicitly has an 'any[]' type.
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
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'filePath' implicitly has an 'any' type.
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
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'file' implicitly has an 'any' type.
async function deleteFile(file) {
    if (fs.existsSync(file)) {
        await unlink(file);
    }
}
