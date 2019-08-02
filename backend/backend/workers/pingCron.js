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
        var date = new Date(new Date().getTime() - (60 * 1000));
        try{
            var monitors = await MonitorService.getAllMonitorsPing(date);
        }catch(error){
            ErrorService.log('MonitorService.getAllMonitorsPing', error);
            throw error;
        }
        if(monitors){
            await Promise.all(monitors.map(async(monitor) => {
                var url = monitor.data && monitor.data.url ? (monitor.data.url.split('://').length > 1 ? monitor.data.url.split('://')[1] : monitor.data.url) : null;

                //trim "/"
                if (url && url.endsWith('/')) {
                    url = url.substring(0, url.length - 1);
                }

                if (!url) return;

                if (url.split('/').length > 1) {
                    try{
                        var res = await pingfetch(monitor.data.url, (new Date()).getTime());
                    }catch(error){
                        ErrorService.log('pingCron.pingFetch', error);
                        throw error;
                    }
                    try{
                        await job(monitor, res);
                    }catch(error){
                        ErrorService.log('pingCron.job', error);
                        throw error;
                    }
                } else {
                    try{
                        var res1 = await pingfunction(url);
                    }catch(error){
                        ErrorService.log('pingCron.pingfunction', error);
                        throw error;
                    }
                    try{
                        await job(monitor, res1);
                    }catch(error){
                        ErrorService.log('pingCron.job', error);
                        throw error;
                    }
                }
            }));
        } else {
            return;
        }
    }
};


var job = async (monitor, res) => {
    if (res && !isNaN(res)) {
        try{
            await MonitorService.setMonitorTime(monitor._id, res, 'online');
        }catch(error){
            ErrorService.log('MonitorService.setMonitorTime', error);
            throw error;
        }
        var incident = await IncidentService.findBy({ monitorId: monitor._id, resolved: false, manuallyCreated:false, createdByZapier: false });
        if (incident.length) {
            incident = await IncidentService.resolve(incident[0]._id, null);
            await ZapierService.pushToZapier('incident_resolve', incident);
        }
    }
    else {
        try{
            await MonitorService.setMonitorTime(monitor._id, 0, 'offline');
        }catch(error){
            ErrorService.log('MonitorService.setMonitorTime', error);
            throw error;
        }
        try{
            var incidents = await IncidentService.findBy({ monitorId: monitor._id, resolved: false, manuallyCreated:false, createdByZapier: false });
        }catch(error){
            ErrorService.log('IncidentService.findBy', error);
            throw error;
        }
        if (!incidents.length) {
            try{
                incident = await IncidentService.create({ monitorId: monitor._id, projectId: monitor.projectId });
            }catch(error){
                ErrorService.log('IncidentService.create', error);
                throw error;
            }
            try{
                await ZapierService.pushToZapier('incident_created', incident);
            }catch(error){
                ErrorService.log('ZapierService.pushToZapier', error);
                throw error;
            }
        }else{
            incidents.forEach(async (incident)=>{
                try{
                    var alerts = await AlertService.findBy({incidentId: incident._id}, 0, 10, -1);
                }catch(error){
                    ErrorService.log('AlertService.findBy', error);
                    throw error;
                }
                let lastAlert = alerts[0];
                if(lastAlert){
                    try{
                        var interval = await AlertService.getSendIncidentInterval(incident);
                    }catch(error){
                        ErrorService.log('AlertService.getSendIncidentInterval', error);
                        throw error;
                    }
                    let lastTimeSent = new Date(lastAlert['createdAt']);
                    let currentTime = new Date();
                    let timeDiffMills = currentTime - lastTimeSent;
                    let timeDiffHrs = Math.floor((timeDiffMills % 86400000) / 3600000); // hours
                    let timeDiffMin = Math.round(((timeDiffMills % 86400000) % 3600000) / 60000); // minutes
                    let timeDifference = timeDiffHrs * 60 + timeDiffMin;
                    if(timeDifference >= interval){
                        try{
                            await AlertService.sendIncidentCreated(incident);
                        }catch(error){
                            ErrorService.log('AlertService.sendIncidentCreated', error);
                            throw error;
                        }
                    }
                }
            });
        }
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