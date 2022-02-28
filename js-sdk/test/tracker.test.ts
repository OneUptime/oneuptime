import chai from 'chai';

const expect = chai.expect;
import chaihttp from 'chai-http';
chai.use(chaihttp);

import { user, generateSecondRandomBusinessEmail } from './util';
const API_URL = 'http://localhost:3002/api';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'request' does not exist on type 'ChaiSta... Remove this comment to see the full error message
const request = chai.request.agent(API_URL);
const timeout = 5000;

import OneUptimeTracker from '../src/tracker';
const customTimeline = {
    category: 'cart',
    content: {
        message: 'test-content',
    },
    type: 'info',
};
let errorTracker: $TSFixMe;

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Tracker Timeline', function() {
    const sleep = (milliseconds: $TSFixMe) => {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    };
    this.timeout(timeout + 1000);
    let projectId: $TSFixMe, token: $TSFixMe, componentId;
    // create a new user
    const component = { name: 'Our Component' };

    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(done: $TSFixMe) {
        this.timeout(60000);
        sleep(5000).then(() => {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{ name: s... Remove this comment to see the full error message
            user.email = generateSecondRandomBusinessEmail();
            request
                .post('/user/signup')
                .send(user)
                .end(function(err: $TSFixMe, res: $TSFixMe) {
                    const project = res.body.project;
                    projectId = project._id;
                    token = res.body.tokens.jwtAccessToken;
                    request
                        .post(`/component/${projectId}`)
                        .set('Authorization', `Basic ${token}`)
                        .send(component)
                        .end(function(err: $TSFixMe, res: $TSFixMe) {
                            componentId = res.body._id;
                            request
                                .post(
                                    `/error-tracker/${projectId}/${componentId}/create`
                                )
                                .set('Authorization', `Basic ${token}`)
                                .send({ name: 'Application OneUptimeTracker' })
                                .end(function(err: $TSFixMe, res: $TSFixMe) {
                                    // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type 'Assertio... Remove this comment to see the full error message
                                    expect(res).to.have.status(200);
                                    expect(res.body).to.be.an('object');
                                    expect(res.body).to.have.property('_id');
                                    errorTracker = res.body;
                                    done();
                                });
                        });
                });
        });
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should take in custom timeline event', function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        tracker.addToTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        const timeline = tracker.getTimeline();
        expect(timeline).to.be.an('array');
        expect(timeline).to.have.lengthOf(1);
        expect(timeline[0].category).to.equal(customTimeline.category);
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should ensure timeline event contains eventId and timestamp', function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        tracker.addToTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        const timeline = tracker.getTimeline();
        expect(timeline[0].eventId).to.be.a('string');
        expect(timeline[0].timestamp).to.be.a('number');
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should ensure different timeline event have the same eventId', function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        tracker.addToTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        tracker.addToTimeline(
            customTimeline.category,
            customTimeline.content,
            'error'
        );
        const timeline = tracker.getTimeline();
        expect(timeline.length).to.equal(2); // two timeline events
        expect(timeline[0].eventId).to.equal(timeline[1].eventId); // their eveentId is the same till there is an error sent to the server
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should ensure max timline cant be set as a negative number', function() {
        const options = { maxTimeline: -5 };
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key,
            options
        );
        tracker.addToTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        tracker.addToTimeline(
            customTimeline.category,
            customTimeline.content,
            'error'
        );
        const timeline = tracker.getTimeline();
        expect(timeline.length).to.equal(2); // two timeline events
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should ensure new timeline event after max timeline are discarded', function() {
        const options = { maxTimeline: 2 };
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key,
            options
        );
        const customTimeline2 = {
            category: 'logout',
            content: {
                message: 'test-content',
            },
            type: 'success',
        };
        // add 3 timelinee events
        tracker.addToTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        tracker.addToTimeline(
            customTimeline2.category,
            customTimeline2.content,
            customTimeline2.type
        );
        tracker.addToTimeline(
            customTimeline.category,
            customTimeline.content,
            'debug'
        );
        const timeline = tracker.getTimeline();
        expect(timeline.length).to.equal(options.maxTimeline);
        expect(timeline[0].type).to.equal(customTimeline.type);
        expect(timeline[1].category).to.equal(customTimeline2.category);
    });
});
// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Tags', function() {
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should add tags ', function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const tag = { key: 'location', value: 'Atlanta' };
        tracker.setTag(tag.key, tag.value);
        const availableTags = tracker._getTags();
        expect(availableTags).to.be.an('array');
        expect(availableTags.length).to.equal(1);
        expect(availableTags[0]).to.have.property('key');
        expect(availableTags[0]).to.have.property('value');
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should add multiple tags ', function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const tags = [
            { key: 'location', value: 'Atlanta' },
            { key: 'city', value: 'anywhere' },
            { key: 'device', value: 'iOS' },
        ];
        tracker.setTags(tags);
        const availableTags = tracker._getTags();
        expect(availableTags).to.be.an('array');
        expect(availableTags.length).to.equal(3);
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should overwrite existing keys to avoid duplicate tags ', function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const tags = [
            { key: 'location', value: 'Atlanta' },
            { key: 'city', value: 'anywhere' },
            { key: 'location', value: 'Paris' },
            { key: 'device', value: 'iOS' },
            { key: 'location', value: 'London' },
        ];
        tracker.setTags(tags);
        const availableTags = tracker._getTags();
        expect(availableTags).to.be.an('array');
        expect(availableTags.length).to.equal(3); // since location repeated itself multiple times
        expect(availableTags[0].key).to.be.equal('location');
        expect(availableTags[0].value).to.be.equal('London'); // latest value for that tag
    });
});
// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Fingerpint', function() {
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create fingerprint as message for error capture without any fingerprint', function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const errorMessage = 'Uncaught Exception';
        tracker.captureMessage(errorMessage);
        const event = tracker.getCurrentEvent();
        expect(event.fingerprint[0]).to.equal(errorMessage);
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should use defined fingerprint array for error capture with fingerprint', function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const fingerprints = ['custom', 'errors'];
        tracker.setFingerprint(fingerprints);
        const errorMessage = 'Uncaught Exception';
        tracker.captureMessage(errorMessage);
        const event = tracker.getCurrentEvent();
        expect(event.fingerprint[0]).to.equal(fingerprints[0]);
        expect(event.fingerprint[1]).to.equal(fingerprints[1]);
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should use defined fingerprint string for error capture with fingerprint', function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const fingerprint = 'custom-fingerprint';
        tracker.setFingerprint(fingerprint);
        const errorMessage = 'Uncaught Exception';
        tracker.captureMessage(errorMessage);
        const event = tracker.getCurrentEvent();
        expect(event.fingerprint[0]).to.equal(fingerprint);
    });
});
// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Capture Message', function() {
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create an event ready for the server', function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const errorMessage = 'This is a test';
        tracker.captureMessage(errorMessage);
        const event = tracker.getCurrentEvent();
        expect(event.type).to.equal('message');
        expect(event.exception.message).to.equal(errorMessage);
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create an event ready for the server while having the timeline with same event id', function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        tracker.addToTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        const errorMessage = 'This is a test';
        tracker.captureMessage(errorMessage);
        const event = tracker.getCurrentEvent();
        expect(event.timeline.length).to.equal(2);
        expect(event.eventId).to.equal(event.timeline[0].eventId);
        expect(event.exception.message).to.equal(errorMessage);
    });
});
// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Capture Exception', function() {
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create an event ready for the server', async function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const errorMessage = 'Error Found';
        await tracker.captureException(new Error(errorMessage));
        const event = tracker.getCurrentEvent();
        expect(event.type).to.equal('exception');
        expect(event.exception.message).to.equal(errorMessage);
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create an event with a array of stacktrace ', async function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const errorMessage = 'Error Found';
        await tracker.captureException(new Error(errorMessage));
        const event = tracker.getCurrentEvent();
        expect(event.type).to.equal('exception');
        expect(event.exception.message).to.equal(errorMessage);
        expect(event.exception.stacktrace).to.be.an('object');
        expect(event.exception.stacktrace.frames).to.be.an('array');
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create an event with the object of the stacktrace in place', async function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const errorMessage = 'Error Found';
        await tracker.captureException(new Error(errorMessage));
        const event = tracker.getCurrentEvent();
        const frame = event.exception.stacktrace.frames[0];
        expect(frame).to.have.property('methodName');
        expect(frame).to.have.property('lineNumber');
        expect(frame).to.have.property('columnNumber');
        expect(frame).to.have.property('fileName');
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create an event and new event should have different id ', async function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        let event, newEvent;
        const errorMessage = 'Error Found';
        const errorMessageObj = 'Object Error Found';
        await tracker.captureMessage(errorMessage).then(evt => {
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            event = evt.data;
        });

        await tracker.captureException(new Error(errorMessageObj)).then(evt => {
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            newEvent = evt.data;
        });

        // ensure that the first event have a type message, same error message
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        expect(event.type).to.equal('message');
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        expect(event.content.message).to.equal(errorMessage);

        // ensure that the second event have a type exception, same error message
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        expect(newEvent.type).to.equal('exception');
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        expect(newEvent.content.message).to.equal(errorMessageObj);

        // confim their eventId is different
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        expect(event._id).to.not.equal(newEvent._id);
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should create an event that has timeline and new event having tags', async function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        let event, newEvent;
        const errorMessage = 'Error Found';
        const errorMessageObj = 'Object Error Found';
        // add a timelie action to the first event
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 1.
        tracker.addToTimeline(customTimeline);
        await tracker.captureMessage(errorMessage).then(evt => {
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            event = evt.data;
        });

        // add a tag to the second event
        tracker.setTag('test', 'content');
        await tracker.captureException(new Error(errorMessageObj)).then(evt => {
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            newEvent = evt.data;
        });

        // ensure that the first event have a type message, same error message and two timeline (the custom and the generic one)
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        expect(event.type).to.equal('message');
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        expect(event.content.message).to.equal(errorMessage);
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        expect(event.timeline).to.have.lengthOf(2);
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        expect(event.tags).to.have.lengthOf(1); // the default event tag added

        // ensure that the second event have a type exception, same error message and one timeline (the generic one)
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        expect(newEvent.type).to.equal('exception');
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        expect(newEvent.content.message).to.equal(errorMessageObj);
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        expect(newEvent.timeline).to.have.lengthOf(1);
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        expect(newEvent.tags).to.have.lengthOf(2); // the default and custom tag
    });
});
// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('SDK Version', function() {
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should contain version number and sdk name in captured message', function() {
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const errorMessage = 'Uncaught Exception';
        tracker.captureMessage(errorMessage);
        const event = tracker.getCurrentEvent();
        expect(event.sdk.name).to.be.a('string');
        expect(event.sdk.version).to.match(/(([0-9])+\.([0-9])+\.([0-9])+)/); // confirm that the versiion follows the patter XX.XX.XX where X is a non negative integer
    });
});
// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('Code Capture Snippet', function() {
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should add code capture to stack trace when flag is passed in options', async function() {
        const options = { captureCodeSnippet: true };
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key,
            options
        );
        let event = null;
        const errorMessageObj = 'Object Error Found';
        await tracker.captureException(new Error(errorMessageObj)).then(evt => {
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            event = evt.data;
        });
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        const incidentFrame = event.content.stacktrace.frames[0];
        expect(incidentFrame).to.have.property('linesBeforeError');
        expect(incidentFrame).to.have.property('linesAfterError');
        expect(incidentFrame).to.have.property('errorLine');
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should add code capture and confirm data type of fields added to frame', async function() {
        const options = { captureCodeSnippet: true };
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key,
            options
        );
        let event = null;
        const errorMessageObj = 'Object Error Found';
        await tracker.captureException(new Error(errorMessageObj)).then(evt => {
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            event = evt.data;
        });
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        const incidentFrame = event.content.stacktrace.frames[0];
        expect(incidentFrame.errorLine).to.be.a('string');
        expect(incidentFrame.linesBeforeError).to.be.an('array');
        expect(incidentFrame.linesAfterError).to.be.an('array');
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should not add code capture to stack trace when flag is passed in options', async function() {
        const options = { captureCodeSnippet: false };
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key,
            options
        );
        let event = null;
        const errorMessageObj = 'Object Error Found';
        await tracker.captureException(new Error(errorMessageObj)).then(evt => {
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            event = evt.data;
        });
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        const incidentFrame = event.content.stacktrace.frames[0];
        expect(incidentFrame).to.not.have.property('linesBeforeError');
        expect(incidentFrame).to.not.have.property('linesAfterError');
        expect(incidentFrame).to.not.have.property('errorLine');
    });
    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it('should add code capture to stack trace by default when unwanted flag is passed in options', async function() {
        const options = { captureCodeSnippet: 'heyy' }; // expects a true or false but it defaults to true
        const tracker = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key,
            options
        );
        let event = null;
        const errorMessageObj = 'Object Error Found';
        await tracker.captureException(new Error(errorMessageObj)).then(evt => {
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            event = evt.data;
        });
        // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
        const incidentFrame = event.content.stacktrace.frames[0];
        expect(incidentFrame).to.have.property('linesBeforeError');
        expect(incidentFrame).to.have.property('linesAfterError');
        expect(incidentFrame).to.have.property('errorLine');
    });
});
