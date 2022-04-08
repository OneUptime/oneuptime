import GroupModel from '../models/groups';
import Query from '../types/db/Query';
import FindBy from '../types/db/FindBy';
export default class Service {
    async findBy({ query, limit, skip, sort }: FindBy) {
        if (!skip) skip = 0;

        if (!limit) limit = 10;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};

        if (!query['deleted']) query['deleted'] = false;
        const response = {};
        const [groups, count] = await Promise.all([
            GroupModel.find(query)
                .lean()
                .sort(sort)
                .limit(limit)
                .skip(skip)
                .populate('projectId', 'name')
                .populate({
                    path: 'teams',
                    select: 'name email',
                }),
            GroupModel.countDocuments(query),
        ]);

        response.groups = groups;

        response.count = count;

        response.skip = skip;

        response.limit = limit;
        return response;
    }

    async findOneBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const group = await GroupModel.findOne(query)
            .populate('projectId', 'name')
            .populate({
                path: 'teams',
                select: 'name email',
            })
            .lean();

        return group;
    }

    async create(data: $TSFixMe) {
        const groupExist = await this.findOneBy({
            name: data.name,
            projectId: data.projectId,
        });

        if (groupExist) {
            const error = new Error('Group already exist in this project');

            error.code = 400;
            throw error;
        }
        const createGroup = new GroupModel({
            name: data.name,
            projectId: data.projectId,
            createdById: data.createdById,
            teams: data.teams,
        });

        const group = await createGroup.save();
        return group;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        query.deleted = false;
        const count = await GroupModel.countDocuments(query);
        return count;
    }

    async deleteBy(query: Query, userId: string) {
        const group = await GroupModel.findOneAndUpdate(
            query,
            {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now(),
                },
            },
            {
                new: true,
            }
        );
        return group;
    }

    async updateOneBy(query: Query, data: $TSFixMe, projectId: string) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;

        const groupExist = await this.findOneBy({
            name: data.name,
            projectId,
        });

        if (groupExist && String(groupExist._id) !== String(query._id)) {
            const error = new Error('Group already exist in this project');

            error.code = 400;
            throw error;
        }
        let group = await GroupModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        );
        group = await this.findOneBy(query);
        return group;
    }

    async removeGroupMember(groupId: $TSFixMe, memberId: $TSFixMe) {
        const group = await this.findOneBy({ _id: groupId });
        const teamMembers = group.teams;
        const data = teamMembers.filter((id: $TSFixMe) => id !== memberId);

        const newGroup = await this.updateOneBy(
            { _id: groupId },
            { teams: data }
        );
        return newGroup;
    }
}
