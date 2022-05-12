import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Common/Models/Probe';
import DatabaseService from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import Version from 'Common/Types/Version';
import OneUptimeDate from 'Common/Types/Date';

export default class Service extends DatabaseService<Model> {
    public constructor(database: PostgresDatabase) {
        super(Model, database);
    }

    public async createProbe(
        name: string,
        key?: ObjectID,
        version?: Version
    ): Promise<Model> {
        if (!key) {
            key = ObjectID.generate();
        }

        if (!version) {
            version = new Version('1.0.0');
        }

        const probe: Model = new Model();
        probe.name = name;
        probe.key = key;
        probe.probeVersion = version;
        const savedProbe: Model = await this.create({ data: probe });
        return savedProbe;

    }

    public async updateProbeKeyByName(
        name: string,
        key: ObjectID
    ): Promise<void> {
        await this.updateOneBy({
            query: {
                name: name,
            },
            data: {
                key,
            },
        });
    }

    public async updateProbeVersionByName(
        name: string,
        version: Version
    ): Promise<void> {
        await this.updateOneBy({
            query: { name },
            data: { probeVersion: version },
        });
    }

    public async updateLastAlive(name: string): Promise<void> {
        await this.updateOneBy({
            query: { name },
            data: {
                lastAlive: OneUptimeDate.getCurrentDate(),
            },
        });
    }
}
