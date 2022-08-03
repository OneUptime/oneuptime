import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/Probe';
import DatabaseService from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import Version from 'Common/Types/Version';
import OneUptimeDate from 'Common/Types/Date';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public async createProbe(
        name: string,
        key?: ObjectID,
        version?: Version,
        props?: DatabaseCommonInteractionProps
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
        const savedProbe: Model = await this.create({
            data: probe,
            props: props || {},
        });
        return savedProbe;
    }

    public async updateProbeKeyByName(
        name: string,
        key: ObjectID,
        props?: DatabaseCommonInteractionProps
    ): Promise<void> {
        await this.updateOneBy({
            query: {
                name: name,
            },
            data: {
                key,
            },
            props: props || {},
        });
    }

    public async updateProbeVersionByName(
        name: string,
        version: Version,
        props?: DatabaseCommonInteractionProps
    ): Promise<void> {
        await this.updateOneBy({
            query: { name },
            data: { probeVersion: version },
            props: props || {},
        });
    }

    public async updateLastAlive(
        name: string,
        props?: DatabaseCommonInteractionProps
    ): Promise<void> {
        await this.updateOneBy({
            query: { name },
            data: {
                lastAlive: OneUptimeDate.getCurrentDate(),
            },
            props: props || {},
        });
    }
}

export default new Service();
