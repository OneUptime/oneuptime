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
                probe.version = data.probeVersion;
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
            const probe = await ProbeModel.findOne(query, { deleted: false });
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

    createMonitorDisabledStatus: async function(data) {
        try {
            let monitorStatus = await MonitorStatusService.findOneBy({
                monitorId: data.monitorId,
            });
            const lastStatus =
                monitorStatus && monitorStatus.status
                    ? monitorStatus.status
                    : null;

            if (!lastStatus || (lastStatus && lastStatus !== data.status)) {
                data.lastStatus = lastStatus ? lastStatus : null;
                monitorStatus = await MonitorStatusService.create(data);
            }
            return monitorStatus;
        } catch (error) {
            ErrorService.log('ProbeService.createMonitorDisabledStatus', error);
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
            if (!data.stopPingTimeUpdate) {
                await MonitorService.updateMonitorPingTime(data.monitorId);
            }

            if (!lastStatus || (lastStatus && lastStatus !== data.status)) {
                // check if monitor has a previous status
                // check if previous status is different from the current status
                // if different, resolve last incident, create a new incident and monitor status
                if (lastStatus) {
                    // check 3 times just to make sure
                    if (data.retryCount >= 0 && data.retryCount < 3)
                        return { retry: true, retryCount: data.retryCount };

                    // grab all the criteria in a monitor
                    const allCriteria = [];
                    if (data.matchedUpCriterion) {
                        data.matchedUpCriterion.forEach(criteria =>
                            allCriteria.push(criteria)
                        );
                    }
                    if (data.matchedDownCriterion) {
                        data.matchedDownCriterion.forEach(criteria =>
                            allCriteria.push(criteria)
                        );
                    }
                    if (data.matchedDegradedCriterion) {
                        data.matchedDegradedCriterion.forEach(criteria =>
                            allCriteria.push(criteria)
                        );
                    }

                    await _this.incidentResolveOrAcknowledge(
                        data,
                        lastStatus,
                        allCriteria
                    );
                }

                const incidentIdsOrRetry = await _this.incidentCreateOrUpdate(
                    data
                );
                if (incidentIdsOrRetry.retry) return incidentIdsOrRetry;

                if (
                    Array.isArray(incidentIdsOrRetry) &&
                    incidentIdsOrRetry.length
                ) {
                    data.incidentId = incidentIdsOrRetry[0];
                }

                await MonitorStatusService.create(data);

                if (incidentIdsOrRetry && incidentIdsOrRetry.length) {
                    log = await MonitorLogService.updateOneBy(
                        { _id: log._id },
                        { incidentIds: incidentIdsOrRetry }
                    );
                }
            } else {
                const incidents = await IncidentService.findBy({
                    monitorId: data.monitorId,
                    incidentType: data.status,
                    resolved: false,
                });

                const incidentIds = incidents.map(incident => incident._id);

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
                manuallyCreated: false,
            });
            const { matchedCriterion } = data;
            let incidentIds = [];

            if (
                data.status === 'online' &&
                monitor &&
                matchedCriterion &&
                matchedCriterion.createAlert
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
                    if (data.retryCount >= 0 && data.retryCount < 3)
                        return { retry: true, retryCount: data.retryCount };
                    incidentIds = [
                        IncidentService.create({
                            projectId: monitor.projectId,
                            monitorId: data.monitorId,
                            createdById: null,
                            incidentType: 'online',
                            probeId: data.probeId,
                            reason: data.reason,
                            response: data.response,
                            ...(matchedCriterion && {
                                matchedCriterion,
                            }),
                        }),
                    ];
                }
            } else if (
                data.status === 'degraded' &&
                monitor &&
                matchedCriterion &&
                matchedCriterion.createAlert
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
                    if (data.retryCount >= 0 && data.retryCount < 3)
                        return { retry: true, retryCount: data.retryCount };
                    incidentIds = [
                        IncidentService.create({
                            projectId: monitor.projectId,
                            monitorId: data.monitorId,
                            createdById: null,
                            incidentType: 'degraded',
                            probeId: data.probeId,
                            reason: data.reason,
                            response: data.response,
                            ...(matchedCriterion && {
                                matchedCriterion,
                            }),
                        }),
                    ];
                }
            } else if (
                data.status === 'offline' &&
                monitor &&
                matchedCriterion &&
                matchedCriterion.createAlert
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
                    if (data.retryCount >= 0 && data.retryCount < 3)
                        return { retry: true, retryCount: data.retryCount };
                    incidentIds = [
                        IncidentService.create({
                            projectId: monitor.projectId,
                            monitorId: data.monitorId,
                            createdById: null,
                            incidentType: 'offline',
                            probeId: data.probeId,
                            reason: data.reason,
                            response: data.response,
                            ...(matchedCriterion && {
                                matchedCriterion,
                            }),
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
        allCriteria
    ) {
        try {
            const incidents = await IncidentService.findBy({
                monitorId: data.monitorId,
                incidentType: lastStatus,
                resolved: false,
                manuallyCreated: false,
            });
            // should grab all the criterion for the monitor and put them into one array
            // check the id of each criteria against the id of criteria attached to an incident
            // ack / resolve according to the criteria
            let autoAcknowledge, autoResolve;
            if (incidents && incidents.length > 0) {
                incidents.forEach(incident => {
                    const criteriaId = String(incident.criterionCause._id);
                    allCriteria.forEach(criteria => {
                        if (
                            String(criteria._id) === criteriaId ||
                            criteria.name === incident.criterionCause.name
                        ) {
                            autoAcknowledge = criteria.autoAcknowledge;
                            autoResolve = criteria.autoResolve;
                        }
                    });
                });
            }
            const incidentsV1 = [];
            const incidentsV2 = [];

            if (incidents && incidents.length) {
                if (lastStatus && lastStatus !== data.status) {
                    incidents.forEach(incident => {
                        if (incident.probes && incident.probes.length > 0) {
                            incident.probes.some(probe => {
                                if (
                                    probe.probeId &&
                                    String(probe.probeId._id) ===
                                        String(data.probeId)
                                ) {
                                    incidentsV1.push(incident);
                                    return true;
                                } else return false;
                            });
                        } else {
                            incidentsV1.push(incident);
                            return true;
                        }
                    });
                }
            }
            await Promise.all(
                incidentsV1.map(async incident => {
                    if (incident.probes && incident.probes.length > 0) {
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
                    } else {
                        incidentsV2.push(incident);

                        return incident;
                    }
                })
            );

            await forEach(incidentsV2, async incident => {
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

    scriptConditions: (payload, resp, con) => {
        const status = resp
            ? resp.status
                ? resp.status
                : resp.statusCode
                ? resp.statusCode
                : null
            : null;
        const body = resp && resp.body ? resp.body : null;
        const successReasons = [];
        const failedReasons = [];

        let eventOccurred = false;
        let matchedCriterion;
        if (con && con.length) {
            eventOccurred = con.some(condition => {
                let stat = true;
                if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'and'
                ) {
                    stat = checkScriptAnd(
                        payload,
                        condition.criteria,
                        status,
                        body,
                        successReasons,
                        failedReasons
                    );
                } else if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'or'
                ) {
                    stat = checkScriptOr(
                        payload,
                        condition.criteria,
                        status,
                        body,
                        successReasons,
                        failedReasons
                    );
                }
                if (stat) {
                    matchedCriterion = condition;
                    return true;
                }

                return false;
            });
        }

        return {
            stat: eventOccurred,
            successReasons,
            failedReasons,
            matchedCriterion,
        };
    },

    conditions: async (monitorType, con, payload, resp, response) => {
        const status = resp
            ? resp.status
                ? resp.status
                : resp.statusCode
                ? resp.statusCode
                : null
            : null;
        const body = resp && resp.body ? resp.body : null;
        const queryParams = resp && resp.queryParams ? resp.queryParams : null;
        const headers = resp && resp.headers ? resp.headers : null;
        const sslCertificate =
            resp && resp.sslCertificate ? resp.sslCertificate : null;
        const successReasons = [];
        const failedReasons = [];

        let eventOccurred = false;
        let matchedCriterion;

        if (con && con.length) {
            eventOccurred = await some(con, async condition => {
                let stat = true;
                if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'and'
                ) {
                    stat = await checkAnd(
                        payload,
                        condition.criteria,
                        status,
                        body,
                        sslCertificate,
                        response,
                        successReasons,
                        failedReasons,
                        monitorType,
                        queryParams,
                        headers
                    );
                } else if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'or'
                ) {
                    stat = await checkOr(
                        payload,
                        condition.criteria,
                        status,
                        body,
                        sslCertificate,
                        response,
                        successReasons,
                        failedReasons,
                        monitorType,
                        queryParams,
                        headers
                    );
                }
                if (stat) {
                    matchedCriterion = condition;
                    return true;
                }

                return false;
            });
        }

        return {
            stat: eventOccurred,
            successReasons,
            failedReasons,
            matchedCriterion,
        };
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
            const outputFile = `${uuidv1()}result.json`;
            let securityDir = 'container_security_dir';
            securityDir = await createDir(securityDir);
            const exactFilePath = Path.resolve(securityDir, outputFile);
            // update container security to scanning true
            // so the cron job does not pull it multiple times due to network delays
            // since the cron job runs every minute
            const containerSecurity = await ContainerSecurityService.updateOneBy(
                {
                    _id: security._id,
                },
                { scanning: true }
            );
            global.io.emit(
                `security_${containerSecurity._id}`,
                containerSecurity
            );
            return new Promise((resolve, reject) => {
                // use trivy open source package to audit a container
                const scanCommand = `trivy image -f json -o ${outputFile} ${testPath}`;
                const clearCommand = `trivy image --clear-cache ${testPath}`;

                const output = spawn(scanCommand, {
                    cwd: securityDir,
                    env: {
                        TRIVY_AUTH_URL: dockerCredential.dockerRegistryUrl,
                        TRIVY_USERNAME: dockerCredential.dockerUsername,
                        TRIVY_PASSWORD: dockerCredential.dockerPassword,
                    },
                    shell: true,
                });

                output.on('error', async error => {
                    const errorMessage =
                        'Scanning failed please check your docker credential or image path/tag';
                    error.code = 400;
                    error.message = errorMessage;
                    await ContainerSecurityService.updateScanTime({
                        _id: security._id,
                    });
                    await deleteFile(exactFilePath);
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
                        await ContainerSecurityService.updateScanTime({
                            _id: security._id,
                        });
                        await deleteFile(exactFilePath);
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
                        await ContainerSecurityService.updateOneBy(
                            {
                                _id: security._id,
                            },
                            { scanning: false }
                        );
                        await deleteFile(exactFilePath);
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

                        await deleteFile(exactFilePath);
                        resolve(securityLog);
                    });
                });
            });
        } catch (error) {
            ErrorService.log('probeService.scanContainerSecurity', error);
            throw error;
        }
    },

    incomingCondition: async (payload, conditions) => {
        let eventOccurred = false;
        let matchedCriterion;
        if (conditions && conditions.length) {
            eventOccurred = await some(conditions, async condition => {
                let response = false;
                let respAnd = false,
                    respOr = false,
                    countAnd = 0,
                    countOr = 0;

                if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'and'
                ) {
                    respAnd = await incomingCheckAnd(
                        payload,
                        condition.criteria
                    );
                    countAnd++;
                }
                if (
                    condition &&
                    condition.criteria &&
                    condition.criteria.condition &&
                    condition.criteria.condition === 'or'
                ) {
                    respOr = await incomingCheckOr(payload, condition.criteria);
                    countOr++;
                }
                if (countAnd > 0 && countOr > 0) {
                    if (respAnd && respOr) {
                        response = true;
                    }
                } else if (countAnd > 0 && countOr <= 0) {
                    if (respAnd) {
                        response = true;
                    }
                } else if (countOr > 0 && countAnd <= 0) {
                    if (respOr) {
                        response = true;
                    }
                }
                if (response) {
                    matchedCriterion = condition;
                    return true;
                }

                return false;
            });
        }
        return { eventOccurred, matchedCriterion };
    },

    toArray: function(params) {
        const array = [];
        if (Object.keys(params).length > 0) {
            for (const [key, value] of Object.entries(params)) {
                array.push(key.toLowerCase() + '=' + value.toLowerCase());
            }
            return array;
        }
        return null;
    },

    processHttpRequest: async function(data) {
        try {
            const _this = this;
            const { monitor, body } = data;
            let { queryParams, headers } = data;
            queryParams = _this.toArray(queryParams);
            headers = _this.toArray(headers);
            let status, reason;
            let matchedCriterion;
            const lastPingTime = monitor.lastPingTime;
            const payload = moment().diff(moment(lastPingTime), 'minutes');
            const {
                stat: validUp,
                successReasons: upSuccessReasons,
                failedReasons: upFailedReasons,
                matchedCriterion: matchedUpCriterion,
            } = await (monitor && monitor.criteria && monitor.criteria.up
                ? _this.conditions(monitor.type, monitor.criteria.up, payload, {
                      body,
                      queryParams,
                      headers,
                  })
                : { stat: false, successReasons: [], failedReasons: [] });
            const {
                stat: validDegraded,
                successReasons: degradedSuccessReasons,
                failedReasons: degradedFailedReasons,
                matchedCriterion: matchedDegradedCriterion,
            } = await (monitor && monitor.criteria && monitor.criteria.degraded
                ? _this.conditions(
                      monitor.type,
                      monitor.criteria.degraded,
                      payload,
                      {
                          body,
                          queryParams,
                          headers,
                      }
                  )
                : { stat: false, successReasons: [], failedReasons: [] });
            const {
                stat: validDown,
                successReasons: downSuccessReasons,
                failedReasons: downFailedReasons,
                matchedCriterion: matchedDownCriterion,
            } = await (monitor && monitor.criteria && monitor.criteria.down
                ? _this.conditions(
                      monitor.type,
                      monitor.criteria.down,
                      payload,
                      {
                          body,
                          queryParams,
                          headers,
                      }
                  )
                : { stat: false, successReasons: [], failedReasons: [] });

            if (validUp) {
                status = 'online';
                reason = upSuccessReasons;
                matchedCriterion = matchedUpCriterion;
            } else if (validDegraded) {
                status = 'degraded';
                reason = [...degradedSuccessReasons, ...upFailedReasons];
                matchedCriterion = matchedDegradedCriterion;
            } else if (validDown) {
                status = 'offline';
                reason = [
                    ...downSuccessReasons,
                    ...degradedFailedReasons,
                    ...upFailedReasons,
                ];
                matchedCriterion = matchedDownCriterion;
            } else {
                status = 'offline';
                reason = [
                    ...downFailedReasons,
                    ...degradedFailedReasons,
                    ...upFailedReasons,
                ];
                if (monitor.criteria.down) {
                    matchedCriterion = monitor.criteria.down.find(
                        criterion => criterion.default === true
                    );
                }
            }
            const index = reason.indexOf('Request Timed out');
            if (index > -1) {
                reason = reason.filter(
                    item => !item.includes('Response Time is')
                );
            }
            reason = reason.filter(
                (item, pos, self) => self.indexOf(item) === pos
            );
            const logData = body;
            logData.responseTime = 0;
            logData.responseStatus = null;
            logData.status = status;
            logData.probeId = null;
            logData.monitorId = monitor && monitor.id ? monitor.id : null;
            logData.sslCertificate = null;
            logData.lighthouseScanStatus = null;
            logData.performance = null;
            logData.accessibility = null;
            logData.bestPractices = null;
            logData.seo = null;
            logData.pwa = null;
            logData.lighthouseData = null;
            logData.retryCount = 3;
            logData.reason = reason;
            logData.response = null;
            logData.matchedCriterion = matchedCriterion;
            // update monitor to save the last matched criterion
            await MonitorService.updateOneBy(
                {
                    _id: monitor._id,
                },
                {
                    lastMatchedCriterion: matchedCriterion,
                }
            );
            const log = await _this.saveMonitorLog(logData);
            await MonitorService.updateMonitorPingTime(monitor._id);
            return log;
        } catch (error) {
            ErrorService.log('monitorService.processHttpRequest', error);
            throw error;
        }
    },

    probeHttpRequest: async function(monitor, probeId) {
        try {
            const _this = this;
            let status, reason;
            let matchedCriterion;
            const lastPingTime = monitor.lastPingTime;
            const payload = moment().diff(moment(lastPingTime), 'minutes');

            const {
                eventOccurred: validUp,
                matchedCriterion: matchedUpCriterion,
            } = await (monitor && monitor.criteria && monitor.criteria.up
                ? _this.incomingCondition(payload, monitor.criteria.up)
                : false);

            const {
                eventOccurred: validDegraded,
                matchedCriterion: matchedDegradedCriterion,
            } = await (monitor && monitor.criteria && monitor.criteria.degraded
                ? _this.incomingCondition(payload, monitor.criteria.degraded)
                : false);

            const {
                eventOccurred: validDown,
                matchedCriterion: matchedDownCriterion,
            } = await (monitor && monitor.criteria && monitor.criteria.down
                ? _this.incomingCondition(payload, [
                      ...monitor.criteria.down.filter(
                          criterion => criterion.default !== true
                      ),
                  ])
                : false);
            let timeHours = 0;
            let timeMinutes = payload;
            let tempReason = `${payload} min`;
            if (timeMinutes > 60) {
                timeHours = Math.floor(timeMinutes / 60);
                timeMinutes = Math.floor(timeMinutes % 60);
                tempReason = `${timeHours} hrs ${timeMinutes} min`;
            }

            if (validDown) {
                status = 'offline';
                reason = [`${criteriaStrings.incomingTime} ${tempReason}`];
                matchedCriterion = matchedDownCriterion;
            } else if (validDegraded) {
                status = 'degraded';
                reason = [`${criteriaStrings.incomingTime} ${tempReason}`];
                matchedCriterion = matchedDegradedCriterion;
            } else if (validUp) {
                status = 'online';
                reason = [`${criteriaStrings.incomingTime} ${tempReason}`];
                matchedCriterion = matchedUpCriterion;
            } else {
                status = 'offline';
                reason = [`${criteriaStrings.incomingTime} ${tempReason}`];
                if (monitor.criteria.down) {
                    matchedCriterion = monitor.criteria.down.find(
                        criterion => criterion.default === true
                    );
                }
            }
            const logData = {};
            logData.responseTime = 0;
            logData.responseStatus = null;
            logData.status = status;
            logData.probeId = probeId;
            logData.monitorId = monitor && monitor.id ? monitor.id : null;
            logData.sslCertificate = null;
            logData.lighthouseScanStatus = null;
            logData.performance = null;
            logData.accessibility = null;
            logData.bestPractices = null;
            logData.seo = null;
            logData.pwa = null;
            logData.lighthouseData = null;
            logData.retryCount = 3;
            logData.reason = reason;
            logData.response = null;
            logData.stopPingTimeUpdate = true;
            logData.matchedCriterion = matchedCriterion;
            // update monitor to save the last matched criterion
            await MonitorService.updateOneBy(
                {
                    _id: monitor._id,
                },
                {
                    lastMatchedCriterion: matchedCriterion,
                }
            );
            const log = await _this.saveMonitorLog(logData);
            return log;
        } catch (error) {
            ErrorService.log('monitorService.probeHttpRequest', error);
            throw error;
        }
    },
};

