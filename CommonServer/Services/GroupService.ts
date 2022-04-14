import GroupModel from '../Models/groups';
import ObjectID from 'Common/Types/ObjectID';
import Query from '../Types/DB/Query';
import FindBy from '../Types/DB/FindBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
export default class Service {
    async findBy({ query, limit, skip, sort }: FindBy): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 10;
        }

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const response: $TSFixMe = {};
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

    async findOneBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }
        const group = await GroupModel.findOne(query)
            .populate('projectId', 'name')
            .populate({
                path: 'teams',
                select: 'name email',
            })
            .lean();

        return group;
    }

    async create(data: $TSFixMe): void {
        const groupExist = await this.findOneBy({
            name: data.name,
            projectId: data.projectId,
        });

        if (groupExist) {
            throw new BadDataException('Group already exist in this project');
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

    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        query['deleted'] = false;
        const count = await GroupModel.countDocuments(query);
        return count;
    }

    async deleteBy(query: Query, userId: ObjectID): void {
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

    async updateOneBy(query: Query, data: $TSFixMe, projectId: ObjectID): void {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const groupExist = await this.findOneBy({
            name: data.name,
            projectId,
        });

        if (groupExist && String(groupExist._id) !== String(query._id)) {
            throw new BadDataException('Group already exist in this project');
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

    async removeGroupMember(groupId: $TSFixMe, memberId: $TSFixMe): void {
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
