process.env['NODE_ENV'] = 'test';
import '../../Utils/Envrionment';

import dotenv from 'dotenv';

dotenv.config({
    path: '../.env.test',
});