const _ = require('lodash');

const incomingCheckAnd = async (payload, condition) => {
    let validity = false;
    let val = 0;
    let incomingVal = 0;
    if (condition && condition.criteria && condition.criteria.length > 0) {
        for (let i = 0; i < condition.criteria.length; i++) {
            if (
                condition.criteria[i].criteria &&
                condition.criteria[i].criteria.length > 0
            ) {
                if (
                    condition.criteria[i].condition &&
                    condition.criteria[i].condition === 'and'
                ) {
                    // incoming check and
                    const tempAnd = await incomingCheckAnd(
                        payload,
                        condition.criteria[i]
                    );
                    if (tempAnd) {
                        val++;
                        incomingVal++;
                    }
                } else if (
                    condition.criteria[i].condition &&
                    condition.criteria[i].condition === 'or'
                ) {
                    // incoming check or
                    const tempOr = await incomingCheckOr(
                        payload,
                        condition.criteria[i]
                    );
                    if (tempOr) {
                        val++;
                        incomingVal++;
                    }
                }
            } else {
                if (
                    condition.criteria[i] &&
                    condition.criteria[i].responseType &&
                    condition.criteria[i].responseType === 'incomingTime'
                ) {
                    if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload > condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload < condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            condition.criteria[i].field2 &&
                            payload > condition.criteria[i].field1 &&
                            payload < condition.criteria[i].field2
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload == condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload != condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload >= condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload <= condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    }
                    incomingVal++;
                }
            }
        }
    }

    if (val > 0 && incomingVal > 0 && val === incomingVal) {
        validity = true;
    }

    return validity;
};

