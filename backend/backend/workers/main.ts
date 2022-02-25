import cron from 'node-cron'
//import iotMonitorCron from './iotMonitor'
import escalationPolicy from './escalationPolicy'
import serverMonitorCron from './serverMonitor'
import subscription from './subscription'
import scheduledEventService from '../services/scheduledEventService'
import certOrder from './certOrder'

// Generate a random number between 1 and 50 and use that to run cron jobs.
// This is done because there will be many instances of backend in production, and one instance of backend
// should run at a random second every minute so they dont collide.
const cronMinuteStartTime = Math.floor(Math.random() * 50);
const serverMonitorCronMinuteStartTime = Math.floor(Math.random() * 50);
const subscriptionCronMinutesStartTime = Math.floor(Math.random() * 50);
const certOrderCronMinuteStartTime = Math.floor(Math.random() * 50);

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

// ScheduledEvent: Create 'Started' Notes at event start time
cron.schedule('* * * * *', () => {
    setTimeout(() => {
        scheduledEventService.createScheduledEventStartedNote();
        scheduledEventService.createScheduledEventEndedNote();
    }, cronMinuteStartTime * 1000);
});

// check and request for cert every 6th hour
cron.schedule('0 */6 * * *', () => {
    setTimeout(() => {
        certOrder();
    }, certOrderCronMinuteStartTime * 1000);
});

// IoT Monitor: This cron runs every minute
// cron.schedule(`* * * * *`,() =>{
// setTimeout(()=>{
//     iotMonitorCron.checkAllDeviceMonitor();
// }, cronMinuteStartTime*1000);
// });
