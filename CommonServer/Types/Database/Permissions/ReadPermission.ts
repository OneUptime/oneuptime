import DatabaseRequestType from '../../BaseDatabase/DatabaseRequestType';
import Query from '../Query';
import QueryHelper from '../QueryHelper';
import RelationSelect from '../RelationSelect';
import Select from '../Select';
import SelectUtil from '../SelectUtil';
import BasePermission, { CheckPermissionBaseInterface } from './BasePermission';
import TablePermission from './TablePermission';
import BaseModel from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import DatabaseCommonInteractionPropsUtil, {
    PermissionType,
} from 'Common/Types/BaseDatabase/DatabaseCommonInteractionPropsUtil';
import ObjectID from 'Common/Types/ObjectID';
import Permission, { UserPermission } from 'Common/Types/Permission';

export interface CheckReadPermissionType<TBaseModel extends BaseModel>
    extends CheckPermissionBaseInterface<TBaseModel> {
    select: Select<TBaseModel> | null;
    relationSelect: RelationSelect<TBaseModel> | null;
}

export default class ReadPermission {
    public static async checkReadPermission<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        select: Select<TBaseModel> | null,
        props: DatabaseCommonInteractionProps
    ): Promise<CheckReadPermissionType<TBaseModel>> {
        // check block permission first.
        await this.checkReadBlockPermission(modelType, query, props);

        const baseFunctionReturn: CheckPermissionBaseInterface<TBaseModel> =
            await BasePermission.checkPermissions(
                modelType,
                query,
                select,
                props,
                DatabaseRequestType.Read
            );

        // upate query
        query = baseFunctionReturn.query;

        let relationSelect: RelationSelect<TBaseModel> = {};

        if (select) {
            const result: {
                select: Select<TBaseModel>;
                relationSelect: RelationSelect<TBaseModel>;
            } = SelectUtil.sanitizeSelect(modelType, select);
            select = result.select;
            relationSelect = result.relationSelect;
        }

        return { query, select, relationSelect };
    }

    public static async checkReadBlockPermission<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        props: DatabaseCommonInteractionProps
    ): Promise<CheckPermissionBaseInterface<TBaseModel>> {
        // If system is making this query then let the query run!
        if (props.isRoot || props.isMasterAdmin) {
            return { query };
        }

        TablePermission.checkTableLevelBlockPermissions(
            modelType,
            props,
            DatabaseRequestType.Read
        );

        const blockPermissionWithLabels: Array<UserPermission> =
            DatabaseCommonInteractionPropsUtil.getUserPermissions(
                props,
                PermissionType.Block
            ).filter((permission: UserPermission) => {
                return permission.labelIds && permission.labelIds.length > 0;
            });

        if (blockPermissionWithLabels.length === 0) {
            return { query };
        }

        const modelPermissions: Array<Permission> =
            TablePermission.getTablePermission(
                modelType,
                DatabaseRequestType.Read
            );

        const blockPermissionsBelongToThisModel: Array<UserPermission> =
            blockPermissionWithLabels.filter(
                (blockPermission: UserPermission) => {
                    let isModelPermission: boolean = false;

                    for (const permission of modelPermissions) {
                        if (
                            permission.toString() ===
                            blockPermission.permission.toString()
                        ) {
                            isModelPermission = true;
                            break;
                        }
                    }

                    return isModelPermission;
                }
            );

        if (blockPermissionsBelongToThisModel.length === 0) {
            return { query };
        }

        let labelIds: Array<ObjectID> = [];

        for (const blockPermissionBelongToThisModel of blockPermissionsBelongToThisModel) {
            if (blockPermissionBelongToThisModel.labelIds) {
                labelIds = [
                    ...labelIds,
                    ...blockPermissionBelongToThisModel.labelIds,
                ];
            }
        }

        // now add these to query

        const model: TBaseModel = new modelType();

        (query as any)[model.getAccessControlColumn() as string] = {
            _id: QueryHelper.notIn(labelIds),
        };

        return { query };
    }
}