const incomingCheckOr = async (payload, condition) => {
    let validity = false;
    let val = 0;
    let incomingVal = 0;
    if (condition && condition.criteria && condition.criteria.length > 0) {
        for (let i = 0; i < condition.criteria.length; i++) {
            if (
                condition.criteria[i].criteria &&
                condition.criteria[i].criteria.length > 0
            ) {
                if (
                    condition.criteria[i].condition &&
                    condition.criteria[i].condition === 'or'
                ) {
                    // incoming check or
                    const tempor = await incomingCheckAnd(
                        payload,
                        condition.criteria[i]
                    );
                    if (tempor) {
                        val++;
                        incomingVal++;
                    }
                } else if (
                    condition.criteria[i].condition &&
                    condition.criteria[i].condition === 'and'
                ) {
                    const tempAnd = await incomingCheckAnd(
                        payload,
                        condition.criteria[i]
                    );
                    if (tempAnd) {
                        val++;
                        incomingVal++;
                    }
                }
            } else {
                if (
                    condition.criteria[i] &&
                    condition.criteria[i].responseType &&
                    condition.criteria[i].responseType === 'incomingTime'
                ) {
                    if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload > condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload < condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            condition.criteria[i].field2 &&
                            payload > condition.criteria[i].field1 &&
                            payload < condition.criteria[i].field2
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload == condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload != condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload >= condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    } else if (
                        condition.criteria[i] &&
                        condition.criteria[i].filter &&
                        condition.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            condition.criteria[i] &&
                            condition.criteria[i].field1 &&
                            payload &&
                            payload <= condition.criteria[i].field1
                        ) {
                            val++;
                        }
                    }
                    incomingVal++;
                }
            }
        }
    }

    if (val > 0 && incomingVal > 0) {
        validity = true;
    }

    return validity;
};

