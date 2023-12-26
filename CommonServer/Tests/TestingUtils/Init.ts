process.env['NODE_ENV'] = 'test';
import '../../Utils/Environment';

import dotenv from 'dotenv';

dotenv.config({
    path: '../.env.test',
});

process.env['BILLING_ENABLED'] = 'true';

process.env['DATABASE_HOST'] = 'localhost';
process.env['DATABASE_PORT'] = '5400';

process.env['REDIS_HOST'] = 'localhost';
process.env['REDIS_PORT'] = '6379';
process.env['REDIS_DB'] = '0';
process.env['REDIS_USERNAME'] = 'default';
