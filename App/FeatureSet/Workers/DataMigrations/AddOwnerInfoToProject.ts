import User from 'Model/Models/User';
import DataMigrationBase from './DataMigrationBase';
import UserService from 'CommonServer/Services/UserService';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import Project from 'Model/Models/Project';
import ProjectService from 'CommonServer/Services/ProjectService';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';

export default class AddOwnerInfoToProjects extends DataMigrationBase {
    public constructor() {
        super('AddOwnerInfoToProjects');
    }

    public override async migrate(): Promise<void> {
        // get all the users with email isVerified true.

        const projects: Array<Project> = await ProjectService.findBy({
            query: {
                createdOwnerEmail: QueryHelper.isNull(),
            },
            select: {
                _id: true,
            },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
                isRoot: true,
            },
        });

        for (const project of projects) {
            const owners: Array<User> = await ProjectService.getOwners(
                project.id!
            );

            if (owners.length > 0) {
                const ownerUser: User | null = owners[0]!;

                const user: User | null = await UserService.findOneById({
                    id: ownerUser.id!,
                    select: {
                        email: true,
                        name: true,
                        companyName: true,
                        companyPhoneNumber: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

                if (!user) {
                    continue;
                }

                await ProjectService.updateOneById({
                    id: project.id!,
                    data: {
                        createdOwnerEmail: user.email!,
                        createdOwnerPhone: user.companyPhoneNumber!,
                        createdOwnerName: user.name!,
                        createdOwnerCompanyName: user.companyName!,
                    },
                    props: {
                        isRoot: true,
                    },
                });
            }
        }
    }

    public override async rollback(): Promise<void> {
        return;
    }
}