const checkAnd = async (
    payload,
    con,
    statusCode,
    body,
    ssl,
    response,
    successReasons,
    failedReasons,
    type,
    queryParams,
    headers
) => {
    let validity = true;
    if (con && con.criteria && con.criteria.length > 0) {
        for (let i = 0; i < con.criteria.length; i++) {
            if (
                con.criteria[i].criteria &&
                con.criteria[i].criteria.length > 0
            ) {
                if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'and'
                ) {
                    // check and again
                    const temp = await checkAnd(
                        payload,
                        con.criteria[i],
                        statusCode,
                        body,
                        ssl,
                        response,
                        successReasons,
                        failedReasons,
                        type,
                        queryParams,
                        headers
                    );

                    if (!temp) {
                        validity = temp;
                    }
                } else if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'or'
                ) {
                    // check or again
                    const temp1 = await checkOr(
                        payload,
                        con.criteria[i],
                        statusCode,
                        body,
                        ssl,
                        response,
                        successReasons,
                        failedReasons,
                        type,
                        queryParams,
                        headers
                    );
                    if (!temp1) {
                        validity = temp1;
                    }
                }
            } else {
                let tempReason = `${payload} min`;
                if (
                    con.criteria[i] &&
                    con.criteria[i].responseType &&
                    con.criteria[i].responseType === 'incomingTime'
                ) {
                    let timeHours = 0;
                    let timeMinutes = payload;
                    if (timeMinutes > 60) {
                        timeHours = Math.floor(timeMinutes / 60);
                        timeMinutes = Math.floor(timeMinutes % 60);
                        tempReason = `${timeHours} hrs ${timeMinutes} min`;
                    }
                }
                if (
                    con.criteria[i] &&
                    con.criteria[i].responseType &&
                    con.criteria[i].responseType === 'responseTime'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload > con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload < con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                con.criteria[i].field2 &&
                                payload > con.criteria[i].field1 &&
                                payload < con.criteria[i].field2
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload == con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload != con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload >= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload <= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType &&
                    con.criteria[i].responseType === 'incomingTime'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload > con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload < con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                con.criteria[i].field2 &&
                                payload > con.criteria[i].field1 &&
                                payload < con.criteria[i].field2
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload == con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload != con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload >= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload <= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'doesRespond'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isUp'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].filter &&
                                !(
                                    (statusCode === 408 ||
                                        statusCode === '408') &&
                                    body &&
                                    body.code &&
                                    body.code === 'ENOTFOUND'
                                )
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isDown'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].filter &&
                                (statusCode === 408 || statusCode === '408') &&
                                body &&
                                body.code &&
                                body.code === 'ENOTFOUND'
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'ssl'
                ) {
                    const expiresIn = moment(
                        new Date(
                            ssl && ssl.expires ? ssl.expires : Date.now()
                        ).getTime()
                    ).diff(Date.now(), 'days');
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isValid'
                    ) {
                        if (!(ssl && !ssl.selfSigned)) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} was not valid`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} was valid`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notFound'
                    ) {
                        if (ssl) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} was present`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} was not present`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'selfSigned'
                    ) {
                        if (!(ssl && ssl.selfSigned)) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} was not Self-Signed`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} was Self-Signed`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'expiresIn30'
                    ) {
                        if (!(ssl && !ssl.selfSigned && expiresIn < 30)) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'expiresIn10'
                    ) {
                        if (!(ssl && !ssl.selfSigned && expiresIn < 10)) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'statusCode'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                statusCode &&
                                statusCode > con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                statusCode &&
                                statusCode < con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                statusCode &&
                                con.criteria[i].field2 &&
                                statusCode > con.criteria[i].field1 &&
                                statusCode < con.criteria[i].field2
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                statusCode &&
                                statusCode == con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                statusCode &&
                                statusCode != con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                statusCode &&
                                statusCode >= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                statusCode &&
                                statusCode <= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'cpuLoad'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                payload.cpuLoad > con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                payload.cpuLoad < con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                con.criteria[i].field2 &&
                                payload.cpuLoad > con.criteria[i].field1 &&
                                payload.cpuLoad < con.criteria[i].field2
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                payload.cpuLoad == con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                payload.cpuLoad != con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                payload.cpuLoad >= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.cpuLoad &&
                                payload.cpuLoad <= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'memoryUsage'
                ) {
                    const memoryUsedBytes = payload
                        ? parseInt(payload.memoryUsed || 0)
                        : 0;
                    const memoryUsed = memoryUsedBytes / Math.pow(1e3, 3);
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                memoryUsed > con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                memoryUsed < con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                con.criteria[i].field2 &&
                                memoryUsed > con.criteria[i].field1 &&
                                memoryUsed < con.criteria[i].field2
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                memoryUsed == con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                memoryUsed != con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                memoryUsed >= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                memoryUsedBytes &&
                                memoryUsed &&
                                memoryUsed <= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'storageUsage'
                ) {
                    const size = payload
                        ? parseInt(payload.totalStorage || 0)
                        : 0;
                    const used = payload
                        ? parseInt(payload.storageUsed || 0)
                        : 0;
                    const freeBytes = size - used;
                    const free = freeBytes / Math.pow(1e3, 3);
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                freeBytes &&
                                free > con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                freeBytes &&
                                free < con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                con.criteria[i].field2 &&
                                freeBytes &&
                                free > con.criteria[i].field1 &&
                                free < con.criteria[i].field2
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                freeBytes &&
                                free === con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                freeBytes &&
                                free !== con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                freeBytes &&
                                free >= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                freeBytes &&
                                free <= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'temperature'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                payload.mainTemp > con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                payload.mainTemp < con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                con.criteria[i].field2 &&
                                payload.mainTemp > con.criteria[i].field1 &&
                                payload.mainTemp < con.criteria[i].field2
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                payload.mainTemp == con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                payload.mainTemp != con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                payload.mainTemp >= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                payload &&
                                payload.mainTemp &&
                                payload.mainTemp <= con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'responseBody'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'contains'
                    ) {
                        if (body && typeof body === 'string') {
                            if (
                                !(
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    body &&
                                    body.includes([con.criteria[i].field1])
                                )
                            ) {
                                validity = false;
                                failedReasons.push(
                                    `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                );
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                );
                            }
                        } else {
                            if (
                                !(
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    body &&
                                    body[con.criteria[i].field1]
                                )
                            ) {
                                validity = false;
                                failedReasons.push(
                                    `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                );
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'doesNotContain'
                    ) {
                        if (body && typeof body === 'string') {
                            if (
                                !(
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    body &&
                                    !body.includes([con.criteria[i].field1])
                                )
                            ) {
                                validity = false;
                                failedReasons.push(
                                    `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                );
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                );
                            }
                        } else {
                            if (
                                !(
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    body &&
                                    !body[con.criteria[i].field1]
                                )
                            ) {
                                validity = false;
                                failedReasons.push(
                                    `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                );
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'jsExpression'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                body &&
                                body[con.criteria[i].field1] ===
                                    con.criteria[i].field1
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} did not have Javascript expression \`${con.criteria[i].field1}\``
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} did have Javascript expression \`${con.criteria[i].field1}\``
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'empty'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].filter &&
                                body &&
                                _.isEmpty(body)
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} was not empty`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} was empty`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEmpty'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].filter &&
                                body &&
                                !_.isEmpty(body)
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} was empty`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} was not empty`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'evaluateResponse'
                    ) {
                        const responseDisplay = con.criteria[i].field1
                            ? con.criteria[i].field1.includes(
                                  'response.body'
                              ) &&
                              con.criteria[i].field1.includes(
                                  'response.headers'
                              )
                                ? {
                                      headers: response.headers,
                                      body: response.body,
                                  }
                                : con.criteria[i].field1.includes(
                                      'response.headers'
                                  )
                                ? response.headers
                                : con.criteria[i].field1.includes(
                                      'response.body'
                                  )
                                ? response.body
                                : response
                            : response;
                        try {
                            if (
                                !(
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    response &&
                                    Function(
                                        '"use strict";const response = ' +
                                            JSON.stringify(response) +
                                            ';return (' +
                                            con.criteria[i].field1 +
                                            ');'
                                    )()
                                )
                            ) {
                                validity = false;
                                failedReasons.push(
                                    `${
                                        criteriaStrings.response
                                    } \`${JSON.stringify(
                                        responseDisplay
                                    )}\` did evaluate \`${
                                        con.criteria[i].field1
                                    }\``
                                );
                            } else {
                                successReasons.push(
                                    `${
                                        criteriaStrings.response
                                    } \`${JSON.stringify(
                                        responseDisplay
                                    )}\` did evaluate \`${
                                        con.criteria[i].field1
                                    }\``
                                );
                            }
                        } catch (e) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.response} \`${JSON.stringify(
                                    responseDisplay
                                )}\` caused an error`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'queryString'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'contains'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                queryParams &&
                                queryParams.includes(
                                    con.criteria[i].field1.toLowerCase()
                                )
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'headers'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'contains'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                headers &&
                                headers.includes(
                                    con.criteria[i].field1.toLowerCase()
                                )
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'podStatus'
                ) {
                    const healthyPods = ['running', 'pending', 'succeeded'];
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.podData.allPods ||
                            payload.podData.allPods.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Pod is not available');
                        } else {
                            // eslint-disable-next-line no-loop-func
                            payload.podData.allPods.forEach(pod => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    pod.podStatus &&
                                    pod.podStatus.toLowerCase() ===
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    successReasons.push(
                                        `${pod.podName} pod status is ${pod.podStatus}`
                                    );
                                } else {
                                    validity = false;
                                    if (
                                        !healthyPods.includes(
                                            pod.podStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${pod.podName} pod status is ${pod.podStatus}`
                                        );
                                    }
                                }
                            });
                        }
                        // payload.podData.allPods.forEach(pod => {
                        //     if (
                        //         !(
                        //             con.criteria[i] &&
                        //             con.criteria[i].field1 &&
                        //             pod.podStatus &&
                        //             pod.podStatus.toLowerCase() ===
                        //                 con.criteria[i].field1.toLowerCase()
                        //         )
                        //     ) {
                        //         validity = false;
                        //         failedReasons.push(
                        //             `${pod.podName} pod status is ${pod.podStatus}`
                        //         );
                        //     } else {
                        //         successReasons.push(
                        //             `${pod.podName} pod status is ${pod.podStatus}`
                        //         );
                        //     }
                        // });
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.podData.allPods ||
                            payload.podData.allPods.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Pod is not available');
                        } else {
                            // eslint-disable-next-line no-loop-func
                            payload.podData.allPods.forEach(pod => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    pod.podStatus &&
                                    pod.podStatus.toLowerCase() !==
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    successReasons.push(
                                        `${pod.podName} pod status is ${pod.podStatus}`
                                    );
                                } else {
                                    validity = false;
                                    if (
                                        !healthyPods.includes(
                                            pod.podStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${pod.podName} pod status is ${pod.podStatus}`
                                        );
                                    }
                                }
                            });
                        }
                        // payload.podData.allPods.forEach(pod => {
                        //     if (
                        //         !(
                        //             con.criteria[i] &&
                        //             con.criteria[i].field1 &&
                        //             pod.podStatus &&
                        //             pod.podStatus.toLowerCase() !==
                        //                 con.criteria[i].field1.toLowerCase()
                        //         )
                        //     ) {
                        //         validity = false;
                        //         failedReasons.push(
                        //             `${pod.podName} pod status is ${pod.podStatus}`
                        //         );
                        //     } else {
                        //         successReasons.push(
                        //             `${pod.podName} pod status is ${pod.podStatus}`
                        //         );
                        //     }
                        // });
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'jobStatus'
                ) {
                    const healthyJobs = ['running', 'succeeded'];
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.jobData.allJobs ||
                            payload.jobData.allJobs.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Job is not available');
                        } else {
                            // eslint-disable-next-line no-loop-func
                            payload.jobData.allJobs.forEach(job => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    job.jobStatus &&
                                    job.jobStatus.toLowerCase() ===
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    successReasons.push(
                                        `${job.jobName} job status is ${job.jobStatus}`
                                    );
                                } else {
                                    validity = false;
                                    if (
                                        !healthyJobs.includes(
                                            job.jobStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${job.jobName} job status is ${job.jobStatus}`
                                        );
                                    }
                                }
                            });
                        }
                        // payload.jobData.allJobs.forEach(job => {
                        //     if (
                        //         !(
                        //             con.criteria[i] &&
                        //             con.criteria[i].field1 &&
                        //             job.jobStatus &&
                        //             job.jobStatus.toLowerCase() ===
                        //                 con.criteria[i].field1.toLowerCase()
                        //         )
                        //     ) {
                        //         validity = false;
                        //         failedReasons.push(
                        //             `${job.jobName} job status is ${job.jobStatus}`
                        //         );
                        //     } else {
                        //         successReasons.push(
                        //             `${job.jobName} job status is ${job.jobStatus}`
                        //         );
                        //     }
                        // });
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.jobData.allJobs ||
                            payload.jobData.allJobs.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Job is not available');
                        } else {
                            // eslint-disable-next-line no-loop-func
                            payload.jobData.allJobs.forEach(job => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    job.jobStatus &&
                                    job.jobStatus.toLowerCase() !==
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    successReasons.push(
                                        `${job.jobName} job status is ${job.jobStatus}`
                                    );
                                } else {
                                    validity = false;
                                    if (
                                        !healthyJobs.includes(
                                            job.jobStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${job.jobName} job status is ${job.jobStatus}`
                                        );
                                    }
                                }
                            });
                        }
                        // payload.jobData.allJobs.forEach(job => {
                        //     if (
                        //         !(
                        //             con.criteria[i] &&
                        //             con.criteria[i].field1 &&
                        //             job.jobStatus &&
                        //             job.jobStatus.toLowerCase() !==
                        //                 con.criteria[i].field1.toLowerCase()
                        //         )
                        //     ) {
                        //         validity = false;
                        //         failedReasons.push(
                        //             `${job.jobName} job status is ${job.jobStatus}`
                        //         );
                        //     } else {
                        //         successReasons.push(
                        //             `${job.jobName} job status is ${job.jobStatus}`
                        //         );
                        //     }
                        // });
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'desiredDeployment'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.deploymentData.allDeployments ||
                            payload.deploymentData.allDeployments.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Deployment is not available');
                        } else {
                            payload.deploymentData.allDeployments.forEach(
                                // eslint-disable-next-line no-loop-func
                                deployment => {
                                    if (
                                        deployment.desiredDeployment ===
                                        deployment.readyDeployment
                                    ) {
                                        successReasons.push(
                                            `${deployment.deploymentName} deployment state is (${deployment.readyDeployment}/${deployment.desiredDeployment})`
                                        );
                                    } else {
                                        validity = false;
                                        failedReasons.push(
                                            `${deployment.deploymentName} deployment state is (${deployment.readyDeployment}/${deployment.desiredDeployment})`
                                        );
                                    }
                                }
                            );
                        }
                        // payload.deploymentData.allDeployments.forEach(
                        //     // eslint-disable-next-line no-loop-func
                        //     deployment => {
                        //         if (
                        //             !(
                        //                 deployment.desiredDeployment ===
                        //                 deployment.readyDeployment
                        //             )
                        //         ) {
                        //             validity = false;
                        //             failedReasons.push(
                        //                 `${deployment.deploymentName} deployment state is (${deployment.readyDeployment}/${deployment.desiredDeployment})`
                        //             );
                        //         } else {
                        //             successReasons.push(
                        //                 `${deployment.deploymentName} deployment state is (${deployment.readyDeployment}/${deployment.desiredDeployment})`
                        //             );
                        //         }
                        //     }
                        // );
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.deploymentData.allDeployments ||
                            payload.deploymentData.allDeployments.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Deployment is not available');
                        } else {
                            payload.deploymentData.allDeployments.forEach(
                                // eslint-disable-next-line no-loop-func
                                deployment => {
                                    if (
                                        deployment.desiredDeployment !==
                                        deployment.readyDeployment
                                    ) {
                                        successReasons.push(
                                            `${deployment.deploymentName} deployment state is (${deployment.readyDeployment}/${deployment.desiredDeployment})`
                                        );
                                    } else {
                                        validity = false;
                                        failedReasons.push(
                                            `${deployment.deploymentName} deployment state is (${deployment.readyDeployment}/${deployment.desiredDeployment})`
                                        );
                                    }
                                }
                            );
                        }
                        // payload.deploymentData.allDeployments.forEach(
                        //     // eslint-disable-next-line no-loop-func
                        //     deployment => {
                        //         if (
                        //             !(
                        //                 deployment.desiredDeployment !==
                        //                 deployment.readyDeployment
                        //             )
                        //         ) {
                        //             validity = false;
                        //             failedReasons.push(
                        //                 `${deployment.deploymentName} deployment state is (${deployment.readyDeployment}/${deployment.desiredDeployment})`
                        //             );
                        //         } else {
                        //             successReasons.push(
                        //                 `${deployment.deploymentName} deployment state is (${deployment.readyDeployment}/${deployment.desiredDeployment})`
                        //             );
                        //         }
                        //     }
                        // );
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'desiredStatefulset'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.statefulsetData.allStatefulset ||
                            payload.statefulsetData.allStatefulset.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Statefulset is not available');
                        } else {
                            payload.statefulsetData.allStatefulset.forEach(
                                // eslint-disable-next-line no-loop-func
                                statefulset => {
                                    if (
                                        statefulset.desiredStatefulsets ===
                                        statefulset.readyStatefulsets
                                    ) {
                                        successReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    } else {
                                        validity = false;
                                        failedReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    }
                                }
                            );
                        }
                        // payload.statefulsetData.allStatefulset.forEach(
                        //     // eslint-disable-next-line no-loop-func
                        //     statefulset => {
                        //         if (
                        //             !(
                        //                 statefulset.desiredStatefulsets ===
                        //                 statefulset.readyStatefulsets
                        //             )
                        //         ) {
                        //             validity = false;
                        //             failedReasons.push(
                        //                 `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                        //             );
                        //         } else {
                        //             successReasons.push(
                        //                 `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                        //             );
                        //         }
                        //     }
                        // );
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.statefulsetData.allStatefulset ||
                            payload.statefulsetData.allStatefulset.length === 0
                        ) {
                            validity = false;
                            failedReasons.push('Statefulset is not available');
                        } else {
                            payload.statefulsetData.allStatefulset.forEach(
                                // eslint-disable-next-line no-loop-func
                                statefulset => {
                                    if (
                                        statefulset.desiredStatefulsets !==
                                        statefulset.readyStatefulsets
                                    ) {
                                        successReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    } else {
                                        validity = false;
                                        failedReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    }
                                }
                            );
                        }
                        // payload.statefulsetData.allStatefulset.forEach(
                        //     // eslint-disable-next-line no-loop-func
                        //     statefulset => {
                        //         if (
                        //             !(
                        //                 statefulset.desiredStatefulsets !==
                        //                 statefulset.readyStatefulsets
                        //             )
                        //         ) {
                        //             validity = false;
                        //             failedReasons.push(
                        //                 `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                        //             );
                        //         } else {
                        //             successReasons.push(
                        //                 `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                        //             );
                        //         }
                        //     }
                        // );
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'respondsToPing'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isUp'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].filter &&
                                !(statusCode === 408 || statusCode === '408')
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isDown'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].filter &&
                                (statusCode === 408 || statusCode === '408')
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        }
                    }
                }
            }
        }
    }

    return validity;
};

