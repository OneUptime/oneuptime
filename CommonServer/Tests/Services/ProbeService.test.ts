import ProbeService from '../../Services/ProbeService';
import Probe from 'Common/Models/Probe';
import Database from '../TestingUtils/Database';
import ObjectID from 'Common/Types/ObjectID';
import Version from 'Common/Types/Version';

describe('ProbeService', () => {
    beforeAll(async () => {
        await Database.connect();
    })
    test('create a new probe', async () => {

        const probe: Probe = new Probe();
        probe.name = "Name"; 
        probe.key = ObjectID.generate();
        probe.probeVersion = new Version("1.0.0");
        const savedProbe = await ProbeService.create({ data: probe });

        expect(savedProbe.name).toEqual(probe.name);
        expect(savedProbe.probeVersion.toString()).toEqual(probe.probeVersion.toString());
        expect(probe.id).toBeTruthy();
        expect(probe.key.toString()).toEqual(probe.key.toString());

    });
});
