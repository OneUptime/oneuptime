/* eslint-disable quotes, no-undef */

process.env.PORT = 3020;
const expect = require('chai').expect;
const userData = require('./data/user');
const chai = require('chai');
chai.use(require('chai-http'));
const app = require('../server');
const GlobalConfig = require('./utils/globalConfig');
const request = chai.request.agent(app);
const { createUser } = require('./utils/userSignUp');
const UserService = require('../backend/services/userService');
const StatusService = require('../backend/services/statusPageService');
const MonitorService = require('../backend/services/monitorService');
const ScheduledEventService = require('../backend/services/scheduledEventService');
const ProjectService = require('../backend/services/projectService');
const AirtableService = require('../backend/services/airtableService');
const DomainVerificationService = require('../backend/services/domainVerificationService');
const project = require('./data/project');

const VerificationTokenModel = require('../backend/models/verificationToken');

// eslint-disable-next-line
let token,
    projectId,
    monitorId,
    monitorCategoryId,
    scheduledEventId,
    statusPageId,
    privateStatusPageId,
    userId,
    airtableId;

const monitor = {
    name: 'New Monitor',
    type: 'url',
    data: { url: 'http://www.tests.org' },
};

const monitorCategory = {
    monitorCategoryName: 'New Monitor Category',
};

const today = new Date().toISOString();
const scheduledEvent = {
    name: 'New scheduled Event',
    startDate: today,
    endDate: today,
    description: 'New scheduled Event description',
    showEventOnStatusPage: true,
    alertSubscriber: true,
    callScheduleOnEvent: true,
    monitorDuringEvent: false,
};

