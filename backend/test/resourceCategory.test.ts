// @ts-expect-error ts-migrate(2322) FIXME: Type '3020' is not assignable to type 'string | un... Remove this comment to see the full error message
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user'
import chai from 'chai'
import chai-http from 'chai-http';
chai.use(chaihttp);
import app from '../server'

// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(app);
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./utils/userSignUp"' has no exported memb... Remove this comment to see the full error message
import { createUser } from './utils/userSignUp'
import UserService from '../backend/services/userService'
import ProjectService from '../backend/services/projectService'
import ResourceCategoryService from '../backend/services/resourceCategoryService'
import ResourceCategoryModel from '../backend/models/resourceCategory'
import AirtableService from '../backend/services/airtableService'
import GlobalConfig from './utils/globalConfig'
import VerificationTokenModel from '../backend/models/verificationToken'

// @ts-expect-error ts-migrate(7034) FIXME: Variable 'token' implicitly has type 'any' in some... Remove this comment to see the full error message
let token, userId, projectId, resourceCategoryId, apiKey;
const resourceCategory = {
    resourceCategoryName: 'New Resource Category',
};
import payment from '../backend/config/payment'
import stripe from 'stripe')(payment.paymentPrivateKey

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Resource Category API', function() {
    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(done) {
        // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

                VerificationTokenModel.findOne({ userId }, function(
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                    err,
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'verificationToken' implicitly has an 'a... Remove this comment to see the full error message
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
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                                .end(function(err, res) {
                                    token = res.body.tokens.jwtAccessToken;
                                    done();
                                });
                        });
                });
            });
        });
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
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
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'resourceCategoryId' implicitly has an 'a... Remove this comment to see the full error message
        await ResourceCategoryService.hardDeleteBy({ _id: resourceCategoryId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should reject the request of an unauthenticated user', function(done) {
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/resourceCategory/${projectId}`)
            .send({
                resourceCategoryName: 'unauthenticated user',
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(401);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not create a resource category when the `resourceCategoryName` field is null', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            .send({
                resourceCategoryName: null,
            })
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a new resource category when proper `resourceCategoryName` field is given by an authenticated user', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            .send(resourceCategory)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                resourceCategoryId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(
                    resourceCategory.resourceCategoryName
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get all monitor Categories for an authenticated user by ProjectId', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .get(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data).to.have.length.greaterThan(0);
                expect(res.body).to.have.property('count');
                expect(res.body.count).to.be.an('number');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should delete a resource category when resourceCategoryId is valid', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .delete(`/resourceCategory/${projectId}/${resourceCategoryId}`)
            .set('Authorization', authorization)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('User from other project have access to read / write and delete API.', function() {
    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(done) {
        // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                createUser(request, userData.newUser, function(err, res) {
                    userId = res.body.id;
                    VerificationTokenModel.findOne({ userId }, function(
                        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                        err,
                        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'verificationToken' implicitly has an 'a... Remove this comment to see the full error message
                        verificationToken
                    ) {
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
                                        password: userData.newUser.password,
                                    })
                                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                                    .end(function(err, res) {
                                        token = res.body.tokens.jwtAccessToken;
                                        done();
                                    });
                            });
                    });
                });
            });
        });
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
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
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'resourceCategoryId' implicitly has an 'a... Remove this comment to see the full error message
        await ResourceCategoryService.hardDeleteBy({ _id: resourceCategoryId });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not be able to create new resource category', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            .send(resourceCategory)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not be able to delete a resource category', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .delete(`/resourceCategory/${projectId}/${resourceCategoryId}`)
            .set('Authorization', authorization)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not be able to get all resource categories', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .get(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
});

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Non-admin user access to create, delete and access resource category.', function() {
    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this.timeout(60000);

    let projectIdSecondUser = '';
    let emailToBeInvited = '';

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(done) {
        // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;
                VerificationTokenModel.findOne({ userId }, function(
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                    err,
                    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'verificationToken' implicitly has an 'a... Remove this comment to see the full error message
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
                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                                .end(function(err, res) {
                                    token = res.body.tokens.jwtAccessToken;
                                    const authorization = `Basic ${token}`;
                                    request
                                        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
                                        .post(`/resourceCategory/${projectId}`)
                                        .set('Authorization', authorization)
                                        .send(resourceCategory)
                                        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                                        .end(function(err, res) {
                                            resourceCategoryId = res.body._id;
                                            createUser(
                                                request,
                                                userData.newUser,
                                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                                                function(err, res) {
                                                    projectIdSecondUser =
                                                        res.body.project._id;
                                                    emailToBeInvited =
                                                        userData.newUser.email;
                                                    userId = res.body.id;
                                                    VerificationTokenModel.findOne(
                                                        { userId },
                                                        function(
                                                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                                                            err,
                                                            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'verificationToken' implicitly has an 'a... Remove this comment to see the full error message
                                                            verificationToken
                                                        ) {
                                                            request
                                                                .get(
                                                                    `/user/confirmation/${verificationToken.token}`
                                                                )
                                                                .redirects(0)
                                                                .end(
                                                                    function() {
                                                                        request
                                                                            .post(
                                                                                // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
                                                                                `/team/${projectId}`
                                                                            )
                                                                            .set(
                                                                                'Authorization',
                                                                                authorization
                                                                            )
                                                                            .send(
                                                                                {
                                                                                    emails: emailToBeInvited,
                                                                                    role:
                                                                                        'Member',
                                                                                }
                                                                            )
                                                                            .end(
                                                                                function() {
                                                                                    request
                                                                                        .post(
                                                                                            '/user/login'
                                                                                        )
                                                                                        .send(
                                                                                            {
                                                                                                email:
                                                                                                    userData
                                                                                                        .newUser
                                                                                                        .email,
                                                                                                password:
                                                                                                    userData
                                                                                                        .newUser
                                                                                                        .password,
                                                                                            }
                                                                                        )
                                                                                        .end(
                                                                                            function(
                                                                                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
                                                                                                err,
                                                                                                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'res' implicitly has an 'any' type.
                                                                                                res
                                                                                            ) {
                                                                                                token =
                                                                                                    res
                                                                                                        .body
                                                                                                        .tokens
                                                                                                        .jwtAccessToken;
                                                                                                done();
                                                                                            }
                                                                                        );
                                                                                }
                                                                            );
                                                                    }
                                                                );
                                                        }
                                                    );
                                                }
                                            );
                                        });
                                });
                        });
                });
            });
        });
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
        await ProjectService.hardDeleteBy({ _id: projectId });
        await ProjectService.hardDeleteBy({ _id: projectIdSecondUser });
        await UserService.hardDeleteBy({
            email: {
                $in: [
                    userData.user.email,
                    userData.newUser.email,
                    userData.anotherUser.email,
                ],
            },
        });
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'resourceCategoryId' implicitly has an 'a... Remove this comment to see the full error message
        await ResourceCategoryService.hardDeleteBy({ _id: resourceCategoryId });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not be able to create new resource category', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            .send(resourceCategory)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not be able to delete a resource category', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .delete(`/resourceCategory/${projectId}/${resourceCategoryId}`)
            .set('Authorization', authorization)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should be able to get all resource categories', function(done) {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .get(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data).to.have.length.greaterThan(0);
                expect(res.body).to.have.property('count');
                expect(res.body.count).to.be.an('number');
                done();
            });
    });
});

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Resource Category APIs accesible through API key', function() {
    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this.timeout(20000);

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(done) {
        // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                apiKey = project.apiKey;
                done();
            });
        });
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
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
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'resourceCategoryId' implicitly has an 'a... Remove this comment to see the full error message
        await ResourceCategoryService.hardDeleteBy({ _id: resourceCategoryId });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create a new resource category when proper `resourceCategoryName` field is given by an authenticated user', function(done) {
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .post(`/resourceCategory/${projectId}`)
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'apiKey' implicitly has an 'any' type.
            .set('apiKey', apiKey)
            .send(resourceCategory)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                resourceCategoryId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(
                    resourceCategory.resourceCategoryName
                );
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get all monitor Categories for an authenticated user by ProjectId', function(done) {
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .get(`/resourceCategory/${projectId}`)
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'apiKey' implicitly has an 'any' type.
            .set('apiKey', apiKey)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                expect(res.body).to.be.an('object');
                expect(res.body).to.have.property('data');
                expect(res.body.data).to.be.an('array');
                expect(res.body.data).to.have.length.greaterThan(0);
                expect(res.body).to.have.property('count');
                expect(res.body.count).to.be.an('number');
                done();
            });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should delete a resource category when resourceCategoryId is valid', function(done) {
        request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .delete(`/resourceCategory/${projectId}/${resourceCategoryId}`)
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'apiKey' implicitly has an 'any' type.
            .set('apiKey', apiKey)
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'err' implicitly has an 'any' type.
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Resource Category API - Check pagination for 12 resource categories', function() {
    // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
    this.timeout(40000);

    const monitorCategories = [
        'testPagination1',
        'testPagination2',
        'testPagination3',
        'testPagination4',
        'testPagination5',
        'testPagination6',
        'testPagination7',
        'testPagination8',
        'testPagination9',
        'testPagination10',
        'testPagination11',
        'testPagination12',
    ];

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(async function() {
        // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
        this.timeout(60000);
        await GlobalConfig.initTestConfig();
        const checkCardData = await request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{ randomU... Remove this comment to see the full error message
            email: userData.email,
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'companyName' does not exist on type '{ r... Remove this comment to see the full error message
            companyName: userData.companyName,
        });
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'paymentIntents' does not exist on type '... Remove this comment to see the full error message
        const confirmedPaymentIntent = await stripe.paymentIntents.confirm(
            checkCardData.body.id
        );

        const signUp = await request.post('/user/signup').send({
            paymentIntent: {
                id: confirmedPaymentIntent.id,
            },
            ...userData.user,
        });

        const project = signUp.body.project;
        projectId = project._id;
        userId = signUp.body.id;
        const verificationToken = await VerificationTokenModel.findOne({
            userId,
        });
        try {
            await request
                .get(`/user/confirmation/${verificationToken.token}`)
                .redirects(0);
        } catch (error) {
            //catch
        }
        const login = await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password,
        });
        token = login.body.tokens.jwtAccessToken;

        const authorization = `Basic ${token}`;

        const createdMonitorCategories = monitorCategories.map(
            async resourceCategoryName => {
                const sentRequests = await request
                    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
                    .post(`/resourceCategory/${projectId}`)
                    .set('Authorization', authorization)
                    .send({ resourceCategoryName });
                return sentRequests;
            }
        );
        await Promise.all(createdMonitorCategories);
    });

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(async function() {
        await GlobalConfig.removeTestConfig();
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
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
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'resourceCategoryId' implicitly has an 'a... Remove this comment to see the full error message
        await ResourceCategoryService.hardDeleteBy({ _id: resourceCategoryId });
        await ResourceCategoryModel.deleteMany({ name: 'testPagination' });
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get first 10 resource categories with data length 10, skip 0, limit 10 and count 12', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .get(`/resourceCategory/${projectId}?skip=0&limit=10`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body.data).to.be.an('array');
        expect(res.body.data).to.have.length(10);
        expect(res.body).to.have.property('count');
        expect(res.body.count)
            .to.be.an('number')
            .to.be.equal(12);
        expect(res.body).to.have.property('skip');
        expect(parseInt(res.body.skip))
            .to.be.an('number')
            .to.be.equal(0);
        expect(res.body).to.have.property('limit');
        expect(parseInt(res.body.limit))
            .to.be.an('number')
            .to.be.equal(10);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get 2 last resource categories with data length 2, skip 10, limit 10 and count 12', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .get(`/resourceCategory/${projectId}?skip=10&limit=10`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body.data).to.be.an('array');
        expect(res.body.data).to.have.length(2);
        expect(res.body).to.have.property('count');
        expect(res.body.count)
            .to.be.an('number')
            .to.be.equal(12);
        expect(res.body).to.have.property('skip');
        expect(parseInt(res.body.skip))
            .to.be.an('number')
            .to.be.equal(10);
        expect(res.body).to.have.property('limit');
        expect(parseInt(res.body.limit))
            .to.be.an('number')
            .to.be.equal(10);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should get 0 resource categories with data length 0, skip 20, limit 10 and count 12', async function() {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'token' implicitly has an 'any' type.
        const authorization = `Basic ${token}`;
        const res = await request
            // @ts-expect-error ts-migrate(7005) FIXME: Variable 'projectId' implicitly has an 'any' type.
            .get(`/resourceCategory/${projectId}?skip=20&limit=10`)
            .set('Authorization', authorization);
        expect(res).to.have.status(200);
        expect(res.body).to.be.an('object');
        expect(res.body).to.have.property('data');
        expect(res.body.data).to.be.an('array');
        expect(res.body.data).to.have.length(0);
        expect(res.body).to.have.property('count');
        expect(res.body.count)
            .to.be.an('number')
            .to.be.equal(12);
        expect(res.body).to.have.property('skip');
        expect(parseInt(res.body.skip))
            .to.be.an('number')
            .to.be.equal(20);
        expect(res.body).to.have.property('limit');
        expect(parseInt(res.body.limit))
            .to.be.an('number')
            .to.be.equal(10);
    });
});
