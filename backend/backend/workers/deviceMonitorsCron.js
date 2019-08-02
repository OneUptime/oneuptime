var moment = require('moment');
var MonitorService = require('../services/monitorService'),
    IncidentService = require('../services/incidentService'),
    ZapierService = require('../services/zapierService'),
    ErrorService = require('../services/errorService');

// it collects all IOT device monitors then check the last time they where pinged
// If the difference is greater than 2 minutes
// creates incident if a website is down and resolves it when they come back up
module.exports = {
    checkAllDeviceMonitor: async () => {
        var newDate = new moment();
        var resDate = new Date();
        try{
            var monitors = await MonitorService.getDeviceMonitorsPing();
        }catch(error){
            ErrorService.log('MonitorService.getDeviceMonitorsPing', error);
            throw error;
        }        
        if(monitors){
            monitors.forEach(async (monitor) => {
                var d = new moment(monitor.lastPingTime);

                if(newDate.diff(d, 'minutes') > 3) {
                    try{
                        var mon1 = await MonitorService.getMonitorTime(monitor._id, newDate);
                    }catch(error){
                        ErrorService.log('MonitorService.getMonitorTime', error);
                        throw error;
                    }        
                    if(mon1.status === 'online') {
                        try{
                            await job(monitor);
                        }catch(error){
                            ErrorService.log('DeviceMonitorsCron.job', error);
                            throw error;
                        }            
                    }
                } else {
                    var res = (new Date()).getTime() - resDate.getTime();
                    try{
                        var mon2 = await MonitorService.getMonitorTime(monitor._id, newDate);
                    }catch(error){
                        ErrorService.log('MonitorService.getMonitorTime', error);
                        throw error;
                    }        
                    if(mon2.status === 'offline') {
                        try{
                            await job(monitor, res);
                        }catch(error){
                            ErrorService.log('DeviceMonitorsCron.job', error);
                            throw error;
                        }            
                    }
                }
            });
        } else {
            return;
        }
    }
};

var job = async (monitor, res) => {
    if (res) {
        try{
            await MonitorService.setMonitorTime(monitor._id, res, 'online');
        }catch(error){
            ErrorService.log('MonitorService.setMonitorTime', error);
            throw error;
        }
        try{
            var incident = await IncidentService.findBy({ monitorId: monitor._id, createdById: null, resolved: false,manuallyCreated:false });
        }catch(error){
            ErrorService.log('IncidentService.findBy', error);
            throw error;
        }
        if (incident.length) {
            try{
                incident = await IncidentService.resolve({ incidentId: incident[0]._id }, null);
            }catch(error){
                ErrorService.log('IncidentService.resolve', error);
                throw error;
            }
            try{
                await ZapierService.pushToZapier('incident_resolve', incident);
            }catch(error){
                ErrorService.log('ZapierService.pushToZapier', error);
                throw error;
            }
        }
    } else {
        try{
            await MonitorService.setMonitorTime(monitor._id, 0, 'offline');
        }catch(error){
            ErrorService.log('MonitorService.setMonitorTime', error);
            throw error;
        }
        try{
            var incident1 = await IncidentService.findBy({ monitorId: monitor._id, createdById: null, resolved: false,manuallyCreated:false });
        }catch(error){
            ErrorService.log('IncidentService.findBy', error);
            throw error;
        }
        if (!incident1.length) {
            try{
                var incident2 = await IncidentService.create({ monitorId: monitor._id, projectId: monitor.projectId }, null);
            }catch(error){
                ErrorService.log('IncidentService.create', error);
                throw error;
            }
            try{
                ZapierService.pushToZapier('incident_created', incident2);
            }catch(error){
                ErrorService.log('ZapierService.pushToZapier', error);
                throw error;
            }
        }
    }
};
