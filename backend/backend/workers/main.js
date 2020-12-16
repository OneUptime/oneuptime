const cron = require('node-cron');
//const iotMonitorCron = require('./iotMonitor');
const escalationPolicy = require('./escalationPolicy');
const serverMonitorCron = require('./serverMonitor');
const subscription = require('./subscription');

// Generate a random number betwen 1 and 50 and use that to run cron jobs.
// This is done because there will be many instances of backend in production, and one instance of backend
// should run at a random second every minute so they dont collide.
const cronMinuteStartTime = Math.floor(Math.random() * 50);
const serverMonitorCronMinuteStartTime = Math.floor(Math.random() * 50);
const subscriptionCronMinutesStartTime = Math.floor(Math.random() * 50);

// Esclation Policy: This cron runs every minute
cron.schedule('* * * * *', () => {
    setTimeout(() => {
        escalationPolicy.checkActiveEscalationPolicyAndSendAlerts();
    }, cronMinuteStartTime * 1000);
});

// Server Monitor: This cron runs every minute
cron.schedule('* * * * *', () => {
    setTimeout(() => {
        serverMonitorCron.checkAllServerMonitors();
    }, serverMonitorCronMinuteStartTime * 1000);
});

cron.schedule('0 0 * * *', () => {
    setTimeout(
        () => subscription.handleUnpaidSubscription(),
        subscriptionCronMinutesStartTime * 1000
    );
});

// IoT Monitor: This cron runs every minute
// cron.schedule(`* * * * *`,() =>{
// setTimeout(()=>{
//     iotMonitorCron.checkAllDeviceMonitor();
// }, cronMinuteStartTime*1000);
// });
