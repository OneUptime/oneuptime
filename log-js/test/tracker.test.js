/* eslint-disable no-undef */

const chai = require('chai');

const expect = chai.expect;

import FyipeLogger from '../src/logger';
const customTimeline = {
    category: 'cart',
    content: {
        message: 'test-content',
    },
    type: 'info',
};

describe('Tracker Timeline', function() {
    it('should take in custom timeline event', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        tracker.addTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        const timeline = tracker.getTimeline();
        expect(timeline).to.be.an('array');
        expect(timeline).to.have.lengthOf(1);
        expect(timeline[0].category).to.equal(customTimeline.category);
    });
    it('should ensure timeline event contains eventId and timestamp', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        tracker.addTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        const timeline = tracker.getTimeline();
        expect(timeline[0].eventId).to.be.a('string');
        expect(timeline[0].timestamp).to.be.a('number');
    });
    it('should ensure different timeline event have the same eventId', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        tracker.addTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        tracker.addTimeline(
            customTimeline.category,
            customTimeline.content,
            'error'
        );
        const timeline = tracker.getTimeline();
        expect(timeline.length).to.equal(2); // two timeline events
        expect(timeline[0].eventId).to.equal(timeline[1].eventId); // their eveentId is the same till there is an error sent to the server
    });
    it('should ensure max timline cant be set as a negative number', function() {
        const options = { maxTimeline: -5 };
        const tracker = new FyipeLogger('URL', 'ID', 'KEY', options);
        tracker.addTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        tracker.addTimeline(
            customTimeline.category,
            customTimeline.content,
            'error'
        );
        const timeline = tracker.getTimeline();
        expect(timeline.length).to.equal(2); // two timeline events
    });
    it('should ensure new timeline event after max timeline are discarded', function() {
        const options = { maxTimeline: 2 };
        const tracker = new FyipeLogger('URL', 'ID', 'KEY', options);
        const customTimeline2 = {
            category: 'logout',
            content: {
                message: 'test-content',
            },
            type: 'success',
        };
        // add 3 timelinee events
        tracker.addTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        tracker.addTimeline(
            customTimeline2.category,
            customTimeline2.content,
            customTimeline2.type
        );
        tracker.addTimeline(
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
describe('Tags', function() {
    it('should add tags ', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        const tag = { key: 'location', value: 'Atlanta' };
        tracker.setTag(tag.key, tag.value);
        const availableTags = tracker.getTags();
        expect(availableTags).to.be.an('array');
        expect(availableTags.length).to.equal(1);
        expect(availableTags[0]).to.have.property('key');
        expect(availableTags[0]).to.have.property('value');
    });
    it('should add multiple tags ', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        const tags = [
            { key: 'location', value: 'Atlanta' },
            { key: 'city', value: 'anywhere' },
            { key: 'device', value: 'iOS' },
        ];
        tracker.setTags(tags);
        const availableTags = tracker.getTags();
        expect(availableTags).to.be.an('array');
        expect(availableTags.length).to.equal(3);
    });
    it('should overwrite existing keys to avoid duplicate tags ', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        const tags = [
            { key: 'location', value: 'Atlanta' },
            { key: 'city', value: 'anywhere' },
            { key: 'location', value: 'Paris' },
            { key: 'device', value: 'iOS' },
            { key: 'location', value: 'London' },
        ];
        tracker.setTags(tags);
        const availableTags = tracker.getTags();
        expect(availableTags).to.be.an('array');
        expect(availableTags.length).to.equal(3); // since location repeated itself multiple times
        expect(availableTags[0].key).to.be.equal('location');
        expect(availableTags[0].value).to.be.equal('London'); // latest value for that tag
    });
});
describe('Fingerpint', function() {
    it('should create fingerprint as message for error capture without any fingerprint', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        const errorMessage = 'Uncaught Exception';
        tracker.captureMessage(errorMessage);
        const event = tracker.getCurrentEvent();
        expect(event.fingerprint[0]).to.equal(errorMessage);
    });
    it('should use defined fingerprint array for error capture with fingerprint', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        const fingerprints = ['custom', 'errors'];
        tracker.setFingerprint(fingerprints);
        const errorMessage = 'Uncaught Exception';
        tracker.captureMessage(errorMessage);
        const event = tracker.getCurrentEvent();
        expect(event.fingerprint[0]).to.equal(fingerprints[0]);
        expect(event.fingerprint[1]).to.equal(fingerprints[1]);
    });
    it('should use defined fingerprint string for error capture with fingerprint', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        const fingerprint = 'custom-fingerprint';
        tracker.setFingerprint(fingerprint);
        const errorMessage = 'Uncaught Exception';
        tracker.captureMessage(errorMessage);
        const event = tracker.getCurrentEvent();
        expect(event.fingerprint[0]).to.equal(fingerprint);
    });
});
describe('Capture Message', function() {
    it('should create an event ready for the server', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        const errorMessage = 'This is a test';
        tracker.captureMessage(errorMessage);
        const event = tracker.getCurrentEvent();
        expect(event.type).to.equal('message');
        expect(event.exception.message).to.equal(errorMessage);
    });
    it('should create an event ready for the server while having the timeline with same event id', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        tracker.addTimeline(
            customTimeline.category,
            customTimeline.content,
            customTimeline.type
        );
        const errorMessage = 'This is a test';
        tracker.captureMessage(errorMessage);
        const event = tracker.getCurrentEvent();
        expect(event.timeline.length).to.equal(1);
        expect(event.eventId).to.equal(event.timeline[0].eventId);
        expect(event.exception.message).to.equal(errorMessage);
    });
});
describe('Capture Exception', function() {
    it('should create an event ready for the server', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        const errorMessage = 'Error Found';
        tracker.captureException(new Error(errorMessage));
        const event = tracker.getCurrentEvent();
        expect(event.type).to.equal('exception');
        expect(event.exception.message).to.equal(errorMessage);
    });
    it('should create an event with a array of stacktrace ', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        const errorMessage = 'Error Found';
        tracker.captureException(new Error(errorMessage));
        const event = tracker.getCurrentEvent();
        expect(event.type).to.equal('exception');
        expect(event.exception.message).to.equal(errorMessage);
        expect(event.exception.stacktrace).to.be.an('object');
        expect(event.exception.stacktrace.frames).to.be.an('array');
    });
    it('should create an event with the object of the stacktrace in place', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        const errorMessage = 'Error Found';
        tracker.captureException(new Error(errorMessage));
        const event = tracker.getCurrentEvent();
        const frame = event.exception.stacktrace.frames[0];
        expect(frame).to.have.property('methodName');
        expect(frame).to.have.property('lineNumber');
        expect(frame).to.have.property('columnNumber');
        expect(frame).to.have.property('fileName');
    });
    it('should create an event and new event should have different id ', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        const errorMessage = 'Error Found';
        const errorMessageObj = 'Object Error Found';
        tracker.captureMessage(errorMessage);
        const event = tracker.getCurrentEvent();

        tracker.captureException(new Error(errorMessageObj));
        const newEvent = tracker.getCurrentEvent();

        // ensure that the first event have a type message, same error message
        expect(event.type).to.equal('message');
        expect(event.exception.message).to.equal(errorMessage);

        // ensure that the second event have a type exception, same error message
        expect(newEvent.type).to.equal('exception');
        expect(newEvent.exception.message).to.equal(errorMessageObj);

        // confim their eventId is different
        expect(event.eventId).to.not.equal(newEvent.eventId);
    });
    it('should create an event that has timeline and new event having tags', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        const errorMessage = 'Error Found';
        const errorMessageObj = 'Object Error Found';
        // add a timelie action to the first event
        tracker.addTimeline(customTimeline);
        tracker.captureMessage(errorMessage);
        const event = tracker.getCurrentEvent();

        // add a tag to the second event
        tracker.setTag('test', 'content');
        tracker.captureException(new Error(errorMessageObj));
        const newEvent = tracker.getCurrentEvent();

        // ensure that the first event have a type message, same error message and one timeline
        expect(event.type).to.equal('message');
        expect(event.exception.message).to.equal(errorMessage);
        expect(event.timeline).to.have.lengthOf(1);
        expect(event.tags).to.have.lengthOf(0);

        // ensure that the second event have a type exception, same error message and no timeline
        expect(newEvent.type).to.equal('exception');
        expect(newEvent.exception.message).to.equal(errorMessageObj);
        expect(newEvent.timeline).to.have.lengthOf(0);
        expect(newEvent.tags).to.have.lengthOf(1);
    });
});
