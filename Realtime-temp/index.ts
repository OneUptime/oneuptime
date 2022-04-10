import app from 'common-server/utils/StartServer';

app.use('/realtime', require('./api/realtime'));

export default app;
