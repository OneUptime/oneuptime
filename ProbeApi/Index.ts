import app from 'CommonServer/utils/StartServer';

// API
import ProbeAPI from './API/Probe';

// Attach to the app.
app.use(['/probeapi/probe', '/probe'], ProbeAPI);

export default app;
