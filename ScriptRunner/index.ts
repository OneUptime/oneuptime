import app from 'CommonServer/utils/StartServer';
import cron from 'node-cron';
import main from './workers/main';

// API

import ScriptAPI from './api/script';

app.use('/script', ScriptAPI);

const cronMinuteStartTime = Math.floor(Math.random() * 50);

// script monitor cron job
cron.schedule('* * * * *', () => {
    setTimeout(() => main.runScriptMonitorsJob(), cronMinuteStartTime * 1000);
});
