import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/StatusPageHeaderLink';
import DatabaseService, { OnCreate, OnDelete, OnUpdate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Query from '../Types/Database/Query';
import QueryHelper from '../Types/Database/QueryHelper';
import PositiveNumber from 'Common/Types/PositiveNumber';
import DeleteBy from '../Types/Database/DeleteBy';
import ObjectID from 'Common/Types/ObjectID';
import UpdateBy from '../Types/Database/UpdateBy';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import SortOrder from 'Common/Types/Database/SortOrder';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }


    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.data.statusPageId) {
            throw new BadDataException(
                'statusPageId is required'
            );
        }

        if (!createBy.data.order) {
            const query: Query<Model> = {
                statusPageId: createBy.data.statusPageId,
            };


            const count: PositiveNumber = await this.countBy({
                query: query,
                props: {
                    isRoot: true,
                },
            });

            createBy.data.order = count.toNumber() + 1;
        }

        await this.rearrangeOrder(
            createBy.data.order,
            createBy.data.statusPageId,
            true
        );

        return {
            createBy: createBy,
            carryForward: null,
        };
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<Model>
    ): Promise<OnDelete<Model>> {
        if (!deleteBy.query._id && !deleteBy.props.isRoot) {
            throw new BadDataException(
                '_id should be present when deleting status page header link. Please try the delete with objectId'
            );
        }

        let resource: Model | null = null;

        if (!deleteBy.props.isRoot) {
            resource = await this.findOneBy({
                query: deleteBy.query,
                props: {
                    isRoot: true,
                },
                select: {
                    order: true,
                    statusPageId: true,
                },
            });
        }

        return {
            deleteBy,
            carryForward: resource,
        };
    }

    protected override async onDeleteSuccess(
        onDelete: OnDelete<Model>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<Model>> {
        const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
        const resource: Model | null = onDelete.carryForward;

        if (!deleteBy.props.isRoot && resource) {
            if (resource && resource.order && resource.statusPageId) {
                await this.rearrangeOrder(
                    resource.order,
                    resource.statusPageId,
                    false
                );
            }
        }

        return {
            deleteBy: deleteBy,
            carryForward: null,
        };
    }

    protected override async onBeforeUpdate(
        updateBy: UpdateBy<Model>
    ): Promise<OnUpdate<Model>> {
        if (
            updateBy.data.order &&
            !updateBy.props.isRoot &&
            updateBy.query._id
        ) {
            const resource: Model | null = await this.findOneBy({
                query: {
                    _id: updateBy.query._id!,
                },
                props: {
                    isRoot: true,
                },
                select: {
                    order: true,
                    statusPageId: true,
                    _id: true,
                },
            });

            const currentOrder: number = resource?.order!;
            const newOrder: number = updateBy.data.order as number;

            const resources: Array<Model> = await this.findBy({
                query: {
                    statusPageId: resource?.statusPageId!,
                },
                populate: {},
                limit: LIMIT_MAX,
                skip: 0,
                props: {
                    isRoot: true,
                },
                select: {
                    order: true,
                    statusPageId: true,
                    _id: true,
                },
            });

            if (currentOrder > newOrder) {
                // moving up.

                for (const resource of resources) {
                    if (
                        resource.order! >= newOrder &&
                        resource.order! < currentOrder
                    ) {
                        // increment order.
                        await this.updateBy({
                            query: {
                                _id: resource._id!,
                            },
                            data: {
                                order: resource.order! + 1,
                            },
                            props: {
                                isRoot: true,
                            },
                        });
                    }
                }
            }

            if (newOrder > currentOrder) {
                // moving down.

                for (const resource of resources) {
                    if (
                        resource.order! < newOrder &&
                        resource.order! >= currentOrder
                    ) {
                        // increment order.
                        await this.updateBy({
                            query: {
                                _id: resource._id!,
                            },
                            data: {
                                order: resource.order! - 1,
                            },
                            props: {
                                isRoot: true,
                            },
                        });
                    }
                }
            }
        }

        return { updateBy, carryForward: null };
    }

    private async rearrangeOrder(
        currentOrder: number,
        statusPageId: ObjectID,
        increaseOrder: boolean = true
    ): Promise<void> {
        // get status page resource with this order.
        const resources: Array<Model> = await this.findBy({
            query: {
                order: QueryHelper.greaterThanEqualTo(currentOrder),
                statusPageId: statusPageId,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: {
                isRoot: true,
            },
            select: {
                _id: true,
                order: true,
            },
            sort: {
                order: SortOrder.Ascending,
            },
        });

        let newOrder: number = currentOrder;

        for (const resource of resources) {
            if (increaseOrder) {
                newOrder = resource.order! + 1;
            } else {
                newOrder = resource.order! - 1;
            }

            await this.updateBy({
                query: {
                    _id: resource._id!,
                },
                data: {
                    order: newOrder,
                },
                props: {
                    isRoot: true,
                },
            });
        }
    }
}
export default new Service();
