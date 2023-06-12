import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/StatusPageDomain';
import DatabaseService, { OnCreate, OnDelete } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import DomainService from './DomainService';
import Domain from 'Model/Models/Domain';
import BadDataException from 'Common/Types/Exception/BadDataException';
import StatusPageCertificateService from './StatusPageCertificateService';
import DeleteBy from '../Types/Database/DeleteBy';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import ObjectID from 'Common/Types/ObjectID';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        const domain: Domain | null = await DomainService.findOneBy({
            query: {
                _id:
                    createBy.data.domainId?.toString() ||
                    createBy.data.domain?._id ||
                    '',
            },
            select: { domain: true, isVerified: true },
            props: {
                isRoot: true,
            },
        });

        if (!domain?.isVerified) {
            throw new BadDataException(
                'This domain is not verified. Please verify it by going to Settings > Domains'
            );
        }

        if (domain) {
            createBy.data.fullDomain =
                createBy.data.subdomain + '.' + domain.domain;
        }

        createBy.data.cnameVerificationToken = ObjectID.generate().toString();

        return { createBy, carryForward: null };
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<Model>
    ): Promise<OnDelete<Model>> {
        const domains: Array<Model> = await this.findBy({
            query: {
                ...deleteBy.query,
                isAddedtoGreenlock: true,
            },

            skip: 0,
            limit: LIMIT_MAX,
            select: { fullDomain: true },
            props: {
                isRoot: true,
            },
        });

        return { deleteBy, carryForward: domains };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<Model>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<Model>> {
        for (const domain of onDelete.carryForward) {
            await StatusPageCertificateService.remove(
                domain.fullDomain as string
            );
        }

        return onDelete;
    }
}
export default new Service();
