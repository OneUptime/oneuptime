module.exports = {
    create: async function(data) {
        try {
            const _this = this;

            // prepare issue member model
            let issueMember = new IssueMemberModel();

            issueMember.userId = data.userId;
            issueMember.issueId = data.issueId;

            issueMember.createdById = data.createdById;

            const savedIssueMember = await issueMember.save();
            issueMember = await _this.findOneBy({
                _id: savedIssueMember._id,
            });
            return savedIssueMember;
        } catch (error) {
            ErrorService.log('issueMemberService.create', error);
            throw error;
        }
    },
    // find a list of Members assigned to an Issue
    async findBy(query) {
        try {
            if (!query) {
                query = {};
            }

            const issues = await IssueMemberModel.find(query)
                .populate('issueId', 'name')
                .populate('userId', ['name', 'email']);
            return issues;
        } catch (error) {
            ErrorService.log('issueMemberService.findBy', error);
            throw error;
        }
    },
    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            const issueMember = await IssueMemberModel.findOne(query)
                .populate('issueId', 'name')
                .populate('userId', ['name', 'email']);
            return issueMember;
        } catch (error) {
            ErrorService.log('issueMemberService.findOneBy', error);
            throw error;
        }
    },
    updateOneBy: async function(query, data, unsetData = null) {
        try {
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
                issueMember = await IssueMemberModel.findOneAndUpdate(
                    query,
                    { $unset: unsetData },
                    {
                        new: true,
                    }
                );
            }

            issueMember = await this.findOneBy(query);

            return issueMember;
        } catch (error) {
            ErrorService.log('issueMemberService.updateOneBy', error);
            throw error;
        }
    },
};

const IssueMemberModel = require('../models/issueMember');
const ErrorService = require('./errorService');
