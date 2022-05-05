import dotenv from 'dotenv';
import AppEnvironment from 'Common/Types/AppEnvironment';

const Env: string = process.env['NODE_ENV'] || '';

if (Env === AppEnvironment.Development || Env === AppEnvironment.Test) {
    /*
     * Load env vars from /.env, do this only on development.
     * Production values are supplied by Kubernetes Helm charts or docker compose files.
     */
    dotenv.config();

    if (Env === AppEnvironment.Test) {
        dotenv.config({
            path: '../test.env',
        });
    }
}
