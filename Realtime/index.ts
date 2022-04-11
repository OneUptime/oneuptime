import app from 'CommonServer/utils/StartServer';

app.use('/realtime', require('./api/realtime'));

export default app;
