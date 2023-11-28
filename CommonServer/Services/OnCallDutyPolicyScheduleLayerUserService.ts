import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/OnCallDutyPolicyScheduleLayerUser';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import { OnCreate, OnDelete } from '../Types/Database/Hooks';
import ObjectID from 'Common/Types/ObjectID';
import QueryHelper from '../Types/Database/QueryHelper';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import BadDataException from 'Common/Types/Exception/BadDataException';
import DeleteBy from '../Types/Database/DeleteBy';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeCreate(createBy: CreateBy<Model>): Promise<OnCreate<Model>> {


        if(!createBy.data.onCallDutyPolicyScheduleLayerId){
            throw new BadDataException('onCallDutyPolicyScheduleLayerId is required');
        }

        const userId: ObjectID | undefined | null = createBy.data.userId || createBy.data.user?.id;

        if(!userId){
            throw new BadDataException('userId is required');
        }

        /// check if this user is already in this layer.

        const count = await this.countBy({
            query: {
                onCallDutyPolicyScheduleLayerId: createBy.data.onCallDutyPolicyScheduleLayerId!,
                userId: userId
            },
            props: {
                isRoot: true
            }
        });

        if(count.toNumber() > 0){
            throw new BadDataException('This user is already in this layer');
        }

        if(!createBy.data.order){
            // count number of users in this layer. 

            const count = await this.countBy({
                query: {
                    onCallDutyPolicyScheduleLayerId: createBy.data.onCallDutyPolicyScheduleLayerId!
                },
                props: {
                    isRoot: true
                }
            })


            createBy.data.order = count.toNumber() + 1;
        }


        await this.rearrangeOrder(
            createBy.data.order,
            createBy.data.onCallDutyPolicyScheduleLayerId!,
            true
        );

        


        return {
            createBy, carryForward: null
        }
    }


    protected override async onDeleteSuccess(
        onDelete: OnDelete<Model>,
        _itemIdsBeforeDelete: ObjectID[]
    ): Promise<OnDelete<Model>> {
        const deleteBy: DeleteBy<Model> = onDelete.deleteBy;
        const resource: Model | null = onDelete.carryForward;

        if (!deleteBy.props.isRoot && resource) {
            if (resource && resource.order && resource.onCallDutyPolicyScheduleLayerId) {
                await this.rearrangeOrder(
                    resource.order,
                    resource.onCallDutyPolicyScheduleLayerId,
                    false
                );
            }
        }

        return {
            deleteBy: deleteBy,
            carryForward: null,
        };
    }


    private async rearrangeOrder(
        currentOrder: number,
        onCallDutyPolicyScheduleLayerId: ObjectID,
        increaseOrder: boolean = true
    ): Promise<void> {
        // get status page resource with this order.
        const resources: Array<Model> = await this.findBy({
            query: {
                order: QueryHelper.greaterThanEqualTo(currentOrder),
                onCallDutyPolicyScheduleLayerId: onCallDutyPolicyScheduleLayerId,
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

            await this.updateOneBy({
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