describe('Status API', function() {
    this.timeout(20000);

    before(function(done) {
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(async function() {
            createUser(request, userData.user, function(err, res) {
                projectId = res.body.project._id;
                userId = res.body.id;
                airtableId = res.body.airtableId;

                VerificationTokenModel.findOne({ userId }, function(
                    err,
                    verificationToken
                ) {
                    request
                        .get(`/user/confirmation/${verificationToken.token}`)
                        .redirects(0)
                        .end(function() {
                            request
                                .post('/user/login')
                                .send({
                                    email: userData.user.email,
                                    password: userData.user.password,
                                })
                                .end(function(err, res) {
                                    token = res.body.tokens.jwtAccessToken;
                                    const authorization = `Basic ${token}`;
                                    request
                                        .post(`/monitorCategory/${projectId}`)
                                        .set('Authorization', authorization)
                                        .send(monitorCategory)
                                        .end(function(err, res) {
                                            monitorCategoryId = res.body._id;
                                            monitor.monitorCategoryId = monitorCategoryId;
                                            request
                                                .post(`/monitor/${projectId}`)
                                                .set(
                                                    'Authorization',
                                                    authorization
                                                )
                                                .send(monitor)
                                                .end(function(err, res) {
                                                    monitorId = res.body._id;
                                                    request
                                                        .post(
                                                            `/scheduledEvent/${projectId}/${monitorId}`
                                                        )
                                                        .set(
                                                            'Authorization',
                                                            authorization
                                                        )
                                                        .send(scheduledEvent)
                                                        .end(function(
                                                            err,
                                                            res
                                                        ) {
                                                            scheduledEventId =
                                                                res.body._id;
                                                            done();
                                                        });
                                                });
                                        });
                                });
                        });
                });
            });
            // remove any domain to make sure we don't encounter
            // domain used in another project error
            await DomainVerificationService.hardDeleteBy({});
        });
    });

    after(async function() {
        await GlobalConfig.removeTestConfig();
        await MonitorService.hardDeleteBy({ _id: monitorId });
        await ScheduledEventService.hardDeleteBy({ _id: scheduledEventId });
        await StatusService.hardDeleteBy({ projectId: projectId });
        await DomainVerificationService.hardDeleteBy({ projectId });
        await AirtableService.deleteUser(airtableId);
    });

    it('should not add status page if monitor ids is missing', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not add status page if monitor is not an array', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                monitorsId: { _id: '2121' },
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should add status page', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Status Page',
                links: [],
                title: 'Status Page title',
                description: 'status page description',
                copyright: 'status page copyright',
                projectId,
                monitorIds: [monitorId],
            })
            .end(function(err, res) {
                statusPageId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should add private status page', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                name: 'Private Status Page',
                isPrivate: true,
                links: [],
                title: 'Private Status Page title',
                description: 'private status page description',
                copyright: 'private status page copyright',
                projectId,
                monitorIds: [monitorId],
            })
            .end(function(err, res) {
                privateStatusPageId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('isPrivate');
                expect(res.body.isPrivate).to.equal(true);
                done();
            });
    });

    it('should get private status page for authorized user', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/statusPage/${privateStatusPageId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                done();
            });
    });

    it('should get valid private status page rss for authorized user', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/statusPage/${privateStatusPageId}/rss`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should not get private status page for unauthorized user', function(done) {
        request
            .get(`/statusPage/${privateStatusPageId}`)
            .end(function(err, res) {
                expect(res).to.have.status(401);
                done();
            });
    });

    it('should not update status page settings when domain is not string', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put(`/statusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send({
                domain: 5,
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not update status page settings when domain is not valid', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put(`/statusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send({
                domain: 'wwwtest',
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should update status page settings', function(done) {
        const authorization = `Basic ${token}`;
        request
            .put(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                _id: statusPageId,
                links: [],
                title: 'Status title',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                monitorIds: [monitorId],
            })
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should return monitor category with monitors in status page data', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/statusPage/${statusPageId}`)
            .set('Authorization', authorization)
            .send()
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res).to.be.an('object');
                expect(res.body).to.have.property('monitorIds');
                expect(res.body.monitorIds)
                    .to.be.an('array')
                    .with.length.greaterThan(0);
                expect(res.body.monitorsData)
                    .to.be.an('array')
                    .with.length.greaterThan(0);
                expect(res.body.monitorsData[0]).to.have.property(
                    'monitorCategoryId'
                );
                done();
            });
    });

    it('should get list of scheduled events', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/statusPage/${projectId}/${statusPageId}/events`)
            .set('Authorization', authorization)
            .send()
            .end(function(err, res) {
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

    it('should get list of scheduled events for monitor', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(
                `/statusPage/${projectId}/${monitorId}/individualevents?date=${today}`
            )
            .set('Authorization', authorization)
            .send()
            .end(function(err, res) {
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

    it('should create a domain', function(done) {
        const authorization = `Basic ${token}`;
        const data = { domain: 'fyipeapp.com' };
        request
            .put(`/statusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send(data)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
    // The placement of this test case is very important
    // a domain needs to be created before verifying it
    it('should verify a domain', function(done) {
        const authorization = `Basic ${token}`;
        const domain = 'fyipeapp.com';
        const verificationToken = 'm2ab5osUmz9Y7Ko';
        // update the verification token to a live version
        DomainVerificationService.updateOneBy(
            { domain },
            { verificationToken },
            domain
        ).then(function({ _id: domainId, verificationToken }) {
            request
                .put(`/domainVerificationToken/${projectId}/verify/${domainId}`)
                .set('Authorization', authorization)
                .send({ domain, verificationToken })
                .end(function(err, res) {
                    expect(res).to.have.status(200);
                    expect(res.body.verified).to.be.true;
                    done();
                });
        });
    });

    it('should not verify a domain if txt record is not found', function(done) {
        const authorization = `Basic ${token}`;
        const domain = 'fyipeapp.com';
        const verificationToken = 'thistokenwillnotwork';
        // update the verification token to a live version
        DomainVerificationService.updateOneBy(
            { domain },
            { verificationToken, verified: false, verifiedAt: null },
            domain
        ).then(function({ _id: domainId, verificationToken }) {
            request
                .put(`/domainVerificationToken/${projectId}/verify/${domainId}`)
                .set('Authorization', authorization)
                .send({ domain, verificationToken })
                .end(function(err, res) {
                    expect(res).to.have.status(400);
                    done();
                });
        });
    });

    it('should not verify a domain that does not exist on the web', function(done) {
        const authorization = `Basic ${token}`;
        const domain = 'binoehty1234hgyt.com';
        StatusService.createDomain(domain, projectId, statusPageId).then(
            function() {
                DomainVerificationService.findOneBy({ domain }).then(function({
                    domain,
                    verificationToken,
                    _id: domainId,
                }) {
                    request
                        .put(
                            `/domainVerificationToken/${projectId}/verify/${domainId}`
                        )
                        .set('Authorization', authorization)
                        .send({ domain, verificationToken })
                        .end(function(err, res) {
                            expect(res).to.have.status(400);
                            done();
                        });
                });
            }
        );
    });

    it('should not save domain if domain is invalid', function(done) {
        const authorization = `Basic ${token}`;
        const data = { domain: 'status.fyipe.hackerbay' };
        request
            .put(`/statusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send(data)
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should save when domain is without subdomain', function(done) {
        const authorization = `Basic ${token}`;
        const data = { domain: 'fyipe.com' };
        request
            .put(`/statusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send(data)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should add status.fyipeapp.com without errors', function(done){
        const authorization = `Basic ${token}`;
        const data = { domain: 'status.fyipeapp.com' };
        request
            .put(`/statusPage/${projectId}/${statusPageId}/domain`)
            .set('Authorization', authorization)
            .send(data)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    })

    // This test will work base on the fact that a domain was previously created in another project
    // This test will try to create another domain with the same domain on another project
    it('should not add domain if it exist in another project', function(done) {
        const authorization = `Basic ${token}`;
        const data = { domain: 'fyipeapp.com' };
        request
            .post(`/project/create`)
            .set('Authorization', authorization)
            .send(project.newProject)
            .end(function(err, res) {
                const newProjectId = res.body._id;
                request
                    .post(`/statusPage/${newProjectId}`)
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
                    .end(function(err, res) {
                        const newStatusPageId = res.body._id;
                        request
                            .put(
                                `/statusPage/${newProjectId}/${newStatusPageId}/domain`
                            )
                            .set('Authorization', authorization)
                            .send(data)
                            .end(function(err, res) {
                                expect(res).to.have.status(400);
                                done();
                            });
                    });
            });
    });
});

