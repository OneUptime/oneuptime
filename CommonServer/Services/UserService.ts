import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/User';
import DatabaseService, { OnUpdate } from './DatabaseService';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import Email from 'Common/Types/Email';
import ObjectID from 'Common/Types/ObjectID';
import MailService from './MailService';
import UpdateBy from '../Types/Database/UpdateBy';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import { Domain, HttpProtocol } from '../Config';
import logger from '../Utils/Logger';
import URL from 'Common/Types/API/URL';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public async findByEmail(
        email: Email,
        props: DatabaseCommonInteractionProps
    ): Promise<Model | null> {
        return await this.findOneBy({
            query: {
                email: email,
            },
            select: {
                _id: true,
            },
            props: props,
        });
    }
     
    protected override async onBeforeUpdate(updateBy: UpdateBy<Model>): Promise<OnUpdate<Model>> {
        if (updateBy.data.password) {
            const users = await this.findBy({
                query: updateBy.query,
                select: {
                    email: true,
                },
                props: {
                    isRoot: true,
                },
                limit: LIMIT_MAX,
                skip: 0
            })

            return { updateBy, carryForward: users };
        }
        return { updateBy, carryForward: [] };
    }

    protected override async onUpdateSuccess(onUpdate: OnUpdate<Model>, _updatedItemIds: ObjectID[]): Promise<OnUpdate<Model>> {
        if (onUpdate && onUpdate.updateBy.data.password) {
            for (const user of onUpdate.carryForward) {
                // password changed, send password changed mail
                MailService.sendMail({
                    toEmail: user.email!,
                    subject: 'Password Changed.',
                    templateType: EmailTemplateType.PasswordChanged,
                    vars: {
                        homeURL: new URL(HttpProtocol, Domain).toString(),
                    },
                }).catch((err: Error) => {
                    logger.error(err);
                });
            }
        }

        return onUpdate;
    }

    public async createByEmail(
        email: Email,
        props: DatabaseCommonInteractionProps
    ): Promise<Model> {
        const user: Model = new Model();
        user.email = email;

        return await this.create({
            data: user,
            props: props,
        });
    }
}

export default new Service();
