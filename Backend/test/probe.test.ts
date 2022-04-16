process.env.PORT = 3020;
import { expect } from 'chai';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import chaiSubset from 'chai-subset';
chai.use(chaiSubset);
import app from '../server';
import userData from './data/user';

import { newProject } from './data/project';
import gitCredential from './data/gitCredential';
import dockerCredential from './data/dockerCredential';

import { createUser } from './utils/userSignUp';
import VerificationTokenModel from '../backend/models/verificationToken';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';

const request: $TSFixMe = chai.request.agent(app);
import ProbeService from '../backend/services/probeService';
import MonitorService from '../backend/services/monitorService';
import ComponentService from '../backend/services/componentService';
import GitCredentialService from '../backend/services/gitCredentialService';
import ApplicationSecurityService from '../backend/services/applicationSecurityService';
import DockerCredentialService from '../backend/services/dockerCredentialService';
import ContainerSecurityService from '../backend/services/containerSecurityService';
let probeId: $TSFixMe;
import GlobalConfig from './utils/globalConfig';
import AirtableService from '../backend/services/airtableService';
let token: $TSFixMe,
    userId: $TSFixMe,
    projectId: ObjectID,
    componentId: $TSFixMe;
const probeKey: string = 'test-key';
const sleep: Function = (waitTimeInMs: $TSFixMe): void => {
    return new Promise((resolve: $TSFixMe) => {
        setTimeout(resolve, waitTimeInMs);
    });
};
const generateRandomString: $TSFixMe =
    require('./utils/string').generateRandomString;
const probeServerRequestHeader: Function = ({
    probeName,
    probeKey,
    clusterKey,
}: $TSFixMe): void => {
    return {
        'Access-Control-Allow-Origin': '*',
        Accept: 'application/json',
        'Content-Type': 'application/json;charset=UTF-8',
        probeName,
        probeKey,
        clusterKey,
    };
};
let probeServerName1: $TSFixMe, probeServerName2: $TSFixMe;