// eslint-disable-next-line no-unused-vars
let subProjectId,
    newUserToken,
    anotherUserToken,
    subProjectStatusPageId,
    subProjectUserId;

describe('StatusPage API with Sub-Projects', function() {
    this.timeout(30000);
    before(function(done) {
        this.timeout(30000);
        const authorization = `Basic ${token}`;
        GlobalConfig.initTestConfig().then(function() {
            // create a subproject for parent project
            request
                .post(`/project/${projectId}/subProject`)
                .set('Authorization', authorization)
                .send({ subProjectName: 'New SubProject' })
                .end(function(err, res) {
                    subProjectId = res.body[0]._id;
                    // sign up second user (subproject user)
                    createUser(request, userData.newUser, function(err, res) {
                        subProjectUserId = res.body.id;
                        VerificationTokenModel.findOne(
                            { userId: subProjectUserId },
                            function(err, verificationToken) {
                                request
                                    .get(
                                        `/user/confirmation/${verificationToken.token}`
                                    )
                                    .redirects(0)
                                    .end(function() {
                                        request
                                            .post('/user/login')
                                            .send({
                                                email: userData.newUser.email,
                                                password:
                                                    userData.newUser.password,
                                            })
                                            .end(function(err, res) {
                                                newUserToken =
                                                    res.body.tokens
                                                        .jwtAccessToken;
                                                const authorization = `Basic ${token}`;
                                                // add second user to subproject
                                                request
                                                    .post(
                                                        `/team/${subProjectId}`
                                                    )
                                                    .set(
                                                        'Authorization',
                                                        authorization
                                                    )
                                                    .send({
                                                        emails:
                                                            userData.newUser
                                                                .email,
                                                        role: 'Member',
                                                    })
                                                    .end(function() {
                                                        done();
                                                    });
                                            });
                                    });
                            }
                        );
                    });
                });
        });
    });

    after(async function() {
        await ProjectService.hardDeleteBy({
            _id: { $in: [projectId, subProjectId] },
        });
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

    it('should not create a statupage for user not present in project', function(done) {
        createUser(request, userData.anotherUser, function(err, res) {
            VerificationTokenModel.findOne({ userId: res.body.id }, function(
                err,
                res
            ) {
                request
                    .get(`/user/confirmation/${res.token}`)
                    .redirects(0)
                    .end(function() {
                        request
                            .post('/user/login')
                            .send({
                                email: userData.anotherUser.email,
                                password: userData.anotherUser.password,
                            })
                            .end(function(err, res) {
                                anotherUserToken =
                                    res.body.tokens.jwtAccessToken;
                                const authorization = `Basic ${anotherUserToken}`;
                                request
                                    .post(`/statusPage/${projectId}`)
                                    .set('Authorization', authorization)
                                    .send({
                                        links: [],
                                        title: 'Status title',
                                        description: 'status description',
                                        copyright: 'status copyright',
                                        projectId,
                                        monitorIds: [monitorId],
                                    })
                                    .end(function(err, res) {
                                        expect(res).to.have.status(400);
                                        expect(res.body.message).to.be.equal(
                                            'You are not present in this project.'
                                        );
                                        done();
                                    });
                            });
                    });
            });
        });
    });

    it('should not get private status page for authorized user that is not in project', function(done) {
        const authorization = `Basic ${newUserToken}`;
        request
            .get(`/statusPage/${privateStatusPageId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    it('should not create a statusPage for user that is not `admin` in sub-project.', function(done) {
        const authorization = `Basic ${newUserToken}`;
        request
            .post(`/statusPage/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                monitorIds: [monitorId],
            })
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should create a statusPage in parent project by valid admin.', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/statusPage/${projectId}`)
            .set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                name: 'status name',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                monitorIds: [monitorId],
                domains: [],
            })
            .end(function(err, res) {
                statusPageId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.title).to.equal('Status title');
                done();
            });
    });

    it('should create a statusPage in sub-project by valid admin.', function(done) {
        const authorization = `Basic ${token}`;
        request
            .post(`/statusPage/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                links: [],
                title: 'Status title',
                name: 'New StatusPage',
                description: 'status description',
                copyright: 'status copyright',
                projectId,
                monitorIds: [monitorId],
            })
            .end(function(err, res) {
                subProjectStatusPageId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.title).to.be.equal('Status title');
                done();
            });
    });

    it("should get only sub-project's statuspages for valid sub-project user", function(done) {
        const authorization = `Basic ${newUserToken}`;
        request
            .get(`/statusPage/${subProjectId}/statuspage`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body).to.have.property('count');
                expect(res.body.data.length).to.be.equal(res.body.count);
                done();
            });
    });

    it('should get both project and sub-project statuspage for valid parent project user.', function(done) {
        const authorization = `Basic ${token}`;
        request
            .get(`/statusPage/${projectId}/statuspages`)
            .set('Authorization', authorization)
            .end(function(err, res) {
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

    it('should get status page for viewer in sub-project', function(done) {
        const authorization = `Basic ${anotherUserToken}`;
        request
            .post(`/team/${subProjectId}`)
            .set('Authorization', authorization)
            .send({
                emails: userData.anotherUser.email,
                role: 'Viewer',
            })
            .end(function() {
                request
                    .get(`/statusPage/${subProjectStatusPageId}`)
                    .set('Authorization', authorization)
                    .end(function(err, res) {
                        expect(res).to.have.status(200);
                        expect(res.body).to.be.an('object');
                        expect(res.body).to.have.property('monitorIds');
                        done();
                    });
            });
    });

    it('should not delete a status page for user that is not `admin` in sub-project.', function(done) {
        const authorization = `Basic ${newUserToken}`;
        request
            .delete(`/statusPage/${subProjectId}/${subProjectStatusPageId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(400);
                expect(res.body.message).to.be.equal(
                    "You cannot edit the project because you're not an admin."
                );
                done();
            });
    });

    it('should delete sub-project status page', function(done) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/statusPage/${subProjectId}/${subProjectStatusPageId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });

    it('should delete parent project status page', function(done) {
        const authorization = `Basic ${token}`;
        request
            .delete(`/statusPage/${projectId}/${statusPageId}`)
            .set('Authorization', authorization)
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});
