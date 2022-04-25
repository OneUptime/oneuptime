import app from 'CommonServer/Utils/StartServer';

// API

import MailAPI from './API/Mail';

app.use(['/mail/email', '/email'], MailAPI);

export default app;
