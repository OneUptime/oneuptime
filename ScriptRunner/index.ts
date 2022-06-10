import { ExpressApplication } from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';
import cron from 'node-cron';
import main from './workers/main';
import ScriptAPI from './api/script';

export const APP_NAME: string = 'script';
const app: ExpressApplication = App(APP_NAME);

app.use(`/${APP_NAME}`, ScriptAPI);

const cronMinuteStartTime: $TSFixMe = Math.floor(Math.random() * 50);

// Script monitor cron job
cron.schedule('* * * * *', () => {
    setTimeout(() => {
        return main.runScriptMonitorsJob();
    }, cronMinuteStartTime * 1000);
});
