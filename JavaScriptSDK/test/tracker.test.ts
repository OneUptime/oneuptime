import chai from 'chai';
import ObjectID from 'Common/Types/ObjectID';

const expect: $TSFixMe = chai.expect;
import chaihttp from 'chai-http';
chai.use(chaihttp);

import { user, generateSecondRandomBusinessEmail } from './util';
const API_URL: string = 'http://localhost:3002/api';

const request: $TSFixMe = chai.request.agent(API_URL);
const timeout: $TSFixMe = 5000;

import OneUptimeTracker from '../src/tracker';
const customTimeline: $TSFixMe = {
    category: 'cart',
    content: {
        message: 'test-content',
    },
    type: 'info',
};
let errorTracker: $TSFixMe;

describe('Tracker Timeline', function (): void {
    const sleep: Function = (milliseconds: $TSFixMe): void => {
        return new Promise((resolve: $TSFixMe) =>  setTimeout(resolve, milliseconds));
    };
    this.timeout(timeout + 1000);
    let projectId: ObjectID, token: $TSFixMe, componentId;
    // create a new user
    const component: $TSFixMe = { name: 'Our Component' };

    before(function (done: $TSFixMe): void {
        this.timeout(60000);
        sleep(5000).then(() => {
            user.email = generateSecondRandomBusinessEmail();
            request
                .post('/user/signup')
                .send(user)
                .end((err: $TSFixMe, res: $TSFixMe): void => {
                    const project: $TSFixMe = res.body.project;
                    projectId = project._id;
                    token = res.body.tokens.jwtAccessToken;
                    request
                        .post(`/component/${projectId}`)
                        .set('Authorization', `Basic ${token}`)
                        .send(component)
                        .end((err: $TSFixMe, res: $TSFixMe): void => {
                            componentId = res.body._id;
                            request
                                .post(
                                    `/error-tracker/${projectId}/${componentId}/create`
                                )
                                .set('Authorization', `Basic ${token}`)
                                .send({ name: 'Application OneUptimeTracker' })
                                .end((err: $TSFixMe, res: $TSFixMe): void => {
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

    it('should take in custom timeline event', (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        tracker.addToTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        const timeline: $TSFixMe = tracker.getTimeline();
        expect(timeline).to.be.an('array');
        expect(timeline).to.have.lengthOf(1);
        expect(timeline[0].category).to.equal(customTimeline.category);
    });

    it('should ensure timeline event contains eventId and timestamp', (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        tracker.addToTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        const timeline: $TSFixMe = tracker.getTimeline();
        expect(timeline[0].eventId).to.be.a('string');
        expect(timeline[0].timestamp).to.be.a('number');
    });

    it('should ensure different timeline event have the same eventId', (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
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
        const timeline: $TSFixMe = tracker.getTimeline();
        expect(timeline.length).to.equal(2); // two timeline events
        expect(timeline[0].eventId).to.equal(timeline[1].eventId); // their eveentId is the same till there is an error sent to the server
    });

    it('should ensure max timline cant be set as a negative number', (): void => {
        const options: $TSFixMe = { maxTimeline: -5 };
        const tracker: $TSFixMe = new OneUptimeTracker(
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
        const timeline: $TSFixMe = tracker.getTimeline();
        expect(timeline.length).to.equal(2); // two timeline events
    });

    it('should ensure new timeline event after max timeline are discarded', (): void => {
        const options: $TSFixMe = { maxTimeline: 2 };
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key,
            options
        );
        const customTimeline2: $TSFixMe = {
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
        const timeline: $TSFixMe = tracker.getTimeline();
        expect(timeline.length).to.equal(options.maxTimeline);
        expect(timeline[0].type).to.equal(customTimeline.type);
        expect(timeline[1].category).to.equal(customTimeline2.category);
    });
});

describe('Tags', (): void => {
    it('should add tags ', (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const tag: $TSFixMe = { key: 'location', value: 'Atlanta' };
        tracker.setTag(tag.key, tag.value);
        const availableTags: $TSFixMe = tracker._getTags();
        expect(availableTags).to.be.an('array');
        expect(availableTags.length).to.equal(1);
        expect(availableTags[0]).to.have.property('key');
        expect(availableTags[0]).to.have.property('value');
    });

    it('should add multiple tags ', (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const tags: $TSFixMe = [
            { key: 'location', value: 'Atlanta' },
            { key: 'city', value: 'anywhere' },
            { key: 'device', value: 'iOS' },
        ];
        tracker.setTags(tags);
        const availableTags: $TSFixMe = tracker._getTags();
        expect(availableTags).to.be.an('array');
        expect(availableTags.length).to.equal(3);
    });

    it('should overwrite existing keys to avoid duplicate tags ', (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const tags: $TSFixMe = [
            { key: 'location', value: 'Atlanta' },
            { key: 'city', value: 'anywhere' },
            { key: 'location', value: 'Paris' },
            { key: 'device', value: 'iOS' },
            { key: 'location', value: 'London' },
        ];
        tracker.setTags(tags);
        const availableTags: $TSFixMe = tracker._getTags();
        expect(availableTags).to.be.an('array');
        expect(availableTags.length).to.equal(3); // since location repeated itself multiple times
        expect(availableTags[0].key).to.be.equal('location');
        expect(availableTags[0].value).to.be.equal('London'); // latest value for that tag
    });
});

describe('Fingerpint', (): void => {
    it('should create fingerprint as message for error capture without any fingerprint', (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const errorMessage: string = 'Uncaught Exception';
        tracker.captureMessage(errorMessage);
        const event: $TSFixMe = tracker.getCurrentEvent();
        expect(event.fingerprint[0]).to.equal(errorMessage);
    });

    it('should use defined fingerprint array for error capture with fingerprint', (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const fingerprints: $TSFixMe = ['custom', 'errors'];
        tracker.setFingerprint(fingerprints);
        const errorMessage: string = 'Uncaught Exception';
        tracker.captureMessage(errorMessage);
        const event: $TSFixMe = tracker.getCurrentEvent();
        expect(event.fingerprint[0]).to.equal(fingerprints[0]);
        expect(event.fingerprint[1]).to.equal(fingerprints[1]);
    });

    it('should use defined fingerprint string for error capture with fingerprint', (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const fingerprint: string = 'custom-fingerprint';
        tracker.setFingerprint(fingerprint);
        const errorMessage: string = 'Uncaught Exception';
        tracker.captureMessage(errorMessage);
        const event: $TSFixMe = tracker.getCurrentEvent();
        expect(event.fingerprint[0]).to.equal(fingerprint);
    });
});

describe('Capture Message', (): void => {
    it('should create an event ready for the server', (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const errorMessage: string = 'This is a test';
        tracker.captureMessage(errorMessage);
        const event: $TSFixMe = tracker.getCurrentEvent();
        expect(event.type).to.equal('message');
        expect(event.exception.message).to.equal(errorMessage);
    });

    it('should create an event ready for the server while having the timeline with same event id', (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        tracker.addToTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        const errorMessage: string = 'This is a test';
        tracker.captureMessage(errorMessage);
        const event: $TSFixMe = tracker.getCurrentEvent();
        expect(event.timeline.length).to.equal(2);
        expect(event.eventId).to.equal(event.timeline[0].eventId);
        expect(event.exception.message).to.equal(errorMessage);
    });
});

describe('Capture Exception', (): void => {
    it('should create an event ready for the server', async (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const errorMessage: string = 'Error Found';
        await tracker.captureException(new Error(errorMessage));
        const event: $TSFixMe = tracker.getCurrentEvent();
        expect(event.type).to.equal('exception');
        expect(event.exception.message).to.equal(errorMessage);
    });

    it('should create an event with a array of stacktrace ', async (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const errorMessage: string = 'Error Found';
        await tracker.captureException(new Error(errorMessage));
        const event: $TSFixMe = tracker.getCurrentEvent();
        expect(event.type).to.equal('exception');
        expect(event.exception.message).to.equal(errorMessage);
        expect(event.exception.stacktrace).to.be.an('object');
        expect(event.exception.stacktrace.frames).to.be.an('array');
    });

    it('should create an event with the object of the stacktrace in place', async (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const errorMessage: string = 'Error Found';
        await tracker.captureException(new Error(errorMessage));
        const event: $TSFixMe = tracker.getCurrentEvent();
        const frame: $TSFixMe = event.exception.stacktrace.frames[0];
        expect(frame).to.have.property('methodName');
        expect(frame).to.have.property('lineNumber');
        expect(frame).to.have.property('columnNumber');
        expect(frame).to.have.property('fileName');
    });

    it('should create an event and new event should have different id ', async (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        let event: $TSFixMe, newEvent: $TSFixMe;
        const errorMessage: string = 'Error Found';
        const errorMessageObj: string = 'Object Error Found';
        await tracker.captureMessage(errorMessage).then(evt => {
            event = evt.data;
        });

        await tracker.captureException(new Error(errorMessageObj)).then(evt => {
            newEvent = evt.data;
        });

        // ensure that the first event have a type message, same error message

        expect(event.type).to.equal('message');

        expect(event.content.message).to.equal(errorMessage);

        // ensure that the second event have a type exception, same error message

        expect(newEvent.type).to.equal('exception');

        expect(newEvent.content.message).to.equal(errorMessageObj);

        // confim their eventId is different

        expect(event._id).to.not.equal(newEvent._id);
    });

    it('should create an event that has timeline and new event having tags', async (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        let event: $TSFixMe, newEvent: $TSFixMe;
        const errorMessage: string = 'Error Found';
        const errorMessageObj: string = 'Object Error Found';
        // add a timelie action to the first event

        tracker.addToTimeline(customTimeline);
        await tracker.captureMessage(errorMessage).then(evt => {
            event = evt.data;
        });

        // add a tag to the second event
        tracker.setTag('test', 'content');
        await tracker.captureException(new Error(errorMessageObj)).then(evt => {
            newEvent = evt.data;
        });

        // ensure that the first event have a type message, same error message and two timeline (the custom and the generic one)

        expect(event.type).to.equal('message');

        expect(event.content.message).to.equal(errorMessage);

        expect(event.timeline).to.have.lengthOf(2);

        expect(event.tags).to.have.lengthOf(1); // the default event tag added

        // ensure that the second event have a type exception, same error message and one timeline (the generic one)

        expect(newEvent.type).to.equal('exception');

        expect(newEvent.content.message).to.equal(errorMessageObj);

        expect(newEvent.timeline).to.have.lengthOf(1);

        expect(newEvent.tags).to.have.lengthOf(2); // the default and custom tag
    });
});

describe('SDK Version', (): void => {
    it('should contain version number and sdk name in captured message', (): void => {
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key
        );
        const errorMessage: string = 'Uncaught Exception';
        tracker.captureMessage(errorMessage);
        const event: $TSFixMe = tracker.getCurrentEvent();
        expect(event.sdk.name).to.be.a('string');
        expect(event.sdk.version).to.match(/(([0-9])+\.([0-9])+\.([0-9])+)/); // confirm that the versiion follows the patter XX.XX.XX where X is a non negative integer
    });
});

describe('Code Capture Snippet', (): void => {
    it('should add code capture to stack trace when flag is passed in options', async (): void => {
        const options: $TSFixMe = { captureCodeSnippet: true };
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key,
            options
        );
        let event: $TSFixMe = null;
        const errorMessageObj: string = 'Object Error Found';
        await tracker.captureException(new Error(errorMessageObj)).then(evt => {
            event = evt.data;
        });

        const incidentFrame: $TSFixMe = event.content.stacktrace.frames[0];
        expect(incidentFrame).to.have.property('linesBeforeError');
        expect(incidentFrame).to.have.property('linesAfterError');
        expect(incidentFrame).to.have.property('errorLine');
    });

    it('should add code capture and confirm data type of fields added to frame', async (): void => {
        const options: $TSFixMe = { captureCodeSnippet: true };
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key,
            options
        );
        let event: $TSFixMe = null;
        const errorMessageObj: string = 'Object Error Found';
        await tracker.captureException(new Error(errorMessageObj)).then(evt => {
            event = evt.data;
        });

        const incidentFrame: $TSFixMe = event.content.stacktrace.frames[0];
        expect(incidentFrame.errorLine).to.be.a('string');
        expect(incidentFrame.linesBeforeError).to.be.an('array');
        expect(incidentFrame.linesAfterError).to.be.an('array');
    });

    it('should not add code capture to stack trace when flag is passed in options', async (): void => {
        const options: $TSFixMe = { captureCodeSnippet: false };
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key,
            options
        );
        let event: $TSFixMe = null;
        const errorMessageObj: string = 'Object Error Found';
        await tracker.captureException(new Error(errorMessageObj)).then(evt => {
            event = evt.data;
        });

        const incidentFrame: $TSFixMe = event.content.stacktrace.frames[0];
        expect(incidentFrame).to.not.have.property('linesBeforeError');
        expect(incidentFrame).to.not.have.property('linesAfterError');
        expect(incidentFrame).to.not.have.property('errorLine');
    });

    it('should add code capture to stack trace by default when unwanted flag is passed in options', async (): void => {
        const options: $TSFixMe = { captureCodeSnippet: 'heyy' }; // expects a true or false but it defaults to true
        const tracker: $TSFixMe = new OneUptimeTracker(
            API_URL,
            errorTracker._id,
            errorTracker.key,
            options
        );
        let event: $TSFixMe = null;
        const errorMessageObj: string = 'Object Error Found';
        await tracker.captureException(new Error(errorMessageObj)).then(evt => {
            event = evt.data;
        });

        const incidentFrame: $TSFixMe = event.content.stacktrace.frames[0];
        expect(incidentFrame).to.have.property('linesBeforeError');
        expect(incidentFrame).to.have.property('linesAfterError');
        expect(incidentFrame).to.have.property('errorLine');
    });
});
