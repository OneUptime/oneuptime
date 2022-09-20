import '../TestingUtils/Init';
import { Service as ProbeService } from '../../Services/ProbeService';
import Probe from 'Model/Models/Probe';
import Database from '../TestingUtils/Database';
import ObjectID from 'Common/Types/ObjectID';
import Version from 'Common/Types/Version';
import Faker from 'Common/Utils/Faker';
import PositiveNumber from 'Common/Types/PositiveNumber';
import User from 'Model/Models/User';
import UserTestService from '../TestingUtils/Services/UserTestService';
import { fail } from 'assert';

describe('probeService', () => {
    let database!: Database;
    beforeEach(async () => {
        database = new Database();
        await database.createAndConnect();
    });

    afterEach(async () => {
        await database.disconnectAndDropDatabase();
    });

    test('create a new probe', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.1');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await probeService.createProbe(
            name,
            key,
            probeVersion,
            {
                isRoot: true,
            }
        );

        expect(savedProbe.name).toEqual(name);
        expect(savedProbe.probeVersion?.toString()).toEqual(
            probeVersion?.toString()
        );
        expect(savedProbe.createdAt).toBeTruthy();
        expect(savedProbe.version).toBeTruthy();
        expect(savedProbe._id).toBeTruthy();
        expect(savedProbe.key?.toString()).toEqual(key?.toString());
    });

    test('findOneBy probe by name', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.1');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await probeService.createProbe(
            name,
            key,
            probeVersion,
            {
                isRoot: true,
            }
        );

        if (!savedProbe.name) {
            fail('savedprobe name is null');
        }

        const fetchedProbe: Probe | null = await probeService.findOneBy({
            query: {
                name: savedProbe.name,
            },
            select: {
                _id: true,
                name: true,
                version: true,
                probeVersion: true,
                createdAt: true,
                key: true,
            },
            props: { isRoot: true },
        });

        if (!fetchedProbe) {
            // fail the test.
            fail('Probe not found in the database');
        }

        expect(fetchedProbe.name).toEqual(name);
        expect(fetchedProbe._id).toEqual(savedProbe._id);
        expect(fetchedProbe.probeVersion?.toString()).toEqual(
            probeVersion?.toString()
        );
        expect(fetchedProbe.createdAt).toBeTruthy();
        expect(fetchedProbe.version).toBeTruthy();
        expect(fetchedProbe._id).toBeTruthy();
        expect(fetchedProbe.key?.toString()).toEqual(key?.toString());
    });

    test('findOneBy by probeVersion', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await probeService.createProbe(
            name,
            key,
            probeVersion,
            {
                isRoot: true,
            }
        );

        const fetchedProbe: Probe | null = await probeService.findOneBy({
            query: {
                probeVersion: new Version('1.0.2'),
            },
            select: {
                _id: true,
                name: true,
                version: true,
                probeVersion: true,
                createdAt: true,
                key: true,
            },
            props: { isRoot: true },
        });

        if (!fetchedProbe) {
            // fail the test.
            fail('Probe not found in the database');
        }

        expect(fetchedProbe._id).toEqual(savedProbe._id);
        expect(fetchedProbe.name).toEqual(name);
        expect(fetchedProbe.probeVersion?.toString()).toEqual(
            probeVersion?.toString()
        );
        expect(fetchedProbe.createdAt).toBeTruthy();
        expect(fetchedProbe.version).toBeTruthy();
        expect(fetchedProbe._id).toBeTruthy();
        expect(fetchedProbe.key?.toString()).toEqual(key?.toString());
    });

    test('findOneBy by invalid name', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        await probeService.createProbe(name, key, probeVersion, {
            isRoot: true,
        });

        const fetchedProbe: Probe | null = await probeService.findOneBy({
            query: {
                name: name + '-invalid',
            },
            select: {
                _id: true,
                name: true,
                version: true,
                probeVersion: true,
                createdAt: true,
                key: true,
            },
            props: { isRoot: true },
        });

        expect(fetchedProbe).toBeNull();
    });

    test('select columns should work', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        await probeService.createProbe(name, key, probeVersion, {
            isRoot: true,
        });

        const fetchedProbe: Probe | null = await probeService.findOneBy({
            query: {
                name: name,
            },
            select: {
                _id: true,
                name: true,
            },
            props: { isRoot: true },
        });

        expect(fetchedProbe).toBeTruthy();
        expect(fetchedProbe!.name).toBe(name);
        expect(fetchedProbe?._id).toBeTruthy();
        expect(fetchedProbe?.key).toBeFalsy();
        expect(fetchedProbe?.createdAt).toBeTruthy(); // this is the default column and it should be always truthy
        expect(fetchedProbe?.createdByUserId).toBeFalsy();
        expect(fetchedProbe?.probeVersion).toBeFalsy();
    });

    test('findOneBy by key', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await probeService.createProbe(
            name,
            key,
            probeVersion,
            { isRoot: true }
        );

        const fetchedProbe: Probe | null = await probeService.findOneBy({
            query: {
                key: key,
            },
            select: {
                _id: true,
                name: true,
                version: true,
                probeVersion: true,
                createdAt: true,
                key: true,
            },
            props: { isRoot: true },
        });

        if (!fetchedProbe) {
            // fail the test.
            fail('Probe not found in the database');
        }

        expect(fetchedProbe._id).toEqual(savedProbe._id);
        expect(fetchedProbe.name).toEqual(name);
        expect(fetchedProbe.probeVersion?.toString()).toEqual(
            probeVersion?.toString()
        );
        expect(fetchedProbe.createdAt).toBeTruthy();
        expect(fetchedProbe.version).toBeTruthy();
        expect(fetchedProbe._id).toBeTruthy();
        expect(fetchedProbe.key?.toString()).toEqual(key?.toString());
    });

    test('findBy all entities', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const name1: string = Faker.generateName();
        const probeVersion1: Version = new Version('1.0.2');
        const key1: ObjectID = ObjectID.generate();
        const savedProbe1: Probe = await probeService.createProbe(
            name1,
            key1,
            probeVersion1,
            {
                isRoot: true,
            }
        );

        const name2: string = Faker.generateName();
        const probeVersion2: Version = new Version('1.0.1');
        const key2: ObjectID = ObjectID.generate();
        const savedProbe2: Probe = await probeService.createProbe(
            name2,
            key2,
            probeVersion2,
            {
                isRoot: true,
            }
        );

        const fetchedProbes: Array<Probe> = await probeService.findBy({
            query: {},
            select: {
                _id: true,
                name: true,
                version: true,
                probeVersion: true,
                createdAt: true,
                key: true,
            },
            limit: new PositiveNumber(10),
            skip: new PositiveNumber(0),
            props: { isRoot: true },
        });

        if (fetchedProbes.length !== 2) {
            // fail the test.
            fail('Probe not found in the database');
        }

        expect(fetchedProbes[0]?._id).toEqual(savedProbe2._id);
        expect(fetchedProbes[0]?.name).toEqual(name2);
        expect(fetchedProbes[0]?.probeVersion?.toString()).toEqual(
            probeVersion2.toString()
        );
        expect(fetchedProbes[0]?.createdAt).toBeTruthy();
        expect(fetchedProbes[0]?.version).toBeTruthy();
        expect(fetchedProbes[0]?._id).toBeTruthy();
        expect(fetchedProbes[0]?.key?.toString()).toEqual(key2.toString());

        expect(fetchedProbes[1]?._id).toEqual(savedProbe1._id);
        expect(fetchedProbes[1]?.name).toEqual(name1);
        expect(fetchedProbes[1]?.probeVersion?.toString()).toEqual(
            probeVersion1.toString()
        );
        expect(fetchedProbes[1]?.createdAt).toBeTruthy();
        expect(fetchedProbes[1]?.version).toBeTruthy();
        expect(fetchedProbes[1]?._id).toBeTruthy();
        expect(fetchedProbes[1]?.key?.toString()).toEqual(key1.toString());
    });

    test('findBy limit', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const savedProbes: Array<Probe> = [];

        for (let i: number = 0; i < 20; i++) {
            const name: string = Faker.generateName();
            const probeVersion: Version = new Version('1.0.2');
            const key: ObjectID = ObjectID.generate();
            savedProbes.push(
                await probeService.createProbe(name, key, probeVersion, {
                    isRoot: true,
                })
            );
        }

        const fetchedProbes: Array<Probe> = await probeService.findBy({
            query: {},
            select: {
                _id: true,
                name: true,
                version: true,
                probeVersion: true,
                createdAt: true,
                key: true,
            },
            limit: new PositiveNumber(10),
            skip: new PositiveNumber(0),
            props: { isRoot: true },
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
            expect(fetchedProbes[i]?.probeVersion?.toString()).toEqual(
                savedProbes[19 - i]?.probeVersion?.toString()
            );
            expect(fetchedProbes[i]?.createdAt).toBeTruthy();
            expect(fetchedProbes[i]?.version).toBeTruthy();
            expect(fetchedProbes[i]?._id).toBeTruthy();
            expect(fetchedProbes[i]?.key?.toString()).toEqual(
                savedProbes[19 - i]?.key?.toString()
            );
        }
    });

    test('findBy skip', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const savedProbes: Array<Probe> = [];

        for (let i: number = 0; i < 20; i++) {
            const name: string = Faker.generateName();
            const probeVersion: Version = new Version('1.0.2');
            const key: ObjectID = ObjectID.generate();
            savedProbes.push(
                await probeService.createProbe(name, key, probeVersion, {
                    isRoot: true,
                })
            );
        }

        const fetchedProbes: Array<Probe> = await probeService.findBy({
            query: {},
            select: {
                _id: true,
                name: true,
                version: true,
                probeVersion: true,
                createdAt: true,
                key: true,
            },
            limit: new PositiveNumber(10),
            skip: new PositiveNumber(10),
            props: { isRoot: true },
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
            expect(fetchedProbes[i]?.probeVersion?.toString()).toEqual(
                savedProbes[9 - i]?.probeVersion?.toString()
            );
            expect(fetchedProbes[i]?.createdAt).toBeTruthy();
            expect(fetchedProbes[i]?.version).toBeTruthy();
            expect(fetchedProbes[i]?._id).toBeTruthy();
            expect(fetchedProbes[i]?.key?.toString()).toEqual(
                savedProbes[9 - i]?.key?.toString()
            );
        }
    });

    test('delete probe by query', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await probeService.createProbe(
            name,
            key,
            probeVersion,
            {
                isRoot: true,
            }
        );

        expect(savedProbe).toBeTruthy();

        await probeService.deleteBy({
            query: {
                key: key,
            },

            props: { isRoot: true },
        });

        const fetchedProbe: Probe | null = await probeService.findOneBy({
            query: {
                key: key,
            },
            select: {
                _id: true,
                name: true,
                version: true,
                probeVersion: true,
                createdAt: true,
                key: true,
            },
            props: { isRoot: true },
        });

        expect(fetchedProbe).toBeNull();
    });

    test('update probe by query', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await probeService.createProbe(
            name,
            key,
            probeVersion,
            {
                isRoot: true,
            }
        );

        expect(savedProbe).toBeTruthy();

        const updatedName: string = Faker.generateName();
        await probeService.updateBy({
            query: {
                key: key,
            },
            data: {
                name: updatedName,
            },
            props: { isRoot: true },
        });

        const fetchedProbe: Probe | null = await probeService.findOneBy({
            query: {
                key: key,
            },
            select: {
                _id: true,
                name: true,
                version: true,
                probeVersion: true,
                createdAt: true,
                key: true,
            },
            props: { isRoot: true },
        });

        expect(fetchedProbe).toBeTruthy();
        expect(fetchedProbe?.name).toBe(updatedName);
    });

    test('update probe by query', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await probeService.createProbe(
            name,
            key,
            probeVersion,
            {
                isRoot: true,
            }
        );

        expect(savedProbe).toBeTruthy();

        const updatedName: string = Faker.generateName();
        await probeService.updateBy({
            query: {
                key: key,
            },
            data: {
                name: updatedName,
            },
            props: { isRoot: true },
        });

        const fetchedProbe: Probe | null = await probeService.findOneBy({
            query: {
                key: key,
            },
            select: {
                _id: true,
                name: true,
                version: true,
                probeVersion: true,
                createdAt: true,
                key: true,
            },
            props: { isRoot: true },
        });

        expect(fetchedProbe).toBeTruthy();
        expect(fetchedProbe?.name).toBe(updatedName);
    });

    test('slugify column', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();
        const savedProbe: Probe = await probeService.createProbe(
            name,
            key,
            probeVersion,
            {
                isRoot: true,
            }
        );

        expect(savedProbe).toBeTruthy();
        expect(savedProbe.slug).toContain(name.toLowerCase() + '-');
    });

    test('add user to createdBy column', async () => {
        const userTestService: UserTestService = new UserTestService(
            database.getDatabase()
        );
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const user: User = await userTestService.generateRandomUser();

        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();

        const savedProbe: Probe = await probeService.createProbe(
            name,
            key,
            probeVersion,
            {
                isRoot: true,
            }
        );

        savedProbe.createdByUser = user;
        const updatedProbe: Probe = await savedProbe.save();

        if (!updatedProbe._id) {
            fail('updatedProbe._id is null');
        }

        const findProbe: Probe | null = await probeService.findOneBy({
            query: {
                _id: updatedProbe._id,
            },
            select: {
                _id: true,
                name: true,
                version: true,
                probeVersion: true,
                createdAt: true,
                key: true,
                createdByUserId: true,
            },
            props: { isRoot: true },
        });

        expect(findProbe).toBeTruthy();
        expect(findProbe?.createdByUserId?.toString()).toContain(user._id);
    });

    test('include user in relation', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const userTestService: UserTestService = new UserTestService(
            database.getDatabase()
        );
        const user: User = await userTestService.generateRandomUser();

        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();

        const savedProbe: Probe = await probeService.createProbe(
            name,
            key,
            probeVersion,
            {
                isRoot: true,
            }
        );

        savedProbe.createdByUser = user;
        const updatedProbe: Probe = await savedProbe.save();

        if (!updatedProbe._id) {
            fail('updatedProbe._id not found');
        }

        const findProbe: Probe | null = await probeService.findOneBy({
            query: {
                _id: updatedProbe._id,
            },
            select: {
                _id: true,
                name: true,
                version: true,
                probeVersion: true,
                createdAt: true,
                key: true,
            },
            populate: {
                createdByUser: {
                    _id: true,
                    name: true,
                },
            },
            props: { isRoot: true },
        });

        expect(findProbe).toBeTruthy();
        expect(findProbe?.createdByUser?._id).toContain(user._id);
        expect(findProbe?.createdByUser?.name?.toString()).toBeTruthy();
        expect(user.name?.toString()).toBeTruthy();
        expect(findProbe?.createdByUser?.name?.toString()).toContain(
            user.name?.toString()
        );
    });

    test('find a probe by user relation', async () => {
        const probeService: ProbeService = new ProbeService(
            database.getDatabase()
        );
        const userTestService: UserTestService = new UserTestService(
            database.getDatabase()
        );
        const user: User = await userTestService.generateRandomUser();

        const name: string = Faker.generateName();
        const probeVersion: Version = new Version('1.0.2');
        const key: ObjectID = ObjectID.generate();

        const savedProbe: Probe = await probeService.createProbe(
            name,
            key,
            probeVersion,
            {
                isRoot: true,
            }
        );

        savedProbe.createdByUser = user;
        const updatedProbe: Probe = await savedProbe.save();

        expect(updatedProbe).toBeTruthy();

        if (!user.id) {
            fail('user.id not found');
        }

        const findProbe: Probe | null = await probeService.findOneBy({
            query: {
                createdByUserId: user.id,
            },
            select: {
                _id: true,
                name: true,
                version: true,
                probeVersion: true,
                createdAt: true,
                key: true,
            },
            populate: {
                createdByUser: {
                    _id: true,
                    name: true,
                },
            },
            props: { isRoot: true },
        });

        expect(findProbe).toBeTruthy();
        expect(findProbe?.createdByUser?._id).toContain(user._id);
        expect(findProbe?.createdByUser?.name?.toString()).toContain(
            user.name?.toString()
        );
    });
});
