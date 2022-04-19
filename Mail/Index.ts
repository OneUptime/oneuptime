import app from 'CommonServer/utils/StartServer';

// API

import MailAPI from './API/Mail'

app.use(['/mail/email', '/email'], MailAPI);

export default app;
