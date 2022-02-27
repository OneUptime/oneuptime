export default {
    create: async function(data: $TSFixMe) {
        const _this = this;

        // prepare issue model
        let issue = new IssueModel();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type 'Document<a... Remove this comment to see the full error message
        issue.name = data.exception ? data.exception.type : 'Unknown Error';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'description' does not exist on type 'Doc... Remove this comment to see the full error message
        issue.description = data.exception ? data.exception.message : '';

        // generate hash from fingerprint
        const hash = sha256(data.fingerprint.join('')).toString();
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fingerprintHash' does not exist on type ... Remove this comment to see the full error message
        issue.fingerprintHash = hash;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fingerprint' does not exist on type 'Doc... Remove this comment to see the full error message
        issue.fingerprint = data.fingerprint;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type 'Document<a... Remove this comment to see the full error message
        issue.type = data.type;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerId' does not exist on type '... Remove this comment to see the full error message
        issue.errorTrackerId = data.errorTrackerId;

        const savedIssue = await issue.save();
        const populateIssue = [
            { path: 'errorTrackerId', select: 'name' },
            { path: 'resolvedById', select: 'name' },
            { path: 'ignoredById', select: 'name' },
        ];

        const selectIssue =
            'name description errorTrackerId type fingerprint fingerprintHash createdAt deleted deletedAt deletedById resolved resolvedAt resolvedById ignored ignoredAt ignoredById';

        issue = await _this.findOneBy({
            query: { _id: savedIssue._id },
            select: selectIssue,
            populate: populateIssue,
        });
        return issue;
    },
    // find a list of Issues
    async findBy({ query, limit, skip, select, populate }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let issuesQuery = IssueModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        issuesQuery = handleSelect(select, issuesQuery);
        issuesQuery = handlePopulate(populate, issuesQuery);

        const issues = await issuesQuery;

        return issues;
    },

    async findOneBy({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let issueQuery = IssueModel.findOne(query).lean();

        issueQuery = handleSelect(select, issueQuery);
        issueQuery = handlePopulate(populate, issueQuery);

        const issue = await issueQuery;
        return issue;
    },
    findOneByHashAndErrorTracker: async function(
        fingerprint: $TSFixMe,
        errorTrackerId: $TSFixMe
    ) {
        const query = {};
        const hash = sha256(fingerprint.join('')).toString();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'deleted' does not exist on type '{}'.
        if (!query.deleted) query.deleted = false;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'fingerprintHash' does not exist on type ... Remove this comment to see the full error message
        query.fingerprintHash = hash;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'errorTrackerId' does not exist on type '... Remove this comment to see the full error message
        query.errorTrackerId = errorTrackerId;
        const issue = await IssueModel.findOne(query)
            .lean()
            .populate('resolvedById', 'name')
            .populate('ignoredById', 'name');
        return issue;
    },
    updateOneBy: async function(
        query: $TSFixMe,
        data: $TSFixMe,
        unsetData = null
    ) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let issue = await IssueModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        if (unsetData) {
            // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
            issue = await IssueModel.findOneAndUpdate(
                query,
                { $unset: unsetData },
                {
                    new: true,
                }
            );
        }

        const populateIssue = [
            { path: 'errorTrackerId', select: 'name' },
            { path: 'resolvedById', select: 'name' },
            { path: 'ignoredById', select: 'name' },
        ];

        const selectIssue =
            'name description errorTrackerId type fingerprint fingerprintHash createdAt deleted deletedAt deletedById resolved resolvedAt resolvedById ignored ignoredAt ignoredById';

        issue = await this.findOneBy({
            query,
            select: selectIssue,
            populate: populateIssue,
        });

        return issue;
    },
    deleteBy: async function(
        query: $TSFixMe,
        userId: $TSFixMe,
        componentId: $TSFixMe
    ) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const issue = await IssueModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedAt: Date.now(),
                    deletedById: userId,
                },
            },
            { new: true }
        ).populate('deletedById', 'name');
        if (issue) {
            const component = await ComponentService.findOneBy({
                query: { _id: componentId },
                select: 'projectId',
            });

            // @ts-expect-error ts-migrate(2554) FIXME: Expected 5 arguments, but got 4.
            NotificationService.create(
                component.projectId,
                `An Issue under Error Tracker ${issue.errorTrackerId.name} was deleted under the component ${component.name} by ${issue.deletedById.name}`,
                issue.deletedById._id,
                'errorTrackerIssueaddremove'
            ).catch(error => {
                errorService.log('NotificationService.create', error);
            });
            // run in the background
            RealTimeService.sendErrorTrackerIssueDelete(issue);
            return issue;
        } else {
            return null;
        }
    },

    countBy: async function(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await IssueModel.countDocuments(query);
        return count;
    },
};

import IssueModel from '../models/issue';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'cryp... Remove this comment to see the full error message
import sha256 from 'crypto-js/sha256';
import ComponentService from './componentService';
import RealTimeService from './realTimeService';
import NotificationService from './notificationService';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
import errorService from 'common-server/utils/error';