const checkOr = async (
    payload,
    con,
    statusCode,
    body,
    ssl,
    response,
    successReasons,
    failedReasons,
    type,
    queryParams,
    headers
) => {
    let validity = false;
    if (con && con.criteria && con.criteria.length > 0) {
        for (let i = 0; i < con.criteria.length; i++) {
            if (
                con.criteria[i].criteria &&
                con.criteria[i].criteria.length > 0
            ) {
                if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'or'
                ) {
                    // check or again
                    const temp1 = await checkOr(
                        payload,
                        con.criteria[i],
                        statusCode,
                        body,
                        ssl,
                        response,
                        successReasons,
                        failedReasons,
                        type,
                        queryParams,
                        headers
                    );
                    if (temp1) {
                        validity = temp1;
                    }
                } else if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'and'
                ) {
                    const temp = await checkAnd(
                        payload,
                        con.criteria[i],
                        statusCode,
                        body,
                        ssl,
                        response,
                        successReasons,
                        failedReasons,
                        type,
                        queryParams,
                        headers
                    );
                    if (temp) {
                        validity = temp;
                    }
                }
            } else {
                let tempReason = `${payload} min`;
                if (
                    con.criteria[i] &&
                    con.criteria[i].responseType &&
                    con.criteria[i].responseType === 'incomingTime'
                ) {
                    let timeHours = 0;
                    let timeMinutes = payload;
                    if (timeMinutes > 60) {
                        timeHours = Math.floor(timeMinutes / 60);
                        timeMinutes = Math.floor(timeMinutes % 60);
                        tempReason = `${timeHours} hrs ${timeMinutes} min`;
                    }
                }
                if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'responseTime'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload > con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload < con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            con.criteria[i].field2 &&
                            payload > con.criteria[i].field1 &&
                            payload < con.criteria[i].field2
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload == con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload != con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload >= con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload <= con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseTime} ${payload} ms`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'incomingTime'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload > con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload < con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            con.criteria[i].field2 &&
                            payload > con.criteria[i].field1 &&
                            payload < con.criteria[i].field2
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload == con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload != con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload >= con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload <= con.criteria[i].field1
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.incomingTime} ${tempReason}`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'doesRespond'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isUp'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].filter &&
                            !(
                                (statusCode === 408 || statusCode === '408') &&
                                body &&
                                body.code &&
                                body.code === 'ENOTFOUND'
                            )
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isDown'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].filter &&
                            (statusCode === 408 || statusCode === '408') &&
                            body &&
                            body.code &&
                            body.code === 'ENOTFOUND'
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'ssl'
                ) {
                    const expiresIn = moment(
                        new Date(
                            ssl && ssl.expires ? ssl.expires : Date.now()
                        ).getTime()
                    ).diff(Date.now(), 'days');
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isValid'
                    ) {
                        if (ssl && !ssl.selfSigned) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} was valid`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} was not valid`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notFound'
                    ) {
                        if (!ssl) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} was not present`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} was present`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'selfSigned'
                    ) {
                        if (ssl && ssl.selfSigned) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.sslCertificate} was Self-Signed`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.sslCertificate} was not Self-Signed`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'expiresIn30'
                    ) {
                        if (ssl && !ssl.selfSigned && expiresIn < 30) {
                            validity = true;
                            if (expiresIn) {
                                successReasons.push(
                                    `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                                );
                            }
                        } else {
                            if (expiresIn) {
                                failedReasons.push(
                                    `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'expiresIn10'
                    ) {
                        if (ssl && !ssl.selfSigned && expiresIn < 10) {
                            validity = true;
                            if (expiresIn) {
                                successReasons.push(
                                    `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                                );
                            }
                        } else {
                            if (expiresIn) {
                                failedReasons.push(
                                    `${criteriaStrings.sslCertificate} expires in ${expiresIn} days`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'statusCode'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            statusCode > con.criteria[i].field1
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            statusCode < con.criteria[i].field1
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            con.criteria[i].field2 &&
                            statusCode > con.criteria[i].field1 &&
                            statusCode < con.criteria[i].field2
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            statusCode == con.criteria[i].field1
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            statusCode != con.criteria[i].field1
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            statusCode >= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            statusCode &&
                            statusCode <= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (statusCode === 408 || statusCode === '408') {
                                successReasons.push('Request Timed out');
                            } else {
                                successReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        } else {
                            if (statusCode === 408 || statusCode === '408') {
                                failedReasons.push('Request Timed out');
                            } else {
                                failedReasons.push(
                                    `${criteriaStrings.statusCode} ${statusCode}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'cpuLoad'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            payload.cpuLoad > con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            payload.cpuLoad < con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            con.criteria[i].field2 &&
                            payload.cpuLoad > con.criteria[i].field1 &&
                            payload.cpuLoad < con.criteria[i].field2
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            payload.cpuLoad == con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            payload.cpuLoad != con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            payload.cpuLoad >= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.cpuLoad &&
                            payload.cpuLoad <= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.cpuLoad !== null) {
                                successReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        } else {
                            if (payload && payload.cpuLoad !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.cpuLoad} ${formatDecimal(
                                        payload.cpuLoad,
                                        2
                                    )} %`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'memoryUsage'
                ) {
                    const memoryUsedBytes = payload
                        ? parseInt(payload.memoryUsed || 0)
                        : 0;
                    const memoryUsed = memoryUsedBytes / Math.pow(1e3, 3);
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            memoryUsed > con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            memoryUsed < con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            con.criteria[i].field2 &&
                            memoryUsed > con.criteria[i].field1 &&
                            memoryUsed < con.criteria[i].field2
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            memoryUsed == con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            memoryUsed != con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            memoryUsed >= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            memoryUsed &&
                            memoryUsed <= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.memoryUsed !== null) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        } else {
                            if (payload && payload.memoryUsed !== null) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.memoryUsed
                                    } ${formatBytes(memoryUsedBytes)}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'storageUsage'
                ) {
                    const size = payload
                        ? parseInt(payload.totalStorage || 0)
                        : 0;
                    const used = payload
                        ? parseInt(payload.storageUsed || 0)
                        : 0;
                    const freeBytes = size - used;
                    const free = freeBytes / Math.pow(1e3, 3);
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            free > con.criteria[i].field1
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            free < con.criteria[i].field1
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            con.criteria[i].field2 &&
                            free > con.criteria[i].field1 &&
                            free < con.criteria[i].field2
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            free === con.criteria[i].field1
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            free !== con.criteria[i].field1
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            free >= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            free <= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                successReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        } else {
                            if (
                                payload &&
                                payload.totalStorage !== null &&
                                payload.storageUsed !== null
                            ) {
                                failedReasons.push(
                                    `${
                                        criteriaStrings.freeStorage
                                    } ${formatBytes(freeBytes)}`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'temperature'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'greaterThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            payload.mainTemp > con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'lessThan'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            payload.mainTemp < con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'inBetween'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            con.criteria[i].field2 &&
                            payload.mainTemp > con.criteria[i].field1 &&
                            payload.mainTemp < con.criteria[i].field2
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            payload.mainTemp == con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            payload.mainTemp != con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'gtEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            payload.mainTemp >= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'ltEqualTo'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            payload &&
                            payload.mainTemp &&
                            payload.mainTemp <= con.criteria[i].field1
                        ) {
                            validity = true;
                            if (payload && payload.mainTemp !== null) {
                                successReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        } else {
                            if (payload && payload.mainTemp !== null) {
                                failedReasons.push(
                                    `${criteriaStrings.temperature} ${payload.mainTemp} °C`
                                );
                            }
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'responseBody'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'contains'
                    ) {
                        if (body && typeof body === 'string') {
                            if (
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                body &&
                                body.includes([con.criteria[i].field1])
                            ) {
                                validity = true;
                                if (con.criteria[i].field1) {
                                    successReasons.push(
                                        `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                    );
                                }
                            } else {
                                if (con.criteria[i].field1) {
                                    failedReasons.push(
                                        `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                    );
                                }
                            }
                        } else {
                            if (
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                body &&
                                body[con.criteria[i].field1]
                            ) {
                                validity = true;
                                if (con.criteria[i].field1) {
                                    successReasons.push(
                                        `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                    );
                                }
                            } else {
                                if (con.criteria[i].field1) {
                                    failedReasons.push(
                                        `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                    );
                                }
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'doesNotContain'
                    ) {
                        if (body && typeof body === 'string') {
                            if (
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                body &&
                                !body.includes([con.criteria[i].field1])
                            ) {
                                validity = true;
                                if (con.criteria[i].field1) {
                                    successReasons.push(
                                        `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                    );
                                }
                            } else {
                                if (con.criteria[i].field1) {
                                    failedReasons.push(
                                        `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                    );
                                }
                            }
                        } else {
                            if (
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                body &&
                                !body[con.criteria[i].field1]
                            ) {
                                validity = true;
                                if (con.criteria[i].field1) {
                                    successReasons.push(
                                        `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                                    );
                                }
                            } else {
                                if (con.criteria[i].field1) {
                                    failedReasons.push(
                                        `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                                    );
                                }
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'jsExpression'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].field1 &&
                            body &&
                            body[con.criteria[i].field1] ===
                                con.criteria[i].field1
                        ) {
                            validity = true;
                            if (con.criteria[i].field1) {
                                successReasons.push(
                                    `${criteriaStrings.responseBody} contains Javascript expression ${con.criteria[i].field1}`
                                );
                            }
                        } else {
                            if (con.criteria[i].field1) {
                                failedReasons.push(
                                    `${criteriaStrings.responseBody} does not contain Javascript expression ${con.criteria[i].field1}`
                                );
                            }
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'empty'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].filter &&
                            body &&
                            _.isEmpty(body)
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseBody} was empty`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseBody} was not empty`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEmpty'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].filter &&
                            body &&
                            !_.isEmpty(body)
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings.responseBody} was not empty`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings.responseBody} was empty`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'evaluateResponse'
                    ) {
                        const responseDisplay = con.criteria[i].field1
                            ? con.criteria[i].field1.includes(
                                  'response.body'
                              ) &&
                              con.criteria[i].field1.includes(
                                  'response.headers'
                              )
                                ? {
                                      headers: response.headers,
                                      body: response.body,
                                  }
                                : con.criteria[i].field1.includes(
                                      'response.headers'
                                  )
                                ? response.headers
                                : con.criteria[i].field1.includes(
                                      'response.body'
                                  )
                                ? response.body
                                : response
                            : response;
                        try {
                            if (
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                response &&
                                Function(
                                    '"use strict";const response = ' +
                                        JSON.stringify(response) +
                                        ';return (' +
                                        con.criteria[i].field1 +
                                        ');'
                                )()
                            ) {
                                validity = true;
                                if (con.criteria[i].field1) {
                                    successReasons.push(
                                        `${
                                            criteriaStrings.response
                                        } \`${JSON.stringify(
                                            responseDisplay
                                        )}\` evaluate \`${
                                            con.criteria[i].field1
                                        }\``
                                    );
                                }
                            } else {
                                if (con.criteria[i].field1) {
                                    failedReasons.push(
                                        `${
                                            criteriaStrings.response
                                        } \`${JSON.stringify(
                                            responseDisplay
                                        )}\` did not evaluate \`${
                                            con.criteria[i].field1
                                        }\``
                                    );
                                }
                            }
                        } catch (e) {
                            failedReasons.push(
                                `${criteriaStrings.response} \`${JSON.stringify(
                                    responseDisplay
                                )}\` did not evaluate \`${
                                    con.criteria[i].field1
                                }\``
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'queryString'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'contains'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                queryParams &&
                                queryParams.includes(
                                    con.criteria[i].field1.toLowerCase()
                                )
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'headers'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'contains'
                    ) {
                        if (
                            !(
                                con.criteria[i] &&
                                con.criteria[i].field1 &&
                                headers &&
                                headers.includes(
                                    con.criteria[i].field1.toLowerCase()
                                )
                            )
                        ) {
                            validity = false;
                            failedReasons.push(
                                `${criteriaStrings.responseBody} did not contain ${con.criteria[i].field1}`
                            );
                        } else {
                            successReasons.push(
                                `${criteriaStrings.responseBody} contains ${con.criteria[i].field1}`
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'podStatus'
                ) {
                    const healthyPods = ['running', 'pending', 'succeeded'];
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.podData.allPods ||
                            payload.podData.allPods.length === 0
                        ) {
                            failedReasons.push('Pod is not available');
                        } else {
                            // eslint-disable-next-line no-loop-func
                            payload.podData.allPods.forEach(pod => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    pod.podStatus &&
                                    pod.podStatus.toLowerCase() ===
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    validity = true;
                                    successReasons.push(
                                        `${pod.podName} pod status is ${pod.podStatus}`
                                    );
                                } else {
                                    if (
                                        !healthyPods.includes(
                                            pod.podStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${pod.podName} pod status is ${pod.podStatus}`
                                        );
                                    }
                                }
                            });
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.podData.allPods ||
                            payload.podData.allPods.length === 0
                        ) {
                            failedReasons.push('Pod is not available');
                        } else {
                            // eslint-disable-next-line no-loop-func
                            payload.podData.allPods.forEach(pod => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    pod.podStatus &&
                                    pod.podStatus.toLowerCase() !==
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    validity = true;
                                    successReasons.push(
                                        `${pod.podName} pod status is ${pod.podStatus}`
                                    );
                                } else {
                                    if (
                                        !healthyPods.includes(
                                            pod.podStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${pod.podName} pod status is ${pod.podStatus}`
                                        );
                                    }
                                }
                            });
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'jobStatus'
                ) {
                    const healthyJobs = ['running', 'succeeded'];
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.jobData.allJobs ||
                            payload.jobData.allJobs.length === 0
                        ) {
                            failedReasons.push('Job is not available');
                        } else {
                            // eslint-disable-next-line no-loop-func
                            payload.jobData.allJobs.forEach(job => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    job.jobStatus &&
                                    job.jobStatus.toLowerCase() ===
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    validity = true;
                                    successReasons.push(
                                        `${job.jobName} job status is ${job.jobStatus}`
                                    );
                                } else {
                                    if (
                                        !healthyJobs.includes(
                                            job.jobStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${job.jobName} job status is ${job.jobStatus}`
                                        );
                                    }
                                }
                            });
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.jobData.allJobs ||
                            payload.jobData.allJobs.length === 0
                        ) {
                            failedReasons.push('Job is not available');
                        } else {
                            // eslint-disable-next-line no-loop-func
                            payload.jobData.allJobs.forEach(job => {
                                if (
                                    con.criteria[i] &&
                                    con.criteria[i].field1 &&
                                    job.jobStatus &&
                                    job.jobStatus.toLowerCase() !==
                                        con.criteria[i].field1.toLowerCase()
                                ) {
                                    validity = true;
                                    successReasons.push(
                                        `${job.jobName} job status is ${job.jobStatus}`
                                    );
                                } else {
                                    if (
                                        !healthyJobs.includes(
                                            job.jobStatus.toLowerCase()
                                        )
                                    ) {
                                        failedReasons.push(
                                            `${job.jobName} job status is ${job.jobStatus}`
                                        );
                                    }
                                }
                            });
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'desiredDeployment'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.deploymentData.allDeployments ||
                            payload.deploymentData.allDeployments.length === 0
                        ) {
                            failedReasons.push('Deployment is not available');
                        } else {
                            payload.deploymentData.allDeployments.forEach(
                                // eslint-disable-next-line no-loop-func
                                deployment => {
                                    if (
                                        deployment.desiredDeployment ===
                                        deployment.readyDeployment
                                    ) {
                                        validity = true;
                                        successReasons.push(
                                            `${deployment.deploymentName} deployment state is ${deployment.readyDeployment}/${deployment.desiredDeployment}`
                                        );
                                    } else {
                                        failedReasons.push(
                                            `${deployment.deploymentName} deployment state is ${deployment.readyDeployment}/${deployment.desiredDeployment}`
                                        );
                                    }
                                }
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.deploymentData.allDeployments ||
                            payload.deploymentData.allDeployments.length === 0
                        ) {
                            failedReasons.push('Deployment is not available');
                        } else {
                            payload.deploymentData.allDeployments.forEach(
                                // eslint-disable-next-line no-loop-func
                                deployment => {
                                    if (
                                        deployment.desiredDeployment !==
                                        deployment.readyDeployment
                                    ) {
                                        validity = true;
                                        successReasons.push(
                                            `${deployment.deploymentName} deployment state is ${deployment.readyDeployment}/${deployment.desiredDeployment}`
                                        );
                                    } else {
                                        failedReasons.push(
                                            `${deployment.deploymentName} deployment state is ${deployment.readyDeployment}/${deployment.desiredDeployment}`
                                        );
                                    }
                                }
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'desiredStatefulsets'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'equalTo'
                    ) {
                        if (
                            !payload.statefulsetData.allStatefulset ||
                            payload.statefulsetData.allStatefulset.length === 0
                        ) {
                            failedReasons.push('Statefulset is not available');
                        } else {
                            payload.statefulsetData.allStatefulset.forEach(
                                // eslint-disable-next-line no-loop-func
                                statefulset => {
                                    if (
                                        statefulset.desiredStatefulsets ===
                                        statefulset.readyStatefulsets
                                    ) {
                                        validity = true;
                                        successReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    } else {
                                        failedReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    }
                                }
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'notEqualTo'
                    ) {
                        if (
                            !payload.statefulsetData.allStatefulset ||
                            payload.statefulsetData.allStatefulset.length === 0
                        ) {
                            failedReasons.push('Statefulset is not available');
                        } else {
                            payload.statefulsetData.allStatefulset.forEach(
                                // eslint-disable-next-line no-loop-func
                                statefulset => {
                                    if (
                                        statefulset.desiredStatefulsets !==
                                        statefulset.readyStatefulsets
                                    ) {
                                        validity = true;
                                        successReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    } else {
                                        failedReasons.push(
                                            `${statefulset.statefulsetName} statefulset state is ${statefulset.readyStatefulsets}/${statefulset.desiredStatefulsets}`
                                        );
                                    }
                                }
                            );
                        }
                    }
                } else if (
                    con.criteria[i] &&
                    con.criteria[i].responseType === 'respondsToPing'
                ) {
                    if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isUp'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].filter &&
                            !(statusCode === 408 || statusCode === '408')
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        }
                    } else if (
                        con.criteria[i] &&
                        con.criteria[i].filter &&
                        con.criteria[i].filter === 'isDown'
                    ) {
                        if (
                            con.criteria[i] &&
                            con.criteria[i].filter &&
                            (statusCode === 408 || statusCode === '408')
                        ) {
                            validity = true;
                            successReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Offline`
                            );
                        } else {
                            failedReasons.push(
                                `${criteriaStrings[type] ||
                                    'Monitor was'} Online`
                            );
                        }
                    }
                }
            }
        }
    }

    return validity;
};

