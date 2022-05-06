import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import ProbeService from "./ProbeService";
import UserService from './UserService';

const postgresDatabase: PostgresDatabase = new PostgresDatabase();
await postgresDatabase.connect(postgresDatabase.getDatasourceOptions());

export default {
    ProbeService: new ProbeService(postgresDatabase),
    UserService: new UserService(postgresDatabase)
}