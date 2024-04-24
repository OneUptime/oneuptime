// This class checks the status of all the datasources.

import DatabaseNotConnectedException from 'Common/Types/Exception/DatabaseNotConnectedException';
import Redis from './Redis';
import { PostgresAppInstance } from './PostgresDatabase';
import { ClickhouseAppInstance } from './ClickhouseDatabase';

export default class InfrastructureStatus {
    public static async checkStatus(data: {
        checkRedisStatus: boolean;
        checkPostgresStatus: boolean;
        checkClickhouseStatus: boolean;
    }): Promise<void> {
        if (data.checkRedisStatus) {
            if (!Redis.checkConnnectionStatus()) {
                throw new DatabaseNotConnectedException(
                    'Redis is not connected'
                );
            }
        }

        if (data.checkPostgresStatus) {
            if (!PostgresAppInstance.checkConnnectionStatus()) {
                throw new DatabaseNotConnectedException(
                    'Postgres is not connected'
                );
            }
        }

        if (data.checkClickhouseStatus) {
            if (!ClickhouseAppInstance.checkConnnectionStatus()) {
                throw new DatabaseNotConnectedException(
                    'Clickhouse is not connected'
                );
            }
        }
    }
}
