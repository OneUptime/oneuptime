import app from 'CommonServer/Utils/StartServer';

// API

import MailAPI from './API/Mail';

app.use('/mail/email', MailAPI);

export default app;
