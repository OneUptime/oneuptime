import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/User';
import DatabaseService from './DatabaseService';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import Email from 'Common/Types/Email';
import User from 'Model/Models/User';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public async findByEmail(email: Email, props: DatabaseCommonInteractionProps): Promise<Model | null> {
        
        return await this.findOneBy({
            query: {
                email: email
            },
            props: props
        }); 
    }

    public async createByEmail(email: Email, props: DatabaseCommonInteractionProps): Promise<Model> {
        const user: Model = new User();
        user.email = email; 

        return await this.create({
            data:user,
            props: props
        }); 
    }
}

export default new Service();
