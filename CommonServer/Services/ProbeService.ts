import Model from 'Common/Models/Probe';
import DatabaseService from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import Version from 'Common/Types/Version';
import OneUptimeDate from 'Common/Types/Date';

class Service extends DatabaseService<Model> {
    public constructor() {
        super(Model);
    }

    public async updateProbeKeyByName(
        name: string,
        key: ObjectID
    ): Promise<void> {
        await this.updateOneBy({
            query: {
                name: name
            },
            data: {
                key
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
                lastAlive: OneUptimeDate.getCurrentDate()
            },
        });
    }
}

export default new Service();
