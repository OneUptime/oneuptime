import moment from 'moment';
const MonitorService: $TSFixMe = require('../Services/monitorService'),
    IncidentService: $TSFixMe = require('../Services/incidentService'),
    ZapierService: $TSFixMe = require('../Services/zapierService');

export default {
    checkAllDeviceMonitor: async () => {
        const newDate: $TSFixMe = new moment();
        const resDate: $TSFixMe = new Date();
        const monitors: $TSFixMe = await MonitorService.getDeviceMonitorsPing();
        if (monitors) {
            monitors.forEach(async (monitor: $TSFixMe) => {
                const d: $TSFixMe = new moment(monitor.lastPingTime);

                if (newDate.diff(d, 'minutes') > 3) {
                    await job(monitor);
                } else {
                    const res: $TSFixMe =
                        new Date().getTime() - resDate.getTime();
                    await job(monitor, res);
                }
            });
        } else {
            return;
        }
    },
};

const job: Function = async (monitor: $TSFixMe, res: $TSFixMe): void => {
    const populate: $TSFixMe = [
        {
            path: 'monitors.monitorId',
            select: 'name slug componentId projectId type',
            populate: { path: 'componentId', select: 'name slug' },
        },
        { path: 'createdById', select: 'name' },
        { path: 'projectId', select: 'name slug' },
        { path: 'resolvedBy', select: 'name' },
        { path: 'acknowledgedBy', select: 'name' },
        { path: 'incidentPriority', select: 'name color' },
        {
            path: 'acknowledgedByIncomingHttpRequest',
            select: 'name',
        },
        { path: 'resolvedByIncomingHttpRequest', select: 'name' },
        { path: 'createdByIncomingHttpRequest', select: 'name' },
        { path: 'probes.probeId', select: 'name _id' },
    ];
    const select: $TSFixMe =
        'slug notifications acknowledgedByIncomingHttpRequest resolvedByIncomingHttpRequest _id monitors createdById projectId createdByIncomingHttpRequest incidentType resolved resolvedBy acknowledged acknowledgedBy title description incidentPriority criterionCause probes acknowledgedAt resolvedAt manuallyCreated deleted customFields idNumber';

    if (res) {
        await MonitorService.setMonitorTime(monitor._id, res, 'online');
        let incident: $TSFixMe = await IncidentService.findBy({
            query: {
                monitorId: monitor._id,
                createdById: null,
                resolved: false,
                manuallyCreated: false,
            },
            select,
            populate,
        });
        if (incident.length) {
            incident = await IncidentService.resolve(
                { incidentId: incident[0]._id },
                null
            );
            await ZapierService.pushToZapier('incident_resolve', incident);
        }
    } else {
        await MonitorService.setMonitorTime(monitor._id, 0, 'offline');
        let incident1: $TSFixMe = await IncidentService.findBy({
            query: {
                monitorId: monitor._id,
                createdById: null,
                resolved: false,
                manuallyCreated: false,
            },
            select,
            populate,
        });
        if (!incident1.length) {
            incident1 = await IncidentService.create({
                monitors: [monitor._id],
                projectId: monitor.projectId,
            });
            await ZapierService.pushToZapier('incident_created', incident1);
        }
    }
};