/**
 * verifies if a specific script condition satisfies
 * @param {'and' | 'or'} conditionLogic
 * @returns {{ valid : boolean, reason : string} | undefined} whether the condition is satisfied
 */
const checkScriptCondition = (condition, payload, body) => {
    if (!condition || !condition.responseType) {
        return;
    }
    /**
     * @type { {valid : boolean, reason : string}}
     */
    const validity = {};

    if (condition.responseType === 'executes') {
        if (!condition.filter || !condition.field1 || !payload) {
            return;
        }

        if (condition.filter === 'executesIn') {
            if (payload <= condition.field1) {
                validity.valid = true;
                validity.reason = `Script executed in ${condition.field1} ms`;
            } else {
                validity.valid = false;
                validity.reason = `Script did not execute in ${condition.field1} ms`;
            }
        } else if (condition.filter === 'doesNotExecuteIn') {
            if (payload > condition.field1) {
                validity.valid = true;
                validity.reason = `Script did not execute in ${condition.field1} ms`;
            } else {
                validity.valid = false;
                validity.reason = `Script executed in ${condition.field1} ms`;
            }
        }
    } else if (condition.responseType === 'error') {
        if (!condition.filter || !body) {
            return;
        }

        if (condition.filter === 'throwsError') {
            if (body.error) {
                validity.valid = true;
                validity.reason = `Script threw error ${body.error}`;
            } else {
                validity.valid = false;
                validity.reason = `Script did not throw error`;
            }
        } else if (condition.filter === 'doesNotThrowError') {
            if (body.error) {
                validity.valid = false;
                validity.reason = `Script threw error ${body.error}`;
            } else {
                validity.valid = true;
                validity.reason = `Script did not throw error`;
            }
        }
    } else if (condition.responseType === 'javascriptExpression') {
        if (condition.filter === body) {
            validity.valid = true;
            validity.reason = `Script has matching Javascript expression`;
        } else {
            validity.valid = false;
            validity.reason = `Script did not have Javascript expression`;
        }
    }

    return validity;
};

