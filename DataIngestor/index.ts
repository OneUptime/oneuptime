import app from 'CommonServer/utils/StartServer';

app.use(['/data-ingestor/probe', '/probe'], require('./api/probe'));

export default app;
