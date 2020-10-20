/* eslint-disable no-undef */

const chai = require('chai');

const expect = chai.expect;

import FyipeLogger from '../src/logger';

describe('FyipeLogger Tracker', function() {
    it('should take in custom timeline event', function() {
        const tracker = new FyipeLogger('URL', 'ID', 'KEY');
        const customTimeline = {
            category: 'cart',
            content: {
                message: 'test-content',
            },
            type: 'info',
        };
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
        const customTimeline = {
            category: 'cart',
            content: {
                message: 'test-content',
            },
            type: 'info',
        };
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
        const customTimeline = {
            category: 'cart',
            content: {
                message: 'test-content',
            },
            type: 'info',
        };
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
    it('should ensure new timeline event after max timeline are discarded', function() {
        const options = { maxTimeline: 2 };
        const tracker = new FyipeLogger('URL', 'ID', 'KEY', options);
        const customTimeline = {
            category: 'cart',
            content: {
                message: 'test-content',
            },
            type: 'info',
        };
        const customTimeline2 = {
            category: 'logout',
            content: {
                message: 'test-content',
            },
            type: 'success',
        };
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
        expect(timeline.length).to.equal(options.maxTimeline); // two timeline events
        expect(timeline[0].type).to.equal(customTimeline.type);
        expect(timeline[1].category).to.equal(customTimeline2.category);
    });
});
