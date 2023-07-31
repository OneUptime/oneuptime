process.env['NODE_ENV'] = 'test';
import '../../Utils/Environment';

import dotenv from 'dotenv';

dotenv.config({
    path: '../.env.test',
});

process.env['DATABASE_HOST'] = 'localhost';
process.env['DATABASE_PORT'] = '5400';
