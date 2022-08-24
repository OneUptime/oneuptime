import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/IncidentStateTimeline';
import DatabaseService, { OnCreate } from './DatabaseService';
import BadDataException from 'Common/Types/Exception/BadDataException';
import IncidentService from './IncaidentService';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onCreateSuccess(onCreate: OnCreate<Model>, createdItem: Model): Promise<Model> {


        if (!createdItem.incidentId) {
            throw new BadDataException("incidentId is null");
        }

        if (!createdItem.incidentStateId) {
            throw new BadDataException("incidentStateId is null");
        }

        await IncidentService.updateBy({
            query: {
                _id: createdItem.incidentId?.toString()
            },
            data: {
                currentIncidentStateId: createdItem.incidentStateId,
            },
            props: onCreate.createBy.props,
        });


        return createdItem;
    }
}

export default new Service();
