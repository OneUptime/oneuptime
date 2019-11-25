/*const cron = require('node-cron');
var accumulateTime = require('./accumulateTimeCron');
var pingCron = require('./pingCron');
var deviceMonitorsCron = require('./deviceMonitorsCron');
var ManualMonitorCron = require('./manualMonitorCron');

// This cron runs every minute
cron.schedule('* * * * *',() =>{
    setTimeout(()=> pingCron.pingCron(),
        Math.floor(Math.random() * Math.floor(30))*1000);
});

// This cron runs every minute
cron.schedule('* * * * *',() =>{
    setTimeout(()=> ManualMonitorCron.manualPingCron(),
        Math.floor(Math.random() * Math.floor(30))*1000);
});

// This cron runs every minute
cron.schedule('* * * * *',() =>{
    setTimeout(()=> deviceMonitorsCron.checkAllDeviceMonitor(),
        Math.floor(Math.random() * Math.floor(30))*1000);
});

// cron runs everyday at midnight
cron.schedule('0 0 * * *',() =>{
    var yesterday = new Date(new Date().getTime() - (60 * 1000));
    setTimeout(()=> accumulateTime.accumulateTime(yesterday),
        Math.floor(Math.random() * Math.floor(30))*1000);
});
*/