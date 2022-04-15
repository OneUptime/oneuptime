process.env['PORT'] = 3020;

process.env['IS_SAAS_SERVICE'] = true;
import { expect } from 'chai';
import userData from './data/user';
import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';
import GlobalConfig from './utils/globalConfig';

const request: $TSFixMe = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import StatusService from '../backend/services/statusPageService';
import MonitorService from '../backend/services/monitorService';
import monitorLogService from '../backend/services/monitorLogService';
import ScheduledEventService from '../backend/services/scheduledEventService';
import ProjectService from '../backend/services/projectService';
import AirtableService from '../backend/services/airtableService';
import DomainVerificationService from '../backend/services/domainVerificationService';
import project from './data/project';

import VerificationTokenModel from '../backend/models/verificationToken';
import ComponentModel from '../backend/models/component';

// eslint-disable-next-line
let token: $TSFixMe,
    projectId: ObjectID,
    monitorId: $TSFixMe,
    resourceCategoryId: $TSFixMe,
    scheduledEventId: $TSFixMe,
    statusPageId: $TSFixMe,
    privateStatusPageId: $TSFixMe,
    userId: $TSFixMe,
    componentId: $TSFixMe;

const monitor: $TSFixMe = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};

const resourceCategory: $TSFixMe = {
    resourceCategoryName: 'New Monitor Category',
};

const now: $TSFixMe = new Date();
const today: $TSFixMe = now.toISOString();
const tomorrow: $TSFixMe = new Date(
    now.setDate(now.getDate() + 1)
).toISOString();
const scheduledEvent: $TSFixMe = {
    name: 'New scheduled Event',
    startDate: today,
    endDate: tomorrow,
    description: 'New scheduled Event description',
    showEventOnStatusPage: true,
    alertSubscriber: true,
    callScheduleOnEvent: true,
    monitorDuringEvent: false,
};

