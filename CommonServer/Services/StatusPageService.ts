import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import DatabaseService from './DatabaseService';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import ObjectID from 'Common/Types/ObjectID';
import PositiveNumber from 'Common/Types/PositiveNumber';
import StatusPage from 'Model/Models/StatusPage';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
import StatusPageDomainService from './StatusPageDomainService';
import URL from 'Common/Types/API/URL';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import { Domain, HttpProtocol } from '../Config';
import { ExpressRequest } from '../Utils/Express';
import JSONWebToken from '../Utils/JsonWebToken';
import JSONWebTokenData from 'Common/Types/JsonWebTokenData';
import logger from '../Utils/Logger';

export class Service extends DatabaseService<StatusPage> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(StatusPage, postgresDatabase);
    }

    public async hasReadAccess(
        statusPageId: ObjectID,
        props: DatabaseCommonInteractionProps,
        req: ExpressRequest
    ): Promise<boolean> {
        try {
            // token decode.
            const token: string | Array<string> | undefined =
                req.headers['status-page-token'];

            if (token) {

                try {

                    const decoded: JSONWebTokenData = JSONWebToken.decode(
                        token as string
                    );

                    if (
                        decoded.statusPageId?.toString() === statusPageId.toString()
                    ) {
                        return true;
                    }
                } catch (err) {
                    logger.error(err);
                }
            }

            const count: PositiveNumber = await this.countBy({
                query: {
                    _id: statusPageId.toString(),
                    isPublicStatusPage: true,
                },
                skip: 0,
                limit: 1,
                props: {
                    isRoot: true,
                },
            });

            if (count.positiveNumber > 0) {
                return true;
            }

            // if it does not have public access, check if this user has access.

            const items: Array<StatusPage> = await this.findBy({
                query: {
                    _id: statusPageId.toString(),
                },
                select: {
                    _id: true,
                },
                skip: 0,
                limit: 1,
                props: props,
            });

            if (items.length > 0) {
                return true;
            }
        } catch (err) {
            logger.error(err);
        }

        return false;
    }

    public async getStatusPageURL(statusPageId: ObjectID): Promise<string> {
        const domains: Array<StatusPageDomain> =
            await StatusPageDomainService.findBy({
                query: {
                    statusPageId: statusPageId,
                    isSslProvisioned: true,
                },
                select: {
                    fullDomain: true,
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                    isRoot: true,
                    ignoreHooks: true,
                },
            });

        let statusPageURL: string = domains
            .map((d: StatusPageDomain) => {
                return d.fullDomain;
            })
            .join(', ');

        if (domains.length === 0) {
            // 'https://local.oneuptime.com/status-page/40092fb5-cc33-4995-b532-b4e49c441c98'
            statusPageURL = new URL(HttpProtocol, Domain)
                .addRoute('/status-page/' + statusPageId.toString())
                .toString();
        }

        return statusPageURL;
    }
}
export default new Service();