const checkScriptAnd = (
    payload,
    con,
    statusCode,
    body,
    successReasons,
    failedReasons
) => {
    let valid = true;
    if (con && con.criteria && con.criteria.length > 0) {
        for (let i = 0; i < con.criteria.length; i++) {
            if (
                con.criteria[i].criteria &&
                con.criteria[i].criteria.length > 0
            ) {
                if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'and'
                ) {
                    // check script and
                    const subConditionValid = checkScriptAnd(
                        payload,
                        con.criteria[i],
                        statusCode,
                        body,
                        successReasons,
                        failedReasons
                    );
                    if (!subConditionValid) {
                        valid = false;
                    }
                } else if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'or'
                ) {
                    // check script or
                    const subConditionValid = checkScriptOr(
                        payload,
                        con.criteria[i],
                        statusCode,
                        body,
                        successReasons,
                        failedReasons
                    );
                    if (!subConditionValid) {
                        valid = false;
                    }
                }
            } else {
                const validity = checkScriptCondition(
                    con.criteria[i],
                    payload,
                    body
                );
                if (validity) {
                    if (validity.valid) {
                        successReasons.push(validity.reason);
                    } else {
                        valid = false;
                        failedReasons.push(validity.reason);
                    }
                }
            }
        }
    }

    return valid;
};