describe('Probe API', function (): void {
    this.timeout(20000);

    before(async function (): void {
        this.timeout(40000);
        await GlobalConfig.initTestConfig();
        // Remove every monitor in DB
        await MonitorService.hardDeleteBy({});

        const user: $TSFixMe = await UserService.create({
            ...userData.user,
            role: 'master-admin',
        });

        const project: $TSFixMe = await ProjectService.create({
            name: 'New Test Project',
            userId: user._id,
            stripePlanId: newProject.stripePlanId,
            stripeSubscriptionId: newProject.stripeSubscriptionId,
        });
        projectId = project._id;

        const component: $TSFixMe = await ComponentService.create({
            name: 'New Test Component',
            projectId,
        });
        componentId = component._id;

        const response: $TSFixMe = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });

        token = response.body.tokens.jwtAccessToken;
        return Promise.resolve();
    });

    after(async (): void => {
        await GlobalConfig.removeTestConfig();
        await ProbeService.hardDeleteBy({ _id: probeId });
        await ProjectService.hardDeleteBy({ _id: projectId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        await ComponentService.hardDeleteBy({ _id: componentId });
        await GitCredentialService.hardDeleteBy({ projectId });
        await ApplicationSecurityService.hardDelete({ componentId });
        await DockerCredentialService.hardDeleteBy({ projectId });
        await ContainerSecurityService.hardDelete({ componentId });
        await ProbeService.hardDeleteBy({
            probeName: {
                $in: [probeServerName1, probeServerName2],
            },
        });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should add a probe by admin', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const probeName: $TSFixMe = generateRandomString();
        request
            .post('/probe/')
            .set('Authorization', authorization)
            .send({
                probeName: probeName,
                probeKey: probeKey,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                probeId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.probeName).to.be.equal(probeName);
                done();
            });
    });

    it('should not add a probe if not admin', (done: $TSFixMe): void => {
        const probeName: $TSFixMe = generateRandomString();
        createUser(
            request,
            userData.newUser,
            (err: $TSFixMe, res: $TSFixMe): void => {
                userId = res.body.id;
                VerificationTokenModel.findOne(
                    { userId },
                    (err: $TSFixMe, verificationToken: $TSFixMe): void => {
                        request
                            .get(
                                `/user/confirmation/${verificationToken.token}`
                            )
                            .redirects(0)
                            .end((): void => {
                                request
                                    .post('/user/login')
                                    .send({
                                        email: userData.newUser.email,
                                        password: userData.newUser.password,
                                    })
                                    .end((err: $TSFixMe, res: $TSFixMe) => {
                                        const authorization: string = `Basic ${res.body.tokens.jwtAccessToken}`;
                                        request
                                            .post('/probe/')
                                            .set('Authorization', authorization)
                                            .send({
                                                probeName: probeName,
                                                probeKey: '',
                                            })
                                            .end(
                                                (
                                                    err: $TSFixMe,
                                                    res: $TSFixMe
                                                ) => {
                                                    expect(res).to.have.status(
                                                        400
                                                    );
                                                    done();
                                                }
                                            );
                                    });
                            });
                    }
                );
            }
        );
    });

    it('should reject a probe if same name already exists', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const probeName: $TSFixMe = generateRandomString();
        request
            .post('/probe/')
            .set('Authorization', authorization)
            .send({
                probeName: probeName,
                probeKey: probeKey,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                request
                    .post('/probe/')
                    .set('Authorization', authorization)
                    .send({
                        probeName: probeName,
                        probeKey: probeKey,
                    })
                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        expect(res).to.have.status(400);
                        done();
                    });
            });
    });

    it('should get probes', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get('/probe/')
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should delete a probe by admin', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const probeName: $TSFixMe = generateRandomString();
        request
            .post('/probe/')
            .set('Authorization', authorization)
            .send({
                probeName: probeName,
                probeKey: probeKey,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                probeId = res.body._id;
                expect(res).to.have.status(200);
                request
                    .delete(`/probe/${probeId}`)
                    .set('Authorization', authorization)
                    .send()
                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        expect(res).to.have.status(200);
                        done();
                    });
            });
    });

    it('should add to the database the unknown probe servers requesting the list of monitor to ping.', async (): void => {
        probeServerName1 = generateRandomString();
        const res: $TSFixMe = await request.get('/probe/monitors').set(
            probeServerRequestHeader({
                probeName: probeServerName1,
                probeKey,
                clusterKey: process.env.CLUSTER_KEY,
            })
        );
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');

        const probe: $TSFixMe = await ProbeService.findOneBy({
            query: { probeName: probeServerName1 },
            select: '_id',
        });
        expect(probe).to.not.eql(null);
    });

    it('should return the list of monitors of type "server-monitor" only time for one probe server during an interval of 1 min ', async function (): void {
        this.timeout(100000);
        const monitor: $TSFixMe = await MonitorService.create({
            projectId,
            componentId,
            name: generateRandomString(),
            type: 'server-monitor',
        });
        //Create a second probe server.
        probeServerName2 = generateRandomString();
        let res: $TSFixMe = await request.get('/probe/monitors').set(
            probeServerRequestHeader({
                probeName: probeServerName2,
                probeKey,
                clusterKey: process.env.CLUSTER_KEY,
            })
        );
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.equal(1);

        res = await request.get('/probe/monitors').set(
            probeServerRequestHeader({
                probeName: probeServerName1,
                probeKey,
                clusterKey: process.env.CLUSTER_KEY,
            })
        );
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.equal(0);

        await sleep(30000);
        res = await request.get('/probe/monitors').set(
            probeServerRequestHeader({
                probeName: probeServerName1,
                probeKey,
                clusterKey: process.env.CLUSTER_KEY,
            })
        );
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.equal(0);

        res = await request.get('/probe/monitors').set(
            probeServerRequestHeader({
                probeName: probeServerName2,
                probeKey,
                clusterKey: process.env.CLUSTER_KEY,
            })
        );
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.equal(0);

        await sleep(35000);
        res = await request.get('/probe/monitors').set(
            probeServerRequestHeader({
                probeName: probeServerName1,
                probeKey,
                clusterKey: process.env.CLUSTER_KEY,
            })
        );
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.equal(1);

        res = await request.get('/probe/monitors').set(
            probeServerRequestHeader({
                probeName: probeServerName2,
                probeKey,
                clusterKey: process.env.CLUSTER_KEY,
            })
        );
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.equal(0);

        //Deleting the monitor is necessary for the results of the next tests
        await MonitorService.hardDeleteBy({ _id: monitor._id });
    });

    it('should return the list of monitors of type "url" only 1 time for every probe server during an interval of 1 min', async function (): void {
        this.timeout(100000);
        const monitor: $TSFixMe = await MonitorService.create({
            projectId,
            componentId,
            name: generateRandomString(),
            type: 'url',
            data: {
                url: 'https://hackerbay.io',
            },
        });

        let res: $TSFixMe = await request.get('/probe/monitors').set(
            probeServerRequestHeader({
                probeName: probeServerName1,
                probeKey,
                clusterKey: process.env.CLUSTER_KEY,
            })
        );
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.equal(1);

        res = await request.get('/probe/monitors').set(
            probeServerRequestHeader({
                probeName: probeServerName2,
                probeKey,
                clusterKey: process.env.CLUSTER_KEY,
            })
        );
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.equal(1);

        await sleep(30000);
        res = await request.get('/probe/monitors').set(
            probeServerRequestHeader({
                probeName: probeServerName1,
                probeKey,
                clusterKey: process.env.CLUSTER_KEY,
            })
        );
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.equal(0);

        res = await request.get('/probe/monitors').set(
            probeServerRequestHeader({
                probeName: probeServerName2,
                probeKey,
                clusterKey: process.env.CLUSTER_KEY,
            })
        );
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.equal(0);

        await sleep(35000);
        res = await request.get('/probe/monitors').set(
            probeServerRequestHeader({
                probeName: probeServerName1,
                probeKey,
                clusterKey: process.env.CLUSTER_KEY,
            })
        );
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.equal(1);

        res = await request.get('/probe/monitors').set(
            probeServerRequestHeader({
                probeName: probeServerName2,
                probeKey,
                clusterKey: process.env.CLUSTER_KEY,
            })
        );
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body.count).to.equal(1);

        await MonitorService.hardDeleteBy({ _id: monitor._id });
    });

    it('should get application securities yet to be scanned or scanned 24hrs ago', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const probeName: string = 'US';
        const probeKey: string = '33b674ca-9fdd-11e9-a2a3-2a2ae2dbccez';
        const clusterKey: string = 'f414c23b4cdf4e84a6a66ecfd528eff2';

        GitCredentialService.create({
            gitUsername: gitCredential.gitUsername,
            gitPassword: gitCredential.gitPassword,
            projectId,
        }).then((credential: $TSFixMe): void => {
            const data: $TSFixMe = {
                name: 'Test',
                gitRepositoryUrl: gitCredential.gitRepositoryUrl,

                gitCredential: credential._id,
            };

            request
                .post(`/security/${projectId}/${componentId}/application`)
                .set('Authorization', authorization)
                .send(data)
                .end((): void => {
                    request
                        .get('/probe/applicationSecurities')
                        .set({
                            probeName,
                            probeKey,
                            clusterKey,
                        })
                        .end((err: $TSFixMe, res: $TSFixMe): void => {
                            expect(res).to.have.status(200);
                            expect(res.body).to.be.an('array');
                            done();
                        });
                });
        });
    });

    it('should get container securities yet to be scanned or scanned 24hrs ago', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const probeName: string = 'US';
        const probeKey: string = '33b674ca-9fdd-11e9-a2a3-2a2ae2dbccez';
        const clusterKey: string = 'f414c23b4cdf4e84a6a66ecfd528eff2';

        DockerCredentialService.create({
            dockerRegistryUrl: dockerCredential.dockerRegistryUrl,
            dockerUsername: dockerCredential.dockerUsername,
            dockerPassword: dockerCredential.dockerPassword,
            projectId,
        }).then((credential: $TSFixMe): void => {
            const data: $TSFixMe = {
                name: 'Test',
                dockerCredential: credential._id,
                imagePath: dockerCredential.imagePath,
                imageTags: dockerCredential.imageTags,
            };

            request
                .post(`/security/${projectId}/${componentId}/container`)
                .set('Authorization', authorization)
                .send(data)
                .end((): void => {
                    request
                        .get('/probe/containerSecurities')
                        .set({
                            probeName,
                            probeKey,
                            clusterKey,
                        })
                        .end((err: $TSFixMe, res: $TSFixMe): void => {
                            expect(res).to.have.status(200);
                            expect(res.body).to.be.an('array');
                            done();
                        });
                });
        });
    });
});
