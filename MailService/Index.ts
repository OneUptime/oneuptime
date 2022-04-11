import app from 'CommonServer/utils/StartServer';

app.use(['/Mail/probe', '/probe'], require('./api/probe'));

export default app;
