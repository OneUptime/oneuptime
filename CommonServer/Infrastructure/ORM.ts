import {
    DatabaseHost,
    DatabaseName,
    DatabasePassword,
    DatabasePort,
    DatabaseUsername,
} from '../Config';

import { DataSource, BaseEntity } from 'typeorm';

const AppDataSource = new DataSource({
    type: 'postgres',
    host: DatabaseHost.toString(),
    port: DatabasePort.toNumber(),
    username: DatabaseUsername,
    password: DatabasePassword,
    database: DatabaseName,
});

export default AppDataSource;

export interface Document extends BaseEntity {}

export interface RequiredFields extends Array<string> {}

export interface UniqueFields extends Array<string> {}

export interface EncryptedFields extends Array<string> {}
