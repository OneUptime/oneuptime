
process.env.PORT = 3020;
const expect = require('chai').expect;
import userData from './data/user';
import chai from 'chai';
import chaihttp from 'chai-http';
chai.use(chaihttp);
import app from '../server';


const request = chai.request.agent(app);

import { createUser } from './utils/userSignUp';
import UserService from '../backend/services/userService';
import ProjectService from '../backend/services/projectService';
import ResourceCategoryService from '../backend/services/resourceCategoryService';
import ResourceCategoryModel from '../backend/models/resourceCategory';
import AirtableService from '../backend/services/airtableService';
import GlobalConfig from './utils/globalConfig';
import VerificationTokenModel from '../backend/models/verificationToken';


let token, userId, projectId, resourceCategoryId, apiKey;
const resourceCategory = {
    resourceCategoryName: 'New Resource Category',
};
import payment from '../backend/config/payment';
import Stripe from 'stripe';
const stripe = Stripe(payment.paymentPrivateKey);


describe('Resource Category API', function() {
    
    this.timeout(20000);

    
    before(function(done) {
        
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;

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
                                    done();
                                });
                        });
                });
            });
        });
    });

    
    after(async function() {
        await GlobalConfig.removeTestConfig();
        
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
        
        await ResourceCategoryService.hardDeleteBy({ _id: resourceCategoryId });
        await AirtableService.deleteAll({ tableName: 'User' });
    });

    
    it('should reject the request of an unauthenticated user', function(done) {
        request
            
            .post(`/resourceCategory/${projectId}`)
            .send({
                resourceCategoryName: 'unauthenticated user',
            })
            
            .end(function(err, res) {
                expect(res).to.have.status(401);
                done();
            });
    });

    
    it('should not create a resource category when the `resourceCategoryName` field is null', function(done) {
        
        const authorization = `Basic ${token}`;
        request
            
            .post(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            .send({
                resourceCategoryName: null,
            })
            
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });

    
    it('should create a new resource category when proper `resourceCategoryName` field is given by an authenticated user', function(done) {
        
        const authorization = `Basic ${token}`;
        request
            
            .post(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            .send(resourceCategory)
            
            .end(function(err, res) {
                resourceCategoryId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(
                    resourceCategory.resourceCategoryName
                );
                done();
            });
    });

    
    it('should get all monitor Categories for an authenticated user by ProjectId', function(done) {
        
        const authorization = `Basic ${token}`;
        request
            
            .get(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            
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

    
    it('should delete a resource category when resourceCategoryId is valid', function(done) {
        
        const authorization = `Basic ${token}`;
        request
            
            .delete(`/resourceCategory/${projectId}/${resourceCategoryId}`)
            .set('Authorization', authorization)
            
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});


describe('User from other project have access to read / write and delete API.', function() {
    
    this.timeout(20000);

    
    before(function(done) {
        
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                
                createUser(request, userData.newUser, function(err, res) {
                    userId = res.body.id;
                    VerificationTokenModel.findOne({ userId }, function(
                        
                        err,
                        
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

    
    after(async function() {
        await GlobalConfig.removeTestConfig();
        
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
        
        await ResourceCategoryService.hardDeleteBy({ _id: resourceCategoryId });
    });

    
    it('should not be able to create new resource category', function(done) {
        
        const authorization = `Basic ${token}`;
        request
            
            .post(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            .send(resourceCategory)
            
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    
    it('should not be able to delete a resource category', function(done) {
        
        const authorization = `Basic ${token}`;
        request
            
            .delete(`/resourceCategory/${projectId}/${resourceCategoryId}`)
            .set('Authorization', authorization)
            
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    
    it('should not be able to get all resource categories', function(done) {
        
        const authorization = `Basic ${token}`;
        request
            
            .get(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
});


describe('Non-admin user access to create, delete and access resource category.', function() {
    
    this.timeout(60000);

    let projectIdSecondUser = '';
    let emailToBeInvited = '';

    
    before(function(done) {
        
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                userId = res.body.id;
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
                                        
                                        .post(`/resourceCategory/${projectId}`)
                                        .set('Authorization', authorization)
                                        .send(resourceCategory)
                                        
                                        .end(function(err, res) {
                                            resourceCategoryId = res.body._id;
                                            createUser(
                                                request,
                                                userData.newUser,
                                                
                                                function(err, res) {
                                                    projectIdSecondUser =
                                                        res.body.project._id;
                                                    emailToBeInvited =
                                                        userData.newUser.email;
                                                    userId = res.body.id;
                                                    VerificationTokenModel.findOne(
                                                        { userId },
                                                        function(
                                                            
                                                            err,
                                                            
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
                                                                                                
                                                                                                err,
                                                                                                
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

    
    after(async function() {
        await GlobalConfig.removeTestConfig();
        
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
        
        await ResourceCategoryService.hardDeleteBy({ _id: resourceCategoryId });
    });

    
    it('should not be able to create new resource category', function(done) {
        
        const authorization = `Basic ${token}`;
        request
            
            .post(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            .send(resourceCategory)
            
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    
    it('should not be able to delete a resource category', function(done) {
        
        const authorization = `Basic ${token}`;
        request
            
            .delete(`/resourceCategory/${projectId}/${resourceCategoryId}`)
            .set('Authorization', authorization)
            
            .end(function(err, res) {
                expect(res).to.have.status(400);
                done();
            });
    });
    
    it('should be able to get all resource categories', function(done) {
        
        const authorization = `Basic ${token}`;
        request
            
            .get(`/resourceCategory/${projectId}`)
            .set('Authorization', authorization)
            
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


describe('Resource Category APIs accesible through API key', function() {
    
    this.timeout(20000);

    
    before(function(done) {
        
        this.timeout(40000);
        GlobalConfig.initTestConfig().then(function() {
            
            createUser(request, userData.user, function(err, res) {
                const project = res.body.project;
                projectId = project._id;
                apiKey = project.apiKey;
                done();
            });
        });
    });

    
    after(async function() {
        await GlobalConfig.removeTestConfig();
        
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
        
        await ResourceCategoryService.hardDeleteBy({ _id: resourceCategoryId });
    });

    
    it('should create a new resource category when proper `resourceCategoryName` field is given by an authenticated user', function(done) {
        request
            
            .post(`/resourceCategory/${projectId}`)
            
            .set('apiKey', apiKey)
            .send(resourceCategory)
            
            .end(function(err, res) {
                resourceCategoryId = res.body._id;
                expect(res).to.have.status(200);
                expect(res.body.name).to.be.equal(
                    resourceCategory.resourceCategoryName
                );
                done();
            });
    });

    
    it('should get all monitor Categories for an authenticated user by ProjectId', function(done) {
        request
            
            .get(`/resourceCategory/${projectId}`)
            
            .set('apiKey', apiKey)
            
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

    
    it('should delete a resource category when resourceCategoryId is valid', function(done) {
        request
            
            .delete(`/resourceCategory/${projectId}/${resourceCategoryId}`)
            
            .set('apiKey', apiKey)
            
            .end(function(err, res) {
                expect(res).to.have.status(200);
                done();
            });
    });
});


describe('Resource Category API - Check pagination for 12 resource categories', function() {
    
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

    
    before(async function() {
        
        this.timeout(60000);
        await GlobalConfig.initTestConfig();
        const checkCardData = await request.post('/stripe/checkCard').send({
            tokenId: 'tok_visa',
            
            email: userData.email,
            
            companyName: userData.companyName,
        });
        
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
                    
                    .post(`/resourceCategory/${projectId}`)
                    .set('Authorization', authorization)
                    .send({ resourceCategoryName });
                return sentRequests;
            }
        );
        await Promise.all(createdMonitorCategories);
    });

    
    after(async function() {
        await GlobalConfig.removeTestConfig();
        
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
        
        await ResourceCategoryService.hardDeleteBy({ _id: resourceCategoryId });
        await ResourceCategoryModel.deleteMany({ name: 'testPagination' });
    });

    
    it('should get first 10 resource categories with data length 10, skip 0, limit 10 and count 12', async function() {
        
        const authorization = `Basic ${token}`;
        const res = await request
            
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

    
    it('should get 2 last resource categories with data length 2, skip 10, limit 10 and count 12', async function() {
        
        const authorization = `Basic ${token}`;
        const res = await request
            
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

    
    it('should get 0 resource categories with data length 0, skip 20, limit 10 and count 12', async function() {
        
        const authorization = `Basic ${token}`;
        const res = await request
            
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
