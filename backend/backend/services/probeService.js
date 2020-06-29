module.exports = {
    create: async function(data) {
        try {
            const _this = this;
            let probeKey;
            if (data.probeKey) {
                probeKey = data.probeKey;
            } else {
                probeKey = uuidv1();
            }
            const storedProbe = await _this.findOneBy({
                probeName: data.probeName,
            });
            if (storedProbe && storedProbe.probeName) {
                const error = new Error('Probe name already exists.');
                error.code = 400;
                ErrorService.log('probe.create', error);
                throw error;
            } else {
                const probe = new ProbeModel();
                probe.probeKey = probeKey;
                probe.probeName = data.probeName;
                const savedProbe = await probe.save();
                return savedProbe;
            }
        } catch (error) {
            ErrorService.log('ProbeService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const probe = await ProbeModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await ProbeModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('ProbeService.updateMany', error);
            throw error;
        }
    },

    findBy: async function(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }

            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            query.deleted = false;
            const probe = await ProbeModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.findBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const probe = await ProbeModel.findOne(query);
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.findOneBy', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const count = await ProbeModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('ProbeService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;
            const probe = await ProbeModel.findOneAndUpdate(
                query,
                { $set: { deleted: true, deletedAt: Date.now() } },
                { new: true }
            );
            return probe;
        } catch (error) {
            ErrorService.log('ProbeService.deleteBy', error);
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await ProbeModel.deleteMany(query);
            return 'Probe(s) removed successfully!';
        } catch (error) {
            ErrorService.log('ProbeService.hardDeleteBy', error);
            throw error;
        }
    },

    sendProbe: async function(probeId, monitorId) {
        try {
            const probe = await this.findOneBy({ _id: probeId });
            if (probe) {
                delete probe._doc.deleted;
                await RealTimeService.updateProbe(probe, monitorId);
            }
        } catch (error) {
            ErrorService.log('ProbeService.sendProbe', error);
            throw error;
        }
    },

    saveLighthouseLog: async function(data) {
        try {
            const log = await LighthouseLogService.create(data);
            return log;
        } catch (error) {
            ErrorService.log('ProbeService.saveLighthouseScan', error);
            throw error;
        }
    },

    saveMonitorLog: async function(data) {
        try {
            const _this = this;
            const monitorStatus = await MonitorStatusService.findOneBy({
                monitorId: data.monitorId,
                probeId: data.probeId,
            });
            const lastStatus =
                monitorStatus && monitorStatus.status
                    ? monitorStatus.status
                    : null;

            let log = await MonitorLogService.create(data);

            if (!lastStatus || (lastStatus && lastStatus !== data.status)) {
                // check if monitor has a previous status
                // check if previous status is different from the current status
                // if different, resolve last incident, create a new incident and monitor status
                if (lastStatus) {
                    const monitor = await MonitorService.findOneBy({
                        _id: data.monitorId,
                    });
                    const autoAcknowledge =
                        lastStatus && lastStatus === 'degraded'
                            ? monitor.criteria.degraded.autoAcknowledge
                            : lastStatus === 'offline'
                            ? monitor.criteria.down.autoAcknowledge
                            : false;
                    const autoResolve =
                        lastStatus === 'degraded'
                            ? monitor.criteria.degraded.autoResolve
                            : lastStatus === 'offline'
                            ? monitor.criteria.down.autoResolve
                            : false;
                    await _this.incidentResolveOrAcknowledge(
                        data,
                        lastStatus,
                        autoAcknowledge,
                        autoResolve
                    );
                }

                const incidentIds = await _this.incidentCreateOrUpdate(data);
                await MonitorStatusService.create(data);

                if (incidentIds && incidentIds.length) {
                    log = await MonitorLogService.updateOneBy(
                        { _id: log._id },
                        { incidentIds }
                    );
                }
            }
            return log;
        } catch (error) {
            ErrorService.log('ProbeService.saveMonitorLog', error);
            throw error;
        }
    },

    getMonitorLog: async function(data) {
        try {
            const date = new Date();
            const log = await MonitorLogService.findOneBy({
                monitorId: data.monitorId,
                probeId: data.probeId,
                createdAt: { $lt: data.date || date },
            });
            return log;
        } catch (error) {
            ErrorService.log('probeService.getMonitorLog', error);
            throw error;
        }
    },

    incidentCreateOrUpdate: async function(data) {
        try {
            const monitor = await MonitorService.findOneBy({
                _id: data.monitorId,
            });
            const incidents = await IncidentService.findBy({
                monitorId: data.monitorId,
                incidentType: data.status,
                resolved: false,
            });
            let incidentIds = [];

            if (
                data.status === 'online' &&
                monitor &&
                monitor.criteria &&
                monitor.criteria.up &&
                monitor.criteria.up.createAlert
            ) {
                if (incidents && incidents.length) {
                    incidentIds = incidents.map(async incident => {
                        const newIncident = await IncidentService.updateOneBy(
                            {
                                _id: incident._id,
                            },
                            {
                                probes: incident.probes.concat({
                                    probeId: data.probeId,
                                    updatedAt: Date.now(),
                                    status: true,
                                    reportedStatus: data.status,
                                }),
                            }
                        );

                        await IncidentTimelineService.create({
                            incidentId: incident._id,
                            probeId: data.probeId,
                            status: data.status,
                        });

                        return newIncident;
                    });
                } else {
                    incidentIds = await [
                        IncidentService.create({
                            projectId: monitor.projectId,
                            monitorId: data.monitorId,
                            createdById: null,
                            incidentType: 'online',
                            probeId: data.probeId,
                        }),
                    ];
                }
            } else if (
                data.status === 'degraded' &&
                monitor &&
                monitor.criteria &&
                monitor.criteria.degraded &&
                monitor.criteria.degraded.createAlert
            ) {
                if (incidents && incidents.length) {
                    incidentIds = incidents.map(async incident => {
                        const newIncident = await IncidentService.updateOneBy(
                            {
                                _id: incident._id,
                            },
                            {
                                probes: incident.probes.concat({
                                    probeId: data.probeId,
                                    updatedAt: Date.now(),
                                    status: true,
                                    reportedStatus: data.status,
                                }),
                            }
                        );

                        await IncidentTimelineService.create({
                            incidentId: incident._id,
                            probeId: data.probeId,
                            status: data.status,
                        });

                        return newIncident;
                    });
                } else {
                    incidentIds = await [
                        IncidentService.create({
                            projectId: monitor.projectId,
                            monitorId: data.monitorId,
                            createdById: null,
                            incidentType: 'degraded',
                            probeId: data.probeId,
                        }),
                    ];
                }
            } else if (
                data.status === 'offline' &&
                monitor &&
                monitor.criteria &&
                monitor.criteria.down &&
                monitor.criteria.down.createAlert
            ) {
                if (incidents && incidents.length) {
                    incidentIds = incidents.map(async incident => {
                        const newIncident = await IncidentService.updateOneBy(
                            {
                                _id: incident._id,
                            },
                            {
                                probes: incident.probes.concat({
                                    probeId: data.probeId,
                                    updatedAt: Date.now(),
                                    status: true,
                                    reportedStatus: data.status,
                                }),
                            }
                        );

                        await IncidentTimelineService.create({
                            incidentId: incident._id,
                            probeId: data.probeId,
                            status: data.status,
                        });

                        return newIncident;
                    });
                } else {
                    incidentIds = await [
                        IncidentService.create({
                            projectId: monitor.projectId,
                            monitorId: data.monitorId,
                            createdById: null,
                            incidentType: 'offline',
                            probeId: data.probeId,
                        }),
                    ];
                }
            }
            incidentIds = await Promise.all(incidentIds);
            incidentIds = incidentIds.map(i => i._id);
            return incidentIds;
        } catch (error) {
            ErrorService.log('ProbeService.incidentCreateOrUpdate', error);
            throw error;
        }
    },

    incidentResolveOrAcknowledge: async function(
        data,
        lastStatus,
        autoAcknowledge,
        autoResolve
    ) {
        try {
            const incidents = await IncidentService.findBy({
                monitorId: data.monitorId,
                incidentType: lastStatus,
                resolved: false,
            });
            const incidentsV1 = [];
            const incidentsV2 = [];
            if (incidents && incidents.length) {
                if (lastStatus && lastStatus !== data.status) {
                    incidents.forEach(incident => {
                        incident.probes.some(probe => {
                            if (
                                String(probe.probeId._id) ===
                                String(data.probeId)
                            ) {
                                incidentsV1.push(incident);
                                return true;
                            } else return false;
                        });
                    });
                }
            }
            await Promise.all(
                incidentsV1.map(async incident => {
                    const newIncident = await IncidentService.updateOneBy(
                        {
                            _id: incident._id,
                        },
                        {
                            probes: incident.probes.concat([
                                {
                                    probeId: data.probeId,
                                    updatedAt: Date.now(),
                                    status: false,
                                    reportedStatus: data.status,
                                },
                            ]),
                        }
                    );
                    incidentsV2.push(newIncident);

                    await IncidentTimelineService.create({
                        incidentId: incident._id,
                        probeId: data.probeId,
                        status: data.status,
                    });

                    return newIncident;
                })
            );

            incidentsV2.forEach(async incident => {
                const trueArray = [];
                const falseArray = [];
                incident.probes.forEach(probe => {
                    if (probe.status) {
                        trueArray.push(probe);
                    } else {
                        falseArray.push(probe);
                    }
                });
                if (trueArray.length === falseArray.length) {
                    if (autoAcknowledge) {
                        if (!incident.acknowledged) {
                            await IncidentService.acknowledge(
                                incident._id,
                                null,
                                'fyipe',
                                data.probeId
                            );
                        }
                    }
                    if (autoResolve) {
                        await IncidentService.resolve(
                            incident._id,
                            null,
                            'fyipe',
                            data.probeId
                        );
                    }
                }
            });
            return {};
        } catch (error) {
            ErrorService.log(
                'ProbeService.incidentResolveOrAcknowledge',
                error
            );
            throw error;
        }
    },

    updateProbeStatus: async function(probeId) {
        try {
            const probe = await ProbeModel.findOneAndUpdate(
                { _id: probeId },
                { $set: { lastAlive: Date.now() } },
                { new: true }
            );
            return probe;
        } catch (error) {
            ErrorService.log('probeService.updateProbeStatus', error);
            throw error;
        }
    },

    conditions: async (payload, resp, con) => {
        let stat = true;
        const status = resp
            ? resp.status
                ? resp.status
                : resp.statusCode
                ? resp.statusCode
                : null
            : null;
        const body = resp && resp.body ? resp.body : null;
        const sslCertificate =
            resp && resp.sslCertificate ? resp.sslCertificate : null;

        if (con && con.and && con.and.length) {
            stat = await checkAnd(
                payload,
                con.and,
                status,
                body,
                sslCertificate
            );
        } else if (con && con.or && con.or.length) {
            stat = await checkOr(payload, con.or, status, body, sslCertificate);
        }
        return stat;
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

            // update application security to scanned true
            // to prevent pulling an applicaiton security multiple times by running cron job
            // due to network delay
            await ApplicationSecurityService.updateOneBy(
                {
                    _id: security._id,
                },
                { scanned: true }
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

                                deleteFolderRecursive(securityDir);
                                return resolve(securityLog);
                            });
                        });
                    })
                    .catch(async error => {
                        await ApplicationSecurityService.updateOneBy(
                            {
                                _id: security._id,
                            },
                            { scanned: false }
                        );
                        deleteFolderRecursive(securityDir);
                        ErrorService.log(
                            'probeService.scanApplicationSecurity',
                            error
                        );
                        error.code = 400;
                        error.message =
                            'Authentication failed please check your git credentials or git repository url';
                        return reject(error);
                    });
            });
        } catch (error) {
            ErrorService.log('probeService.scanApplicationSecurity', error);
            throw error;
        }
    },

    scanContainerSecurity: async security => {
        try {
            const { imagePath, imageTags, dockerCredential } = security;
            const testPath = imageTags
                ? `${imagePath}:${imageTags}`
                : imagePath;
            const outputFile = `${uuidv1()}results.json`;
            let securityDir = 'container_security_dir';
            securityDir = await createDir(securityDir);
            // update container security to scanned true
            // so the cron job does not pull it multiple times due to network delays
            // since the cron job runs every minute
            await ContainerSecurityService.updateOneBy(
                {
                    _id: security._id,
                },
                { scanned: true }
            );
            return new Promise((resolve, reject) => {
                // use trivy open source package to audit a container
                const scanCommand = `-q image -f json ${testPath}`;
                const clearCommand = `image --clear-cache ${testPath}`;

                const output = spawn('trivy', [scanCommand], {
                    cwd: securityDir,
                    env: {
                        TRIVY_AUTH_URL: dockerCredential.dockerRegistryUrl,
                        TRIVY_USERNAME: dockerCredential.dockerUsername,
                        TRIVY_PASSWORD: dockerCredential.dockerPassword,
                    },
                    shell: true,
                });

                output.on('error', async error => {
                    error.code = 400;
                    error.message =
                        'Scanning failed please check your docker credential or image path/tag';
                    await ContainerSecurityService.updateOneBy(
                        {
                            _id: security._id,
                        },
                        { scanned: false }
                    );
                    deleteFolderRecursive(securityDir);
                    return reject(error);
                });

                let auditLogs = '';
                output.stdout.on('data', data => {
                    auditLogs += data.toString();
                });

                output.on('close', async () => {
                    const clearCache = spawn('trivy', [clearCommand], {
                        cwd: securityDir,
                        shell: true,
                    });

                    clearCache.on('error', async error => {
                        error.code = 400;
                        error.message =
                            'Unable to clear cache, try again later';
                        await ContainerSecurityService.updateOneBy(
                            {
                                _id: security._id,
                            },
                            { scanned: false }
                        );
                        deleteFolderRecursive(securityDir);
                        return reject(error);
                    });

                    clearCache.on('close', async () => {
                        // const filePath = Path.resolve(securityDir, outputFile);
                        // let auditLogs = await readFileContent(filePath);
                        console.log('****audit logs*****', auditLogs);
                        if (typeof auditLogs === 'string') {
                            auditLogs = JSON.parse(auditLogs); // parse the stringified logs
                        }

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
                                    fixedVersions: vulnerability.FixedVersion,
                                    title: vulnerability.Title,
                                    description: vulnerability.Description,
                                    severity,
                                };
                                log.vulnerabilities.push(vulObj);

                                return vulnerability;
                            });

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

                        const securityLog = await ContainerSecurityLogService.create(
                            {
                                securityId: security._id,
                                componentId: security.componentId._id,
                                data: auditData,
                            }
                        );

                        await ContainerSecurityService.updateScanTime({
                            _id: security._id,
                        });

                        deleteFolderRecursive(securityDir);
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

const _ = require('lodash');

const checkAnd = async (payload, con, statusCode, body, ssl) => {
    let validity = true;
    for (let i = 0; i < con.length; i++) {
        if (
            con[i] &&
            con[i].responseType &&
            con[i].responseType === 'responseTime'
        ) {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        payload > con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        payload < con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        con[i].field2 &&
                        payload > con[i].field1 &&
                        payload < con[i].field2
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        payload == con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        payload != con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        payload >= con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload &&
                        payload <= con[i].field1
                    )
                ) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'doesRespond') {
            if (con[i] && con[i].filter && con[i].filter === 'isUp') {
                if (!(con[i] && con[i].filter && payload)) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'isDown') {
                if (!(con[i] && con[i].filter && !payload)) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'ssl') {
            const expiresIn = moment(
                new Date(
                    ssl && ssl.expires ? ssl.expires : Date.now()
                ).getTime()
            ).diff(Date.now(), 'days');
            if (con[i] && con[i].filter && con[i].filter === 'isValid') {
                if (!(ssl && !ssl.selfSigned)) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notFound'
            ) {
                if (ssl) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'selfSigned'
            ) {
                if (!(ssl && ssl.selfSigned)) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'expiresIn30'
            ) {
                if (!(ssl && !ssl.selfSigned && expiresIn < 30)) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'expiresIn10'
            ) {
                if (!(ssl && !ssl.selfSigned && expiresIn < 10)) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'statusCode') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        statusCode > con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        statusCode < con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        con[i].field2 &&
                        statusCode > con[i].field1 &&
                        statusCode < con[i].field2
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        statusCode == con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        statusCode != con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        statusCode >= con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        statusCode &&
                        statusCode <= con[i].field1
                    )
                ) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'cpuLoad') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        payload.cpuLoad > con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        payload.cpuLoad < con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        con[i].field2 &&
                        payload.cpuLoad > con[i].field1 &&
                        payload.cpuLoad < con[i].field2
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        payload.cpuLoad == con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        payload.cpuLoad != con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        payload.cpuLoad >= con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.cpuLoad &&
                        payload.cpuLoad <= con[i].field1
                    )
                ) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'memoryUsage') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        payload.memoryUsed > con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        payload.memoryUsed < con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        con[i].field2 &&
                        payload.memoryUsed > con[i].field1 &&
                        payload.memoryUsed < con[i].field2
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        payload.memoryUsed == con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        payload.memoryUsed != con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        payload.memoryUsed >= con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.memoryUsed &&
                        payload.memoryUsed <= con[i].field1
                    )
                ) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'storageUsage') {
            const size = parseInt(payload.totalStorage || 0);
            const used = parseInt(payload.storageUsed || 0);
            const free = (size - used) / Math.pow(1e3, 3);
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (!(con[i] && con[i].field1 && free > con[i].field1)) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (!(con[i] && con[i].field1 && free < con[i].field1)) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        con[i].field2 &&
                        free > con[i].field1 &&
                        free < con[i].field2
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (!(con[i] && con[i].field1 && free === con[i].field1)) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (!(con[i] && con[i].field1 && free !== con[i].field1)) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (!(con[i] && con[i].field1 && free >= con[i].field1)) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (!(con[i] && con[i].field1 && free <= con[i].field1)) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'temperature') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        payload.mainTemp > con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        payload.mainTemp < con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        con[i].field2 &&
                        payload.mainTemp > con[i].field1 &&
                        payload.mainTemp < con[i].field2
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        payload.mainTemp == con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        payload.mainTemp != con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        payload.mainTemp >= con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        payload.mainTemp &&
                        payload.mainTemp <= con[i].field1
                    )
                ) {
                    validity = false;
                }
            }
        } else if (con[i] && con[i].responseType === 'responseBody') {
            if (con[i] && con[i].filter && con[i].filter === 'contains') {
                if (!(con[i] && con[i].field1 && body && body[con[i].field1])) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'doesNotContain'
            ) {
                if (
                    !(con[i] && con[i].field1 && body && !body[con[i].field1])
                ) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'jsExpression'
            ) {
                if (
                    !(
                        con[i] &&
                        con[i].field1 &&
                        body &&
                        body[con[i].field1] === con[i].field1
                    )
                ) {
                    validity = false;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'empty') {
                if (!(con[i] && con[i].filter && body && _.isEmpty(body))) {
                    validity = false;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEmpty'
            ) {
                if (!(con[i] && con[i].filter && body && !_.isEmpty(body))) {
                    validity = false;
                }
            }
        }
        if (
            con[i] &&
            con[i].collection &&
            con[i].collection.and &&
            con[i].collection.and.length
        ) {
            const temp = await checkAnd(
                payload,
                con[i].collection.and,
                statusCode,
                body
            );
            if (!temp) {
                validity = temp;
            }
        } else if (
            con[i] &&
            con[i].collection &&
            con[i].collection.or &&
            con[i].collection.or.length
        ) {
            const temp1 = await checkOr(
                payload,
                con[i].collection.or,
                statusCode,
                body
            );
            if (!temp1) {
                validity = temp1;
            }
        }
    }
    return validity;
};
const checkOr = async (payload, con, statusCode, body, ssl) => {
    let validity = false;
    for (let i = 0; i < con.length; i++) {
        if (con[i] && con[i].responseType === 'responseTime') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    payload > con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    payload < con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    con[i].field2 &&
                    payload > con[i].field1 &&
                    payload < con[i].field2
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    payload == con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    payload != con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    payload >= con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload &&
                    payload <= con[i].field1
                ) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'doesRespond') {
            if (con[i] && con[i].filter && con[i].filter === 'isUp') {
                if (con[i] && con[i].filter && payload) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'isDown') {
                if (con[i] && con[i].filter && !payload) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'ssl') {
            const expiresIn = moment(
                new Date(
                    ssl && ssl.expires ? ssl.expires : Date.now()
                ).getTime()
            ).diff(Date.now(), 'days');
            if (con[i] && con[i].filter && con[i].filter === 'isValid') {
                if (ssl && !ssl.selfSigned) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notFound'
            ) {
                if (!ssl) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'selfSigned'
            ) {
                if (ssl && ssl.selfSigned) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'expiresIn30'
            ) {
                if (ssl && !ssl.selfSigned && expiresIn < 30) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'expiresIn10'
            ) {
                if (ssl && !ssl.selfSigned && expiresIn < 10) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'statusCode') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    statusCode > con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    statusCode < con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    con[i].field2 &&
                    statusCode > con[i].field1 &&
                    statusCode < con[i].field2
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    statusCode == con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    statusCode != con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    statusCode >= con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    statusCode &&
                    statusCode <= con[i].field1
                ) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'cpuLoad') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    payload.cpuLoad > con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    payload.cpuLoad < con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    con[i].field2 &&
                    payload.cpuLoad > con[i].field1 &&
                    payload.cpuLoad < con[i].field2
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    payload.cpuLoad == con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    payload.cpuLoad != con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    payload.cpuLoad >= con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.cpuLoad &&
                    payload.cpuLoad <= con[i].field1
                ) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'memoryUsage') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    payload.memoryUsed > con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    payload.memoryUsed < con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    con[i].field2 &&
                    payload.memoryUsed > con[i].field1 &&
                    payload.memoryUsed < con[i].field2
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    payload.memoryUsed == con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    payload.memoryUsed != con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    payload.memoryUsed >= con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.memoryUsed &&
                    payload.memoryUsed <= con[i].field1
                ) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'storageUsage') {
            const size = parseInt(payload.totalStorage || 0);
            const used = parseInt(payload.storageUsed || 0);
            const free = (size - used) / Math.pow(1e3, 3);
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (con[i] && con[i].field1 && free > con[i].field1) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (con[i] && con[i].field1 && free < con[i].field1) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    con[i].field2 &&
                    free > con[i].field1 &&
                    free < con[i].field2
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (con[i] && con[i].field1 && free === con[i].field1) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (con[i] && con[i].field1 && free !== con[i].field1) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (con[i] && con[i].field1 && free >= con[i].field1) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (con[i] && con[i].field1 && free <= con[i].field1) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'temperature') {
            if (con[i] && con[i].filter && con[i].filter === 'greaterThan') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    payload.mainTemp > con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'lessThan'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    payload.mainTemp < con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'inBetween'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    con[i].field2 &&
                    payload.mainTemp > con[i].field1 &&
                    payload.mainTemp < con[i].field2
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'equalTo') {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    payload.mainTemp == con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    payload.mainTemp != con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'gtEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    payload.mainTemp >= con[i].field1
                ) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'ltEqualTo'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    payload.mainTemp &&
                    payload.mainTemp <= con[i].field1
                ) {
                    validity = true;
                }
            }
        } else if (con[i] && con[i].responseType === 'responseBody') {
            if (con[i] && con[i].filter && con[i].filter === 'contains') {
                if (con[i] && con[i].field1 && body && body[con[i].field1]) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'doesNotContain'
            ) {
                if (con[i] && con[i].field1 && body && !body[con[i].field1]) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'jsExpression'
            ) {
                if (
                    con[i] &&
                    con[i].field1 &&
                    body &&
                    body[con[i].field1] === con[i].field1
                ) {
                    validity = true;
                }
            } else if (con[i] && con[i].filter && con[i].filter === 'empty') {
                if (con[i] && con[i].filter && body && _.isEmpty(body)) {
                    validity = true;
                }
            } else if (
                con[i] &&
                con[i].filter &&
                con[i].filter === 'notEmpty'
            ) {
                if (con[i] && con[i].filter && body && !_.isEmpty(body)) {
                    validity = true;
                }
            }
        }
        if (
            con[i] &&
            con[i].collection &&
            con[i].collection.and &&
            con[i].collection.and.length
        ) {
            const temp = await checkAnd(
                payload,
                con[i].collection.and,
                statusCode,
                body
            );
            if (temp) {
                validity = temp;
            }
        } else if (
            con[i] &&
            con[i].collection &&
            con[i].collection.or &&
            con[i].collection.or.length
        ) {
            const temp1 = await checkOr(
                payload,
                con[i].collection.or,
                statusCode,
                body
            );
            if (temp1) {
                validity = temp1;
            }
        }
    }
    return validity;
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

