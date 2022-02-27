export default {
    create: async function(data: $TSFixMe) {
        const _this = this;

        // prepare issue member model
        let issueMember = new IssueMemberModel();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'userId' does not exist on type 'Document... Remove this comment to see the full error message
        issueMember.userId = data.userId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'issueId' does not exist on type 'Documen... Remove this comment to see the full error message
        issueMember.issueId = data.issueId;

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdById' does not exist on type 'Doc... Remove this comment to see the full error message
        issueMember.createdById = data.createdById;

        const savedIssueMember = await issueMember.save();

        const selectIssueMember =
            'issueId userId createdAt createdById removed removedAt removedById';

        const populateIssueMember = [
            { path: 'issueId', select: 'name' },

            { path: 'userId', select: 'name email' },
        ];
        issueMember = await _this.findOneBy({
            query: { _id: savedIssueMember._id },
            select: selectIssueMember,
            populate: populateIssueMember,
        });
        return issueMember;
    },
    // find a list of Members assigned to an Issue
    async findBy({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        let issuesQuery = IssueMemberModel.find(query).lean();

        issuesQuery = handleSelect(select, issuesQuery);
        issuesQuery = handlePopulate(populate, issuesQuery);

        const issues = await issuesQuery;
        return issues;
    },
    async findOneBy({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        let issueMemberQuery = IssueMemberModel.findOne(query).lean();

        issueMemberQuery = handleSelect(select, issueMemberQuery);
        issueMemberQuery = handlePopulate(populate, issueMemberQuery);

        const issueMember = await issueMemberQuery;

        return issueMember;
    },
    updateOneBy: async function(
        query: $TSFixMe,
        data: $TSFixMe,
        unsetData = null
    ) {
        if (!query) {
            query = {};
        }

        let issueMember = await IssueMemberModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        if (unsetData) {
            // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
            issueMember = await IssueMemberModel.findOneAndUpdate(
                query,
                { $unset: unsetData },
                {
                    new: true,
                }
            );
        }

        const selectIssueMember =
            'issueId userId createdAt createdById removed removedAt removedById';

        const populateIssueMember = [
            { path: 'issueId', select: 'name' },

            { path: 'userId', select: 'name email' },
        ];

        issueMember = await this.findOneBy({
            query,
            select: selectIssueMember,
            populate: populateIssueMember,
        });

        return issueMember;
    },
};

import IssueMemberModel from '../models/issueMember';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
