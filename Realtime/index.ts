import app from 'CommonServer/Utils/StartServer';

app.use('/realtime', require('./api/realtime'));

export default app;