function deleteFolderRecursive(path) {
    if (fs.existsSync(path)) {
        fs.readdirSync(path).forEach(file => {
            const curPath = Path.join(path, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                // recurse
                deleteFolderRecursive(curPath);
            } else {
                // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
}

function readFileContent(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, { encoding: 'utf8' }, function(error, data) {
            if (error) {
                reject(error);
            }
            resolve(data);
        });
    });
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

const ProbeModel = require('../models/probe');
const RealTimeService = require('./realTimeService');
const ErrorService = require('./errorService');
const uuidv1 = require('uuid/v1');
const MonitorService = require('./monitorService');
const MonitorStatusService = require('./monitorStatusService');
const MonitorLogService = require('./monitorLogService');
const LighthouseLogService = require('./lighthouseLogService');
const IncidentService = require('./incidentService');
const IncidentTimelineService = require('./incidentTimelineService');
const moment = require('moment');
const git = require('simple-git/promise');
const fs = require('fs');
const { spawn } = require('child_process');
const Path = require('path');
const ApplicationSecurityLogService = require('./applicationSecurityLogService');
const ApplicationSecurityService = require('./applicationSecurityService');
const ContainerSecurityService = require('./containerSecurityService');
const ContainerSecurityLogService = require('./containerSecurityLogService');
const flattenArray = require('../utils/flattenArray');
