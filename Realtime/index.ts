import app from 'Common-server/utils/StartServer';

app.use('/realtime', require('./api/realtime'));

export default app;
