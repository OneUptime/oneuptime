import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/StatusPageDomain';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import DomainService from './DomainService';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<OnCreate<Model>> {
        
        const domain = await DomainService.findOneBy({
            query: {
                _id: createBy.data.domainId?.toString() || createBy.data.domain?._id || ''
            },
            populate: {},
            select: { domain: true }, 
            props: {
                isRoot: true
            }
        })
        

        if (domain) {
            createBy.data.fullDomain = createBy.data.subdomain + '.' + domain.domain; 
        }

        return { createBy, carryForward: null };
    }
}
export default new Service();
