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
import { AccountsRoute, Domain, HttpProtocol } from '../Config';
import logger from '../Utils/Logger';
import URL from 'Common/Types/API/URL';
import EmailVerificationToken from 'Model/Models/EmailVerificationToken';
import OneUptimeDate from 'Common/Types/Date';
import EmailVerificationTokenService from './EmailVerificationTokenService';
import Route from 'Common/Types/API/Route';

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



        if (updateBy.data.password || updateBy.data.email) {
            const users = await this.findBy({
                query: updateBy.query,
                select: {
                    _id: true,
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

        if (onUpdate && onUpdate.updateBy.data.email) {

            const newUsers = await this.findBy({
                query: onUpdate.updateBy.query,
                select: {
                    _id: true,
                    email: true,
                    name: true
                },
                props: {
                    isRoot: true,
                },
                limit: LIMIT_MAX,
                skip: 0
            })

            for (const user of onUpdate.carryForward) {

                const newUser = newUsers.find((u) => u._id?.toString() === user._id.toString());

                if (newUser && newUser.email?.toString() !== user.email.toString()) {
                    // password changed, send password changed mail
                    const generatedToken: ObjectID = ObjectID.generate();

                    const emailVerificationToken: EmailVerificationToken =
                        new EmailVerificationToken();
                    emailVerificationToken.userId = user?.id!;
                    emailVerificationToken.email = newUser?.email!;
                    emailVerificationToken.token = generatedToken;
                    emailVerificationToken.expires = OneUptimeDate.getOneDayAfter();

                    await EmailVerificationTokenService.create({
                        data: emailVerificationToken,
                        props: {
                            isRoot: true,
                        },
                    });

                    MailService.sendMail({
                        toEmail: newUser.email!,
                        subject: 'You have changed your email. Please verify your email.',
                        templateType: EmailTemplateType.EmailChanged,
                        vars: {
                            name: newUser.name!.toString(),
                            tokenVerifyUrl: new URL(
                                HttpProtocol,
                                Domain,
                                new Route(AccountsRoute.toString()).addRoute(
                                    '/verify-email/' + generatedToken.toString()
                                )
                            ).toString(),
                            homeUrl: new URL(HttpProtocol, Domain).toString(),
                        },
                    }).catch((err: Error) => {
                        logger.error(err);
                    });

                    await this.updateBy({
                        query: {
                            _id: user.id.toString()
                        },
                        data: {
                            isEmailVerified: false
                        },
                        props: {
                            isRoot: true,
                            ignoreHooks: true
                        }
                    });
                }



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
