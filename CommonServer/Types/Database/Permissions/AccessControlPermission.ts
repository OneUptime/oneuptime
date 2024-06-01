import DatabaseRequestType from '../../BaseDatabase/DatabaseRequestType';
import Query from '../Query';
import Select from '../Select';
import TablePermission from './TablePermission';
import BaseModel, { BaseModelType } from 'Common/Models/BaseModel';
import ArrayUtil from 'Common/Types/ArrayUtil';
import { ColumnAccessControl } from 'Common/Types/BaseDatabase/AccessControl';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import DatabaseCommonInteractionPropsUtil from 'Common/Types/BaseDatabase/DatabaseCommonInteractionPropsUtil';
import ObjectID from 'Common/Types/ObjectID';
import Permission, {
    PermissionHelper,
    UserPermission,
} from 'Common/Types/Permission';

export default class AccessControlPermission {
    public static async addAccessControlIdsToQuery<
        TBaseModel extends BaseModel
    >(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        select: Select<TBaseModel> | null,
        props: DatabaseCommonInteractionProps,
        type: DatabaseRequestType
    ): Promise<Query<TBaseModel>> {
        const model: BaseModel = new modelType();

        // if the model has access control column, then add the access control labels to the query.
        if (model.getAccessControlColumn()) {
            const accessControlIds: Array<ObjectID> =
                this.getAccessControlIdsForQuery(
                    modelType,
                    query,
                    select,
                    props,
                    type
                );

            if (accessControlIds.length > 0) {
                (query as any)[model.getAccessControlColumn() as string] =
                    accessControlIds;
            }
        }

        return query;
    }

    public static getAccessControlIdsForModel(
        modelType: BaseModelType,
        props: DatabaseCommonInteractionProps,
        type: DatabaseRequestType
    ): Array<ObjectID> {
        let labelIds: Array<ObjectID> = [];

        // check model level permissions.

        const modelLevelPermissions: Array<Permission> =
            TablePermission.getTablePermission(modelType, type);

        const modelLevelLabelIds: Array<ObjectID> =
            this.getAccessControlIdsByPermissions(modelLevelPermissions, props);

        labelIds = [...labelIds, ...modelLevelLabelIds];

        // get distinct labelIds
        const distinctLabelIds: Array<ObjectID> =
            ArrayUtil.removeDuplicatesFromObjectIDArray(labelIds);

        return distinctLabelIds;
    }

    public static getAccessControlIdsForQuery<TBaseModel extends BaseModel>(
        modelType: BaseModelType,
        query: Query<TBaseModel>,
        select: Select<TBaseModel> | null,
        props: DatabaseCommonInteractionProps,
        type: DatabaseRequestType
    ): Array<ObjectID> {
        const model: BaseModel = new modelType();

        let labelIds: Array<ObjectID> = [];

        let columnsToCheckPermissionFor: Array<string> = Object.keys(query);

        if (select) {
            columnsToCheckPermissionFor = [
                ...columnsToCheckPermissionFor,
                ...Object.keys(select),
            ];
        }

        labelIds = this.getAccessControlIdsForModel(modelType, props, type);

        for (const column of columnsToCheckPermissionFor) {
            const accessControl: ColumnAccessControl | null =
                model.getColumnAccessControlFor(column);

            if (!accessControl) {
                continue;
            }

            if (type === DatabaseRequestType.Read && accessControl.read) {
                const columnReadLabelIds: Array<ObjectID> =
                    this.getAccessControlIdsByPermissions(
                        accessControl.read,
                        props
                    );

                labelIds = [...labelIds, ...columnReadLabelIds];
            }

            if (type === DatabaseRequestType.Create && accessControl.create) {
                const columnCreateLabelIds: Array<ObjectID> =
                    this.getAccessControlIdsByPermissions(
                        accessControl.create,
                        props
                    );

                labelIds = [...labelIds, ...columnCreateLabelIds];
            }

            if (type === DatabaseRequestType.Update && accessControl.update) {
                const columnUpdateLabelIds: Array<ObjectID> =
                    this.getAccessControlIdsByPermissions(
                        accessControl.update,
                        props
                    );

                labelIds = [...labelIds, ...columnUpdateLabelIds];
            }
        }

        // get distinct labelIds
        const distinctLabelIds: Array<ObjectID> =
            ArrayUtil.removeDuplicatesFromObjectIDArray(labelIds);
        return distinctLabelIds;
    }

    private static getAccessControlIdsByPermissions(
        permissions: Array<Permission>,
        props: DatabaseCommonInteractionProps
    ): Array<ObjectID> {
        const userPermissions: Array<UserPermission> =
            DatabaseCommonInteractionPropsUtil.getUserPermissions(props);

        const nonAccessControlPermissionPermission: Array<Permission> =
            PermissionHelper.getNonAccessControlPermissions(userPermissions);

        const accessControlPermissions: Array<UserPermission> =
            PermissionHelper.getAccessControlPermissions(userPermissions);

        let labelIds: Array<ObjectID> = [];

        if (
            PermissionHelper.doesPermissionsIntersect(
                permissions,
                nonAccessControlPermissionPermission
            )
        ) {
            return []; // if this is intersecting, then return empty array. We dont need to check for access control.
        }

        for (const permission of permissions) {
            for (const accessControlPermission of accessControlPermissions) {
                if (
                    accessControlPermission.permission === permission &&
                    accessControlPermission.labelIds.length > 0
                ) {
                    labelIds = [
                        ...labelIds,
                        ...accessControlPermission.labelIds,
                    ];
                }
            }
        }

        // remove duplicates
        labelIds = ArrayUtil.removeDuplicatesFromObjectIDArray(labelIds);

        return labelIds;
    }
}
