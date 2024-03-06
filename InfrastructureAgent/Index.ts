import BasicCron from 'CommonServer/Utils/BasicCron';

BasicCron({
    jobName: 'MonitorInfrastructure',
    options: {
        schedule: '*/5 * * * *',
        runOnStartup: true,
    },
    runFunction: async () => {
        
    }
})