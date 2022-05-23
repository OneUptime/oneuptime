import app from 'CommonServer/Utils/StartServer';
import AuthenticationAPI from './API/AuthenticationAPI';

app.use('/v2', AuthenticationAPI);

export default app;
