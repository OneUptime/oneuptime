import dotenv from 'dotenv';
import { Env } from '../Config';

if (Env === 'development') {
    /*
     * Load env vars from /.env, do this only on development.
     * Production values are supplied by Kubernetes Helm charts.
     */
    dotenv.config();
}