describe('Status API', function (): void {
    this.timeout(20000);

    before(function (done: $TSFixMe): void {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(async (): void => {
            createUser(
                request,
                userData.user,
                (err: $TSFixMe, res: $TSFixMe): void => {
                    if (err) {
                        throw err;
                    }
                    projectId = res.body.project._id;
                    userId = res.body.id;

                    VerificationTokenModel.findOne(
                        { userId },
                        (err: $TSFixMe): void => {
                            if (err) {
                                throw err;
                            }
                            request
                                .post('/user/login')
                                .send({
                                    email: userData.user.email,
                                    password: userData.user.password,
                                })
                                .end((err: $TSFixMe, res: $TSFixMe): void => {
                                    if (err) {
                                        throw err;
                                    }
                                    token = res.body.tokens.jwtAccessToken;
                                    const authorization: string = `Basic ${token}`;
                                    request
                                        .post(`/resourceCategory/${projectId}`)
                                        .set('Authorization', authorization)
                                        .send(resourceCategory)
                                        .end((err: $TSFixMe, res: $TSFixMe) => {
                                            if (err) {
                                                throw err;
                                            }
                                            resourceCategoryId = res.body._id;

                                            monitor.resourceCategory =
                                                resourceCategoryId;
                                            ComponentModel.create({
                                                name: 'New Component',
                                            }).then((component: $TSFixMe) => {
                                                componentId = component._id;
                                                request
                                                    .post(
                                                        `/monitor/${projectId}`
                                                    )
                                                    .set(
                                                        'Authorization',
                                                        authorization
                                                    )
                                                    .send({
                                                        ...monitor,
                                                        componentId,
                                                    })
                                                    .end(
                                                        (
                                                            err: $TSFixMe,
                                                            res: $TSFixMe
                                                        ) => {
                                                            if (err) {
                                                                throw err;
                                                            }
                                                            monitorId =
                                                                res.body._id;

                                                            scheduledEvent.monitors =
                                                                [monitorId];
                                                            request
                                                                .post(
                                                                    `/scheduledEvent/${projectId}`
                                                                )
                                                                .set(
                                                                    'Authorization',
                                                                    authorization
                                                                )
                                                                .send(
                                                                    scheduledEvent
                                                                )
                                                                .end(
                                                                    (
                                                                        err: $TSFixMe,
                                                                        res: $TSFixMe
                                                                    ) => {
                                                                        if (
                                                                            err
                                                                        ) {
                                                                            throw err;
                                                                        }
                                                                        scheduledEventId =
                                                                            res
                                                                                .body
                                                                                ._id;
                                                                        done();
                                                                    }
                                                                );
                                                        }
                                                    );
                                            });
                                        });
                                });
                        }
                    );
                }
            );
            // remove any domain to make sure we don't encounter
            // domain used in another project error
            await DomainVerificationService.hardDeleteBy({});
        });
    });

    after(async (): void => {
        await GlobalConfig.removeTestConfig();
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await ScheduledEventService.hardDeleteBy({ _id: scheduledEventId });
        await StatusService.hardDeleteBy({ projectId: projectId });
        await DomainVerificationService.hardDeleteBy({ projectId: projectId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    it('should not add status page if the page name is missing', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/StatusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should add status page', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/StatusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Status Page',
                links: [],
                title: 'Status Page title',
                description: 'status page description',
                copyright: 'status page copyright',
                projectId,
                monitors: [
                    {
                        monitor: monitorId,
                        description: 'Monitor Description.',
                        uptime: true,
                        memory: false,
                        cpu: false,
                        storage: false,
                        responseTime: false,
                        temperature: false,
                        runtime: false,
                    },
                ],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                statusPageId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should add private status page', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/StatusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Private Status Page',
                isPrivate: true,
                links: [],
                title: 'Private Status Page title',
                description: 'private status page description',
                copyright: 'private status page copyright',
                projectId,
                monitors: [
                    {
                        monitor: monitorId,
                        description: 'Monitor Description.',
                        uptime: true,
                        memory: false,
                        cpu: false,
                        storage: false,
                        responseTime: false,
                        temperature: false,
                        runtime: false,
                    },
                ],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                privateStatusPageId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('isPrivate');
                expect(res.body.isPrivate).to.equal(true);
                done();
            });
    });

    it('should get private status page for authorized user', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/StatusPage/${privateStatusPageId}`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should get valid private status page rss for authorized user', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/StatusPage/${privateStatusPageId}/rss`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should not get private status page for unauthorized user', (done: $TSFixMe): void => {
        request
            .get(`/StatusPage/${privateStatusPageId}`)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should not update status page settings when domain is not string', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .put(`/StatusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send({
                domain: 5,
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not update status page settings when domain is not valid', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .put(`/StatusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send({
                domain: 'wwwtest',
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should update status page settings', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .put(`/StatusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: statusPageId,
                links: [],
                name: 'Status name',
                title: 'Status title',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                monitors: [
                    {
                        monitor: monitorId,
                        description: 'Updated Description.',
                        uptime: true,
                        memory: false,
                        cpu: false,
                        storage: false,
                        responseTime: false,
                        temperature: false,
                        runtime: false,
                    },
                ],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should return monitor category with monitors in status page data', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/StatusPage/${statusPageId}`)
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                expect(res).to.be.an('object');
                expect(res.body).to.have.property('monitors');
                expect(res.body.monitors)
                    .to.be.an('array')
                    .with.length.greaterThan(0);
                expect(res.body.monitorsData)
                    .to.be.an('array')
                    .with.length.greaterThan(0);
                expect(res.body.monitorsData[0]).to.have.property(
                    'resourceCategory'
                );
                done();
            });
    });

    it('should get list of scheduled events', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/StatusPage/${projectId}/${statusPageId}/events`)
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                expect(res).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body.data)
                    .to.be.an('array')
                    .with.length.greaterThan(0);
                expect(res.body.data[0]).to.have.property('name');
                done();
            });
    });

    it('should get list of scheduled events for monitor', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(
                `/StatusPage/${projectId}/${monitorId}/individualevents?date=${today}`
            )
            .set('Authorization', authorization)
            .send()
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                expect(res).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body.data)
                    .to.be.an('array')
                    .with.length.greaterThan(0);
                expect(res.body.data[0]).to.have.property('name');
                done();
            });
    });

    it('should get list of logs for a monitor', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        monitorLogService
            .create({
                monitorId,
                status: 'online',
                responseTime: 50,
                responseStatus: 200,
                incidentIds: [],
            })
            .then(() => {
                request
                    .post(`/StatusPage/${projectId}/${monitorId}/monitorLogs`)
                    .set('Authorization', authorization)
                    .send({
                        responseTime: true,
                    })
                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        if (err) {
                            throw err;
                        }
                        expect(res).to.have.status(200);
                        expect(res).to.be.an('object');
                        expect(res.body).to.have.property('data');
                        expect(res.body.data).to.be.an('array');
                        done();
                    });
            });
    });

    it('should create a domain', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = { domain: 'oneuptimeapp.com' };
        request
            .put(`/StatusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send(data)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should create a domain with subdomain', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = { domain: 'status.oneuptimeapp.com' };
        request
            .put(`/StatusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send(data)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                done();
            });
    });

    // The placement of this test case is very important
    // a domain needs to be created before verifying it

    it('should verify a domain', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const domain: string = 'oneuptimeapp.com';
        const verificationToken: string = 'm2ab5osUmz9Y7Ko';
        // update the verification token to a live version
        DomainVerificationService.updateOneBy(
            { domain },
            { verificationToken }
        ).then(({ _id: domainId, verificationToken }: $TSFixMe): void => {
            request
                .put(`/domainVerificationToken/${projectId}/verify/${domainId}`)
                .set('Authorization', authorization)
                .send({ domain, verificationToken })
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    if (err) {
                        throw err;
                    }
                    expect(res).to.have.status(200);
                    expect(res.body.verified).to.be.true;
                    done();
                });
        });
    });

    it('should verify a domain and fetch a status page', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = { domain: 'status.x.com' };
        request
            .put(`/StatusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send(data)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                const domain: string = 'status.x.com';
                // update the verification token to a live version
                DomainVerificationService.updateOneBy(
                    { domain },
                    { verified: true }
                ).then((): void => {
                    request
                        .get(`/StatusPage/null?url=${domain}`)
                        .send()
                        .end((err: $TSFixMe, res: $TSFixMe): void => {
                            if (err) {
                                throw err;
                            }
                            expect(res).to.have.status(200);
                            expect(res.body._id).to.be.equal(statusPageId);
                            done();
                        });
                });
            });
    });

    it('should NOT fetch status page of unverfied domain', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = { domain: 'status.y.com' };
        request
            .put(`/StatusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send(data)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                const domain: string = 'status.y.com';
                request
                    .get(`/StatusPage/null?url=${domain}`)
                    .send()
                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        if (err) {
                            throw err;
                        }
                        expect(res).to.have.status(400);
                        expect(res.body.message).to.be.equal(
                            'Domain not verified'
                        );
                        done();
                    });
            });
    });

    it('should not verify a domain if txt record is not found', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const domain: string = 'oneuptimeapp.com';
        const verificationToken: string = 'thistokenwillnotwork';
        // update the verification token to a live version
        DomainVerificationService.updateOneBy(
            { domain },
            { verificationToken, verified: false, verifiedAt: null }
        ).then(({ _id: domainId, verificationToken }: $TSFixMe): void => {
            request
                .put(`/domainVerificationToken/${projectId}/verify/${domainId}`)
                .set('Authorization', authorization)
                .send({ domain, verificationToken })
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    if (err) {
                        throw err;
                    }
                    expect(res).to.have.status(400);
                    done();
                });
        });
    });

    it('should not verify a domain that does not exist on the web', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const domain: string = 'binoehty1234hgyt.com';
        const selectDomainVerify: $TSFixMe =
            'domain createdAt verificationToken verifiedAt updatedAt projectId';
        const populateDomainVerify: $TSFixMe = [
            { path: 'projectId', select: 'name slug' },
        ];

        StatusService.createDomain(domain, projectId, statusPageId).then(
            (): void => {
                DomainVerificationService.findOneBy({
                    query: { domain },
                    select: selectDomainVerify,
                    populate: populateDomainVerify,
                }).then(({ domain, verificationToken, _id: domainId }: $TSFixMe) => {
                    request
                        .put(
                            `/domainVerificationToken/${projectId}/verify/${domainId}`
                        )
                        .set('Authorization', authorization)
                        .send({ domain, verificationToken })
                        .end((err: $TSFixMe, res: $TSFixMe): void => {
                            if (err) {
                                throw err;
                            }
                            expect(res).to.have.status(400);
                            done();
                        });
                });
            }
        );
    });

    it('should not save domain if domain is invalid', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = { domain: 'status.oneuptime.hackerbay' };
        request
            .put(`/StatusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send(data)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(400);
                done();
            });
    });

    // this is no longer the case
    // array of domain are no longer used in the application

    it.skip('should save an array of valid domains', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = {
            domain: [
                { domain: 'oneuptime.z.com' },
                { domain: 'oneuptime1.z.com' },
            ],
        };
        request
            .put(`/StatusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send(data)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                done();
            });
    });

    // this is no longer the case
    // array of domain are no longer used in the application

    it.skip('should not save domains if one domain in the array is invalid', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = {
            domain: [
                { domain: 'oneuptime.z1.com' },
                { domain: 'oneuptime.z1.hackerbay' },
            ],
        };
        request
            .put(`/StatusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send(data)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should save when domain is without subdomain', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = { domain: 'oneuptime.com' };
        request
            .put(`/StatusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send(data)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should reject adding an existing domain', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = { domain: 'status.oneuptimeapp.com' };
        request
            .put(`/StatusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send(data)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(400);
                done();
            });
    });

    // This test will work base on the fact that a domain was previously created in another project
    // This test will try to create another domain with the same domain on another project

    it('should add domain if it exist in another project and if the domain in other project is NOT verified.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = { domain: 'oneuptimeapp.com' };
        request
            .post(`/project/create`)
            .set('Authorization', authorization)
            .send(project.newProject)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                const newProjectId: $TSFixMe = res.body._id;
                request
                    .post(`/StatusPage/${newProjectId}`)
                    .set('Authorization', authorization)
                    .send({
                        name: 'Status Page name',
                        links: [],
                        title: 'Status Page title',
                        description: 'status page description',
                        copyright: 'status page copyright',
                        projectId,
                        monitorIds: [monitorId],
                    })
                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        if (err) {
                            throw err;
                        }
                        const newStatusPageId: $TSFixMe = res.body._id;
                        request
                            .put(
                                `/StatusPage/${newProjectId}/${newStatusPageId}/domain`
                            )
                            .set('Authorization', authorization)
                            .send(data)
                            .end((err: $TSFixMe, res: $TSFixMe): void => {
                                if (err) {
                                    throw err;
                                }
                                expect(res).to.have.status(200);
                                expect(
                                    res.body.domains.length
                                ).to.be.greaterThan(0);
                                expect(res.body.domains[0].domain).to.be.equal(
                                    'oneuptimeapp.com'
                                );
                                done();
                            });
                    });
            });
    });

    it('should NOT add domain if it exist in another project and domain in other project is verified', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = { domain: 'status.x.com' };
        request
            .post(`/project/create`)
            .set('Authorization', authorization)
            .send(project.newSecondProject)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                const newProjectId: $TSFixMe = res.body._id;
                request
                    .post(`/StatusPage/${newProjectId}`)
                    .set('Authorization', authorization)
                    .send({
                        name: 'Status Page name',
                        links: [],
                        title: 'Status Page title',
                        description: 'status page description',
                        copyright: 'status page copyright',
                        projectId,
                        monitorIds: [monitorId],
                    })
                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        if (err) {
                            throw err;
                        }
                        const newStatusPageId: $TSFixMe = res.body._id;
                        request
                            .put(
                                `/StatusPage/${newProjectId}/${newStatusPageId}/domain`
                            )
                            .set('Authorization', authorization)
                            .send(data)
                            .end((err: $TSFixMe, res: $TSFixMe): void => {
                                if (err) {
                                    throw err;
                                }
                                expect(res).to.have.status(400);
                                expect(res.body.message).to.be.equals(
                                    `This domain is already associated with another project`
                                );
                                done();
                            });
                    });
            });
    });

    //TODO: write test for updating domain
    // check for when the domain in statuspage is updated
    // check for when domainverificationtoken is updated

    it('should update a domain on a status page successfully', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = { domain: 'app.oneuptimeapp.com' };

        StatusService.findOneBy({ _id: statusPageId }).then(
            (statusPage: $TSFixMe) => {
                // select the first domain

                const { _id: domainId } = statusPage.domains[0];
                request
                    .put(`/StatusPage/${projectId}/${statusPageId}/${domainId}`)
                    .send(data)
                    .set('Authorization', authorization)
                    .end((err: $TSFixMe, res: $TSFixMe) => {
                        if (err) {
                            throw err;
                        }
                        expect(res).to.have.status(200);
                        done();
                    });
            }
        );
    });

    it('should not update a domain on a status page if the domain field is empty', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = { domain: '' };

        StatusService.findOneBy({ _id: statusPageId }).then(
            (statusPage: $TSFixMe) => {
                // select the first domain

                const { _id: domainId } = statusPage.domains[0];
                request
                    .put(`/StatusPage/${projectId}/${statusPageId}/${domainId}`)
                    .send(data)
                    .set('Authorization', authorization)
                    .end((err: $TSFixMe, res: $TSFixMe) => {
                        if (err) {
                            throw err;
                        }
                        expect(res).to.have.status(400);
                        done();
                    });
            }
        );
    });

    it('should not update a domain on a status page if the domain is not a string', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = { domain: { url: 'shop.oneuptimeapp.com' } };

        StatusService.findOneBy({ _id: statusPageId }).then(
            (statusPage: $TSFixMe) => {
                // select the first domain

                const { _id: domainId } = statusPage.domains[0];
                request
                    .put(`/StatusPage/${projectId}/${statusPageId}/${domainId}`)
                    .send(data)
                    .set('Authorization', authorization)
                    .end((err: $TSFixMe, res: $TSFixMe) => {
                        if (err) {
                            throw err;
                        }
                        expect(res).to.have.status(400);
                        done();
                    });
            }
        );
    });

    it('should not update a domain on a status page if the status page is missing or not found', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        const data: $TSFixMe = { domain: { url: 'shop.oneuptimeapp.com' } };

        StatusService.findOneBy({ _id: statusPageId }).then(
            (statusPage: $TSFixMe) => {
                // select the first domain

                const { _id: domainId } = statusPage.domains[0];
                // provide a random object id
                const statusPageId: string = '5ea70eb4be9f4b177a1719ad';
                request
                    .put(`/StatusPage/${projectId}/${statusPageId}/${domainId}`)
                    .send(data)
                    .set('Authorization', authorization)
                    .end((err: $TSFixMe, res: $TSFixMe) => {
                        if (err) {
                            throw err;
                        }
                        expect(res).to.have.status(400);
                        done();
                    });
            }
        );
    });

    it('should delete a domain from a status page', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        StatusService.findOneBy({ _id: statusPageId }).then(
            (statusPage: $TSFixMe) => {
                // select the first domain

                const { _id: domainId } = statusPage.domains[0];
                request
                    .delete(
                        `/StatusPage/${projectId}/${statusPageId}/${domainId}`
                    )
                    .set('Authorization', authorization)
                    .end((err: $TSFixMe, res: $TSFixMe) => {
                        if (err) {
                            throw err;
                        }
                        expect(res).to.have.status(200);
                        done();
                    });
            }
        );
    });

    it('should not delete any domain if status page does not exist or not found', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        StatusService.findOneBy({ _id: statusPageId }).then(
            (statusPage: $TSFixMe) => {
                // select the first domain

                const { _id: domainId } = statusPage.domains[0];
                // create random status page id
                const statusPageId: string = '5ea70eb4be9f4b177a1719ad';
                request
                    .delete(
                        `/StatusPage/${projectId}/${statusPageId}/${domainId}`
                    )
                    .set('Authorization', authorization)
                    .end((err: $TSFixMe, res: $TSFixMe) => {
                        if (err) {
                            throw err;
                        }
                        expect(res).to.have.status(400);
                        done();
                    });
            }
        );
    });
});

