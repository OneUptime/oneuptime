import dotenv from 'dotenv';

const { NODE_ENV } = process.env;
if (!NODE_ENV || NODE_ENV === 'development') {
    // Load env vars from /.env, do this only on development. 
    // Production values are supplied by Kubernetes Helm charts. 
    dotenv.config();
}