/* eslint-disable no-console */
var tcpp = require('tcp-ping'),
    Q = require('q'),
    MonitorService = require('../services/monitorService'),
    IncidentService = require('../services/incidentService'),
    ZapierService = require('../services/zapierService'),
    ErrorService = require('../services/errorService'),
    AlertService = require('../services/alertService'),
    fetch = require('node-fetch');


// it collects all monitors then ping them one by one to store their response
// checks if the website of the url in the monitors is up or down
// creates incident if a website is down and resolves it when they come back up
module.exports = {
    pingCron: async () => {
        try {
            var date = new Date(new Date().getTime() - (60 * 1000));
            var monitors = await MonitorService.getAllMonitorsPing(date);
            if (monitors) {
                await Promise.all(monitors.map(async(monitor) => {
                    var url = monitor.data && monitor.data.url ? (monitor.data.url.split('://').length > 1 ? monitor.data.url.split('://')[1] : monitor.data.url) : null;
    
                    //trim "/"
                    if (url && url.endsWith('/')) {
                        url = url.substring(0, url.length - 1);
                    }
                    if (!url) return;
    
                    if (url.split('/').length > 1) {
                        var res = await pingfetch(monitor.data.url, (new Date()).getTime());
                        await job(monitor, res);
                    } else {
                        var res1 = await pingfunction(url);
                        await job(monitor, res1);
                    }
                }));
            } else {
                return;
            }
        } catch (error) {
            ErrorService.log('pingCron.pingCron', error);
            throw error;
        }
    }
};


var job = async (monitor, res) => {
    try {
        if (res && !isNaN(res)) {
            await MonitorService.setMonitorTime(monitor._id, res, 'online');
            var incident = await IncidentService.findBy({ monitorId: monitor._id, resolved: false, manuallyCreated:false, createdByZapier: false });
            if (incident.length) {
                incident = await IncidentService.resolve(incident[0]._id, null);
                await ZapierService.pushToZapier('incident_resolve', incident);
            }
        }
        else {
            await MonitorService.setMonitorTime(monitor._id, 0, 'offline');
            var incidents = await IncidentService.findBy({ monitorId: monitor._id, resolved: false, manuallyCreated:false, createdByZapier: false });
            if (!incidents.length) {
                incident = await IncidentService.create({ monitorId: monitor._id, projectId: monitor.projectId });
                await ZapierService.pushToZapier('incident_created', incident);
            } else {
                incidents.forEach(async (incident)=>{
                    var alerts = await AlertService.findBy({incidentId: incident._id}, 0, 10, -1);
                    let lastAlert = alerts[0];

                    if (lastAlert) {
                        var interval = await AlertService.getSendIncidentInterval(incident);
                        let lastTimeSent = new Date(lastAlert['createdAt']);
                        let currentTime = new Date();
                        let timeDiffMills = currentTime - lastTimeSent;
                        let timeDiffHrs = Math.floor((timeDiffMills % 86400000) / 3600000); // hours
                        let timeDiffMin = Math.round(((timeDiffMills % 86400000) % 3600000) / 60000); // minutes
                        let timeDifference = timeDiffHrs * 60 + timeDiffMin;

                        if (timeDifference >= interval) {
                            await AlertService.sendIncidentCreated(incident);
                        }
                    }
                });
            }
        }
    } catch (error) {
        ErrorService.log('pingCron.job', error);
        throw error;
    }
};

var pingfunction = (url) => {
    var deffered = Q.defer();
    tcpp.ping({ address: url, timeout: 5000, attempts: 3 }, function (err, res) {
        if (err) {
            ErrorService.log(err);
        } else {
            deffered.resolve(res.avg);
        }
    });
    return deffered.promise;
};

var pingfetch = (url, now) => {
    var deffered = Q.defer();
    fetch(url, { timeout: 5000 })
        .then(() =>{
            deffered.resolve((new Date()).getTime() - now);
        })
        .catch(() => {
            deffered.resolve(undefined);
        });
    return deffered.promise;
};
