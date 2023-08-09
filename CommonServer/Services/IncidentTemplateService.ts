import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/IncidentTemplate';
import DatabaseService, { OnCreate } from './DatabaseService';
import ObjectID from 'Common/Types/ObjectID';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import Typeof from 'Common/Types/Typeof';
import IncidentTemplateOwnerTeam from 'Model/Models/IncidentTemplateOwnerTeam';
import IncidentTemplateOwnerTeamService from './IncidentTemplateOwnerTeamService';
import IncidentTemplateOwnerUserService from './IncidentTemplateOwnerUserService';
import IncidentTemplateOwnerUser from 'Model/Models/IncidentTemplateOwnerUser';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onCreateSuccess(
        onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        // add owners.

        if (
            createdItem.projectId &&
            createdItem.id &&
            onCreate.createBy.miscDataProps &&
            (onCreate.createBy.miscDataProps['ownerTeams'] ||
                onCreate.createBy.miscDataProps['ownerUsers'])
        ) {
            await this.addOwners(
                createdItem.projectId,
                createdItem.id,
                (onCreate.createBy.miscDataProps[
                    'ownerUsers'
                ] as Array<ObjectID>) || [],
                (onCreate.createBy.miscDataProps[
                    'ownerTeams'
                ] as Array<ObjectID>) || [],
                false,
                onCreate.createBy.props
            );
        }

        return createdItem;
    }

    public async addOwners(
        projectId: ObjectID,
        incidentTemplateId: ObjectID,
        userIds: Array<ObjectID>,
        teamIds: Array<ObjectID>,
        notifyOwners: boolean,
        props: DatabaseCommonInteractionProps
    ): Promise<void> {
        for (let teamId of teamIds) {
            if (typeof teamId === Typeof.String) {
                teamId = new ObjectID(teamId.toString());
            }

            const teamOwner: IncidentTemplateOwnerTeam =
                new IncidentTemplateOwnerTeam();
            teamOwner.incidentTemplateId = incidentTemplateId;
            teamOwner.projectId = projectId;
            teamOwner.teamId = teamId;
            teamOwner.isOwnerNotified = !notifyOwners;

            await IncidentTemplateOwnerTeamService.create({
                data: teamOwner,
                props: props,
            });
        }

        for (let userId of userIds) {
            if (typeof userId === Typeof.String) {
                userId = new ObjectID(userId.toString());
            }
            const teamOwner: IncidentTemplateOwnerUser =
                new IncidentTemplateOwnerUser();
            teamOwner.incidentTemplateId = incidentTemplateId;
            teamOwner.projectId = projectId;
            teamOwner.userId = userId;
            teamOwner.isOwnerNotified = !notifyOwners;
            await IncidentTemplateOwnerUserService.create({
                data: teamOwner,
                props: props,
            });
        }
    }
}
export default new Service();