let subProjectId: ObjectID,
    newUserToken: $TSFixMe,
    anotherUserToken: $TSFixMe,
    subProjectStatusPageId: $TSFixMe;

describe('StatusPage API with Sub-Projects', function (): void {
    this.timeout(30000);

    before(function (done: $TSFixMe): void {
        this.timeout(30000);
        const authorization: string = `Basic ${token}`;
        GlobalConfig.initTestConfig().then((): void => {
            // create a subproject for parent project
            request
                .post(`/project/${projectId}/subProject`)
                .set('Authorization', authorization)
                .send({ subProjectName: 'New SubProject' })
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    if (err) {
                        throw err;
                    }
                    subProjectId = res.body[0]._id;
                    // sign up second user (subproject user)
                    createUser(request, userData.newUser, (): void => {
                        request
                            .post('/user/login')
                            .send({
                                email: userData.newUser.email,
                                password: userData.newUser.password,
                            })
                            .end((err: $TSFixMe, res: $TSFixMe): void => {
                                if (err) {
                                    throw err;
                                }
                                newUserToken = res.body.tokens.jwtAccessToken;
                                const authorization: string = `Basic ${token}`;
                                // add second user to subproject
                                request
                                    .post(`/team/${subProjectId}`)
                                    .set('Authorization', authorization)
                                    .send({
                                        emails: userData.newUser.email,
                                        role: 'Member',
                                    })
                                    .end((): void => {
                                        done();
                                    });
                            });
                    });
                });
        });
    });

    after(async (): void => {
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, subProjectId] },
        });
        await DomainVerificationService.hardDeleteBy({ projectId });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
    });

    it('should not create a statupage for user not present in project', (done: $TSFixMe): void => {
        createUser(request, userData.anotherUser, (): void => {
            request
                .post('/user/login')
                .send({
                    email: userData.anotherUser.email,
                    password: userData.anotherUser.password,
                })
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    if (err) {
                        throw err;
                    }
                    anotherUserToken = res.body.tokens.jwtAccessToken;
                    const authorization: string = `Basic ${anotherUserToken}`;
                    request
                        .post(`/StatusPage/${projectId}`)
                        .set('Authorization', authorization)
                        .send({
                            links: [],
                            title: 'Status title',
                            description: 'status description',
                            copyright: 'status copyright',
                            projectId,
                            monitors: [
                                {
                                    monitor: monitorId,
                                    description: 'Monitor Description.',
                                    uptime: true,
                                    memory: false,
                                    cpu: false,
                                    storage: false,
                                    responseTime: false,
                                    temperature: false,
                                    runtime: false,
                                },
                            ],
                        })
                        .end((err: $TSFixMe, res: $TSFixMe): void => {
                            if (err) {
                                throw err;
                            }
                            expect(res).to.have.status(400);
                            expect(res.body.message).to.be.equal(
                                'You are not present in this project.'
                            );
                            done();
                        });
                });
        });
    });

    it('should not get private status page for authorized user that is not in project', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${newUserToken}`;
        request
            .get(`/StatusPage/${privateStatusPageId}`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not create a statusPage for user that is not `admin` in sub-project.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${newUserToken}`;
        request
            .post(`/StatusPage/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                monitors: [
                    {
                        monitor: monitorId,
                        description: 'Monitor Description.',
                        uptime: true,
                        memory: false,
                        cpu: false,
                        storage: false,
                        responseTime: false,
                        temperature: false,
                        runtime: false,
                    },
                ],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should create a statusPage in parent project by valid admin.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/StatusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                name: 'status name',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                monitors: [
                    {
                        monitor: monitorId,
                        description: 'Monitor Description.',
                        uptime: true,
                        memory: false,
                        cpu: false,
                        storage: false,
                        responseTime: false,
                        temperature: false,
                        runtime: false,
                    },
                ],
                domains: [],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                statusPageId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.title).to.equal('Status title');
                done();
            });
    });

    it('should create a statusPage in sub-project by valid admin.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .post(`/StatusPage/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                name: 'New StatusPage',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                monitors: [
                    {
                        monitor: monitorId,
                        description: 'Monitor Description.',
                        uptime: true,
                        memory: false,
                        cpu: false,
                        storage: false,
                        responseTime: false,
                        temperature: false,
                        runtime: false,
                    },
                ],
            })
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                subProjectStatusPageId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.title).to.be.equal('Status title');
                done();
            });
    });

    it("should get only sub-project's statuspages for valid sub-project user", (done: $TSFixMe): void => {
        const authorization: string = `Basic ${newUserToken}`;
        request
            .get(`/StatusPage/${subProjectId}/statuspage`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                expect(res.body.data.length).to.be.equal(res.body.count);
                done();
            });
    });

    it('should get both project and sub-project statuspage for valid parent project user.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .get(`/StatusPage/${projectId}/statuspages`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('array');
                expect(res.body[0]).to.have.property('statusPages');
                expect(res.body[0]).to.have.property('count');
                expect(res.body.length).to.be.equal(2);
                expect(res.body[0]._id).to.be.equal(subProjectId);
                expect(res.body[1]._id).to.be.equal(projectId);
                done();
            });
    });

    it('should get status page for viewer in sub-project', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${anotherUserToken}`;
        request
            .post(`/team/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                emails: userData.anotherUser.email,
                role: 'Viewer',
            })
            .end((): void => {
                request
                    .get(`/StatusPage/${subProjectStatusPageId}`)
                    .set('Authorization', authorization)
                    .end((err: $TSFixMe, res: $TSFixMe): void => {
                        if (err) {
                            throw err;
                        }
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('object');
                        expect(res.body).to.have.property('monitors');
                        done();
                    });
            });
    });

    it('should not delete a status page for user that is not `admin` in sub-project.', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${newUserToken}`;
        request
            .delete(`/StatusPage/${subProjectId}/${subProjectStatusPageId}`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should delete sub-project status page', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .delete(`/StatusPage/${subProjectId}/${subProjectStatusPageId}`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should delete parent project status page', (done: $TSFixMe): void => {
        const authorization: string = `Basic ${token}`;
        request
            .delete(`/StatusPage/${projectId}/${statusPageId}`)
            .set('Authorization', authorization)
            .end((err: $TSFixMe, res: $TSFixMe): void => {
                if (err) {
                    throw err;
                }
                expect(res).to.have.status(200);
                done();
            });
    });
});
