module.exports = {
    create: async function(data) {
        try {
            const _this = this;
            let lighthouseKey;
            if (data.lighthouseKey) {
                lighthouseKey = data.lighthouseKey;
            } else {
                lighthouseKey = uuidv1();
            }
            const storedlighthouse = await _this.findOneBy({
                lighthouseName: data.lighthouseName,
            });
            if (storedlighthouse && storedlighthouse.lighthouseName) {
                const error = new Error('lighthouse name already exists.');
                error.code = 400;
                ErrorService.log('lighthouse.create', error);
                throw error;
            } else {
                const lighthouse = new LighthouseModel();
                lighthouse.lighthouseKey = lighthouseKey;
                lighthouse.lighthouseName = data.lighthouseName;
                lighthouse.version = data.lighthouseVersion;
                const savedlighthouse = await lighthouse.save();
                return savedlighthouse;
            }
        } catch (error) {
            ErrorService.log('lighthouseService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const lighthouse = await LighthouseModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );
            return lighthouse;
        } catch (error) {
            ErrorService.log('lighthouseService.updateOneBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const lighthouse = await LighthouseModel.findOne(query, {
                deleted: false,
            }).lean();
            return lighthouse;
        } catch (error) {
            ErrorService.log('lighthouseService.findOneBy', error);
            throw error;
        }
    },
    saveMonitorLog: async function(data) {
        try {
            const _this = this;
            const monitorStatus = await MonitorStatusService.findOneBy({
                monitorId: data.monitorId,
                lighthouseId: data.lighthouseId,
            });
            const lastStatus =
                monitorStatus && monitorStatus.status
                    ? monitorStatus.status
                    : null;

            let log = await MonitorLogService.create(data);
            if (!data.stopPingTimeUpdate) {
                await MonitorService.updateMonitorPingTime(data.monitorId);
            }

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

            if (!lastStatus || (lastStatus && lastStatus !== data.status)) {
                // check if monitor has a previous status
                // check if previous status is different from the current status
                // if different, resolve last incident, create a new incident and monitor status
                if (lastStatus) {
                    // check 3 times just to make sure
                    if (
                        typeof data.retry === 'boolean' &&
                        data.retryCount >= 0 &&
                        data.retryCount < 3
                    )
                        return { retry: true, retryCount: data.retryCount };

                    await _this.incidentResolveOrAcknowledge(data, allCriteria);
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
                // should make sure all unresolved incidents for the monitor is resolved
                if (data.status === 'online') {
                    await _this.incidentResolveOrAcknowledge(data, allCriteria);
                }

                const incidents = await IncidentService.findBy({
                    'monitors.monitorId': data.monitorId,
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
            ErrorService.log('lighthouseService.saveMonitorLog', error);
            throw error;
        }
    },

}
const LighthouseModel = require('../models/lighthouse');
const ErrorService = require('./errorService');
const MonitorStatusService = require('./monitorStatusService');
const MonitorLogService = require('./monitorLogService');