const checkScriptOr = (
    payload,
    con,
    statusCode,
    body,
    successReasons,
    failedReasons
) => {
    let valid = false;
    if (con && con.criteria && con.criteria.length > 0) {
        for (let i = 0; i < con.criteria.length; i++) {
            if (
                con.criteria[i].criteria &&
                con.criteria[i].criteria.length > 0
            ) {
                if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'or'
                ) {
                    // check script or
                    const subConditionValid = checkScriptOr(
                        payload,
                        con.criteria[i],
                        statusCode,
                        body,
                        successReasons,
                        failedReasons
                    );
                    if (subConditionValid) {
                        valid = true;
                    }
                } else if (
                    con.criteria[i].condition &&
                    con.criteria[i].condition === 'and'
                ) {
                    // check script and
                    const subConditionValid = checkScriptAnd(
                        payload,
                        con.criteria[i],
                        statusCode,
                        body,
                        successReasons,
                        failedReasons
                    );
                    if (subConditionValid) {
                        valid = true;
                    }
                }
            } else {
                const validity = checkScriptCondition(
                    con.criteria[i],
                    payload,
                    body
                );
                if (validity) {
                    if (validity.valid) {
                        valid = true;
                        successReasons.push(validity.reason);
                    } else {
                        failedReasons.push(validity.reason);
                    }
                }
            }
        }
    }

    return valid;
};

const criteriaStrings = {
    responseTime: 'Response Time is',
    sslCertificate: 'SSL Certificate',
    statusCode: 'Status Code is',
    cpuLoad: 'CPU Load is',
    memoryUsed: 'Memory Used is',
    freeStorage: 'Free Storage is',
    temperature: 'Temperature is',
    responseBody: 'Response Body',
    response: 'Response',
    incomingTime: 'Incoming request time interval is',
    'server-monitor': 'Server is',
    url: 'Website is',
    api: 'API is',
    incomingHttpRequest: 'Incoming request is',
    ip: 'IP is',
};

const formatDecimal = (value, decimalPlaces, roundType) => {
    let formattedNumber;
    switch (roundType) {
        case 'up':
            formattedNumber = Math.ceil(
                parseFloat(value + 'e' + decimalPlaces)
            );
            break;
        case 'down':
            formattedNumber = Math.floor(
                parseFloat(value + 'e' + decimalPlaces)
            );
            break;
        default:
            formattedNumber = Math.round(
                parseFloat(value + 'e' + decimalPlaces)
            );
    }
    return Number(formattedNumber + 'e-' + decimalPlaces).toFixed(
        decimalPlaces
    );
};

const formatBytes = (a, b, c, d, e) => {
    let value = a;
    let decimalPlaces;
    let roundType;
    if (typeof a === 'object') {
        value = a.value;
        decimalPlaces = a.decimalPlaces;
        roundType = a.roundType;
    }
    return (
        formatDecimal(
            ((b = Math),
            (c = b.log),
            (d = 1e3),
            (e = (c(value) / c(d)) | 0),
            value / b.pow(d, e)),
            decimalPlaces >= 0 ? decimalPlaces : 2,
            roundType
        ) +
        ' ' +
        (e ? 'kMGTPEZY'[--e] + 'B' : 'Bytes')
    );
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

async function deleteFile(file) {
    if (fs.existsSync(file)) {
        await unlink(file);
    }
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
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const rmdir = promisify(fs.rmdir);
const unlink = promisify(fs.unlink);
const { some, forEach } = require('p-iteration');
