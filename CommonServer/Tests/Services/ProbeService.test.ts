import '../TestingUtils/Init';
import ProbeService from '../../Services/ProbeService';
import Probe from 'Common/Models/Probe';
import Database from '../TestingUtils/Database';
import ObjectID from 'Common/Types/ObjectID';
import Version from 'Common/Types/Version';
import Faker from 'Common/Tests/TestingUtils/Faker';
import PositiveNumber from 'Common/Types/PositiveNumber';
import User from 'Common/Models/User';
import UserTestService from '../TestingUtils/Services/UserTestService';
import { DataSourceOptions } from 'typeorm';

describe('ProbeService', () => {
    let dataSourceOptions!: DataSourceOptions;  
    beforeEach(async () => {
        dataSourceOptions = await Database.createAndConnect();
    });

    afterEach(async () => {
        await Database.disconnectAndDropDatabase(dataSourceOptions);
    });

    test('create a new probe', async () => {
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.1');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await ProbeService.createProbe(
            name,
            key,
            probeVersion
        );

        expect(savedProbe.name).toEqual(name);
        expect(savedProbe.probeVersion.toString()).toEqual(
            probeVersion.toString()
        );
        expect(savedProbe.createdAt).toBeTruthy();
        expect(savedProbe.version).toBeTruthy();
        expect(savedProbe._id).toBeTruthy();
        expect(savedProbe.key.toString()).toEqual(key.toString());
    });

    test('findOneBy probe by name', async () => {
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.1');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await ProbeService.createProbe(
            name,
            key,
            probeVersion
        );

        const fetchedProbe: Probe | null = await ProbeService.findOneBy({
            query: {
                name: savedProbe.name,
            },
        });

        if (!fetchedProbe) {
            // fail the test.
            fail('Probe not found in the database');
        }

        expect(fetchedProbe.name).toEqual(name);
        expect(fetchedProbe._id).toEqual(savedProbe._id);
        expect(fetchedProbe.probeVersion.toString()).toEqual(
            probeVersion.toString()
        );
        expect(fetchedProbe.createdAt).toBeTruthy();
        expect(fetchedProbe.version).toBeTruthy();
        expect(fetchedProbe._id).toBeTruthy();
        expect(fetchedProbe.key.toString()).toEqual(key.toString());
    });

    test('findOneBy by probeVersion', async () => {
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await ProbeService.createProbe(
            name,
            key,
            probeVersion
        );

        const fetchedProbe: Probe | null = await ProbeService.findOneBy({
            query: {
                probeVersion: new Version('1.0.2'),
            },
        });

        if (!fetchedProbe) {
            // fail the test.
            fail('Probe not found in the database');
        }

        expect(fetchedProbe._id).toEqual(savedProbe._id);
        expect(fetchedProbe.name).toEqual(name);
        expect(fetchedProbe.probeVersion.toString()).toEqual(
            probeVersion.toString()
        );
        expect(fetchedProbe.createdAt).toBeTruthy();
        expect(fetchedProbe.version).toBeTruthy();
        expect(fetchedProbe._id).toBeTruthy();
        expect(fetchedProbe.key.toString()).toEqual(key.toString());
    });

    test('findOneBy by invalid name', async () => {
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        await ProbeService.createProbe(name, key, probeVersion);

        const fetchedProbe: Probe | null = await ProbeService.findOneBy({
            query: {
                name: name + '-invalid',
            },
        });

        expect(fetchedProbe).toBeNull();
    });

    test('findOneBy by key', async () => {
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await ProbeService.createProbe(
            name,
            key,
            probeVersion
        );

        const fetchedProbe: Probe | null = await ProbeService.findOneBy({
            query: {
                key: key,
            },
        });

        if (!fetchedProbe) {
            // fail the test.
            fail('Probe not found in the database');
        }

        expect(fetchedProbe._id).toEqual(savedProbe._id);
        expect(fetchedProbe.name).toEqual(name);
        expect(fetchedProbe.probeVersion.toString()).toEqual(
            probeVersion.toString()
        );
        expect(fetchedProbe.createdAt).toBeTruthy();
        expect(fetchedProbe.version).toBeTruthy();
        expect(fetchedProbe._id).toBeTruthy();
        expect(fetchedProbe.key.toString()).toEqual(key.toString());
    });

    test('findBy all entities', async () => {
        const name1: string = Faker.generateName();
        const probeVersion1: Version = new Version('1.0.2');
        const key1: ObjectID = ObjectID.generate();
        const savedProbe1: Probe = await ProbeService.createProbe(
            name1,
            key1,
            probeVersion1
        );

        const name2: string = Faker.generateName();
        const probeVersion2: Version = new Version('1.0.1');
        const key2: ObjectID = ObjectID.generate();
        const savedProbe2: Probe = await ProbeService.createProbe(
            name2,
            key2,
            probeVersion2
        );

        const fetchedProbes: Array<Probe> = await ProbeService.findBy({
            query: {},
            limit: new PositiveNumber(10),
            skip: new PositiveNumber(0),
        });

        if (fetchedProbes.length !== 2) {
            // fail the test.
            fail('Probe not found in the database');
        }

        expect(fetchedProbes[0]?._id).toEqual(savedProbe2._id);
        expect(fetchedProbes[0]?.name).toEqual(name2);
        expect(fetchedProbes[0]?.probeVersion.toString()).toEqual(
            probeVersion2.toString()
        );
        expect(fetchedProbes[0]?.createdAt).toBeTruthy();
        expect(fetchedProbes[0]?.version).toBeTruthy();
        expect(fetchedProbes[0]?._id).toBeTruthy();
        expect(fetchedProbes[0]?.key.toString()).toEqual(key2.toString());

        expect(fetchedProbes[1]?._id).toEqual(savedProbe1._id);
        expect(fetchedProbes[1]?.name).toEqual(name1);
        expect(fetchedProbes[1]?.probeVersion.toString()).toEqual(
            probeVersion1.toString()
        );
        expect(fetchedProbes[1]?.createdAt).toBeTruthy();
        expect(fetchedProbes[1]?.version).toBeTruthy();
        expect(fetchedProbes[1]?._id).toBeTruthy();
        expect(fetchedProbes[1]?.key.toString()).toEqual(key1.toString());
    });

    test('findBy limit', async () => {
        const savedProbes: Array<Probe> = [];

        for (let i: number = 0; i < 20; i++) {
            const name: string = Faker.generateName();
            const probeVersion: Version = new Version('1.0.2');
            const key: ObjectID = ObjectID.generate();
            savedProbes.push(
                await ProbeService.createProbe(name, key, probeVersion)
            );
        }

        const fetchedProbes: Array<Probe> = await ProbeService.findBy({
            query: {},
            limit: new PositiveNumber(10),
            skip: new PositiveNumber(0),
        });

        if (savedProbes.length !== 20) {
            // fail the test.
            fail('Probe not saved successfully');
        }

        if (fetchedProbes.length !== 10) {
            // fail the test.
            fail('Probe fetch limit breached');
        }

        for (let i: number = 0; i < fetchedProbes.length; i++) {
            expect(fetchedProbes[i]?._id).toEqual(savedProbes[19 - i]?._id);
            expect(fetchedProbes[i]?.name).toEqual(savedProbes[19 - i]?.name);
            expect(fetchedProbes[i]?.probeVersion.toString()).toEqual(
                savedProbes[19 - i]?.probeVersion.toString()
            );
            expect(fetchedProbes[i]?.createdAt).toBeTruthy();
            expect(fetchedProbes[i]?.version).toBeTruthy();
            expect(fetchedProbes[i]?._id).toBeTruthy();
            expect(fetchedProbes[i]?.key.toString()).toEqual(
                savedProbes[19 - i]?.key.toString()
            );
        }
    });

    test('findBy skip', async () => {
        const savedProbes: Array<Probe> = [];

        for (let i: number = 0; i < 20; i++) {
            const name: string = Faker.generateName();
            const probeVersion: Version = new Version('1.0.2');
            const key: ObjectID = ObjectID.generate();
            savedProbes.push(
                await ProbeService.createProbe(name, key, probeVersion)
            );
        }

        const fetchedProbes: Array<Probe> = await ProbeService.findBy({
            query: {},
            limit: new PositiveNumber(10),
            skip: new PositiveNumber(10),
        });

        if (savedProbes.length !== 20) {
            // fail the test.
            fail('Probe not saved successfully');
        }

        if (fetchedProbes.length !== 10) {
            // fail the test.
            fail('Probe fetch limit breached');
        }

        for (let i: number = 0; i < fetchedProbes.length; i++) {
            expect(fetchedProbes[i]?._id).toEqual(savedProbes[9 - i]?._id);
            expect(fetchedProbes[i]?.name).toEqual(savedProbes[9 - i]?.name);
            expect(fetchedProbes[i]?.probeVersion.toString()).toEqual(
                savedProbes[9 - i]?.probeVersion.toString()
            );
            expect(fetchedProbes[i]?.createdAt).toBeTruthy();
            expect(fetchedProbes[i]?.version).toBeTruthy();
            expect(fetchedProbes[i]?._id).toBeTruthy();
            expect(fetchedProbes[i]?.key.toString()).toEqual(
                savedProbes[9 - i]?.key.toString()
            );
        }
    });

    test('delete probe by query', async () => {
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await ProbeService.createProbe(
            name,
            key,
            probeVersion
        );

        expect(savedProbe).toBeTruthy();

        await ProbeService.deleteBy({
            query: {
                key: key,
            },
        });

        const fetchedProbe: Probe | null = await ProbeService.findOneBy({
            query: {
                key: key,
            },
        });

        expect(fetchedProbe).toBeNull();
    });

    test('hard delete probe by query', async () => {
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await ProbeService.createProbe(
            name,
            key,
            probeVersion
        );

        expect(savedProbe).toBeTruthy();

        await ProbeService.hardDeleteBy({
            query: {
                key: key,
            },
        });

        const fetchedProbe: Probe | null = await ProbeService.findOneBy({
            query: {
                key: key,
            },
        });

        expect(fetchedProbe).toBeNull();
    });

    test('update probe by query', async () => {
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await ProbeService.createProbe(
            name,
            key,
            probeVersion
        );

        expect(savedProbe).toBeTruthy();

        const updatedName: string = Faker.generateName();
        await ProbeService.updateBy({
            query: {
                key: key,
            },
            data: {
                name: updatedName,
            },
        });

        const fetchedProbe: Probe | null = await ProbeService.findOneBy({
            query: {
                key: key,
            },
        });

        expect(fetchedProbe).toBeTruthy();
        expect(fetchedProbe?.name).toBe(updatedName);
    });

    test('update probe by query', async () => {
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await ProbeService.createProbe(
            name,
            key,
            probeVersion
        );

        expect(savedProbe).toBeTruthy();

        const updatedName: string = Faker.generateName();
        await ProbeService.updateBy({
            query: {
                key: key,
            },
            data: {
                name: updatedName,
            },
        });

        const fetchedProbe: Probe | null = await ProbeService.findOneBy({
            query: {
                key: key,
            },
        });

        expect(fetchedProbe).toBeTruthy();
        expect(fetchedProbe?.name).toBe(updatedName);
    });

    test('slugify column', async () => {
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await ProbeService.createProbe(
            name,
            key,
            probeVersion
        );

        expect(savedProbe).toBeTruthy();
        expect(savedProbe.slug).toContain(name.toLowerCase() + '-');
    });

    test('add user to createdBy column', async () => {

        const user: User = await UserTestService.generateRandomUser();

        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();

        const savedProbe: Probe = await ProbeService.createProbe(
            name,
            key,
            probeVersion
        );

        savedProbe.createdByUser = user;
        const updatedProbe: Probe = await savedProbe.save();

        const findProbe = await ProbeService.findOneBy(
            {
                query: {
                    _id: updatedProbe._id
                }
            })

        expect(findProbe).toBeTruthy();
        expect(findProbe?.createdByUser?._id).toContain(user._id);
    });


    test('include user in relation', async () => {

        const user: User = await UserTestService.generateRandomUser();

        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();

        const savedProbe: Probe = await ProbeService.createProbe(
            name,
            key,
            probeVersion
        );

        savedProbe.createdByUser = user;
        const updatedProbe: Probe = await savedProbe.save();

        const findProbe = await ProbeService.findOneBy(
            {
                query: {
                    _id: updatedProbe._id
                },
                populate: {
                    deletedByUser: true
                }
            })

        expect(findProbe).toBeTruthy();
        expect(findProbe?.createdByUser?._id).toContain(user._id);
    });


   
});
