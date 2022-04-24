import app from 'CommonServer/Utils/StartServer';

// API
import ProbeAPI from './API/Probe';

// Attach to the app.
app.use(['/probeapi/probe', '/probe'], ProbeAPI);

export default app;
