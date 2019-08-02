process.env.PORT = 3020;
var expect = require('chai').expect;
var userData = require('./data/user');
var chai = require('chai');
chai.use(require('chai-http'));
var app = require('../server');
var mailParser = require('mailparser').simpleParser;


var request = chai.request.agent(app);
var UserService = require('../backend/services/userService');
var ProjectService = require('../backend/services/projectService');
var VerificationTokenModel = require('../backend/models/verificationToken');
var userId, emailContent, projectId;
var { imap, openBox } = require('./utils/mail');


describe('Email verification API', function () {
    this.timeout(20000);

    before(function (done) {
        this.timeout(30000);
        request.post('/user/signup').send(userData.user).end(function (err, res) {
            userId = res.body.id;
            projectId = res.body.project._id;
            done();
        });
    });

    after(async function () {
        await UserService.hardDeleteBy({ email: { $in: [userData.user.email, userData.newUser.email, userData.anotherUser.email] } });
        await ProjectService.hardDeleteBy({ _id: projectId }, userId);
    });

    it('should sent email verification', function (done) {
        imap.once('ready', function () {
            openBox(function (err) {
                if (err) throw err;
                var f = imap.seq.fetch('1:2', {
                    bodies: [''],
                    struct: true
                });
                f.on('message', function (msg) {
                    msg.on('body', function (stream) {
                        mailParser(stream, {}, async function (err, parsedMail) {
                            if (parsedMail.subject === '[Fyipe] Please confirm the email linked to your Fyipe ID') {
                                emailContent = parsedMail.text.includes('Please click on this link to verify your');
                                expect(emailContent).to.be.equal(true);
                            }
                        });
                    });
                });
                f.once('end', function () {
                    done();
                    imap.end();
                });
            });
        });
        imap.connect();
    });
    
    it('should not login non-verified user', async function () {
        try {
            await request.post('/user/login').send({
                email: userData.user.email,
                password: userData.user.password
            });
        } catch (error) {
            expect(error).to.have.status(401);
        }
    });

    it('should verify the user', async function () {
        var token = await VerificationTokenModel.findOne({ userId });
        try {
            await request.get(`/user/confirmation/${token.token}`).redirects(0);
        } catch (error) {
            expect(error).to.have.status(302);
            var user = await UserService.findOneBy({ _id: userId });
            expect(user.isVerified).to.be.equal(true);
        }
    });

    it('should login the verified user', async function () {
        var res =  await request.post('/user/login').send({
            email: userData.user.email,
            password: userData.user.password
        }); 
        expect(res).to.have.status(200);
    });
});