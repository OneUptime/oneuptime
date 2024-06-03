import DatabaseRequestType from '../../BaseDatabase/DatabaseRequestType';
import Query from '../Query';
import Select from '../Select';
import TablePermission from './TablePermission';
import AccessControlModel from 'Common/Models/AccessControlModel';
import BaseModel, { BaseModelType } from 'Common/Models/BaseModel';
import ArrayUtil from 'Common/Types/ArrayUtil';
import { ColumnAccessControl } from 'Common/Types/BaseDatabase/AccessControl';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import DatabaseCommonInteractionPropsUtil, {
    PermissionType,
} from 'Common/Types/BaseDatabase/DatabaseCommonInteractionPropsUtil';
import BadDataException from 'Common/Types/Exception/BadDataException';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import ObjectID from 'Common/Types/ObjectID';
import Permission, {
    PermissionHelper,
    UserPermission,
} from 'Common/Types/Permission';

export default class AccessControlPermission {
    public static async checkAccessControlPermissionByModel<
        TBaseModel extends BaseModel
    >(data: {
        fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
        modelType: { new (): TBaseModel };
        props: DatabaseCommonInteractionProps;
        type: DatabaseRequestType;
    }): Promise<void> {
        const { modelType, props, type } = data;

        if (props.isRoot || props.isMasterAdmin) {
            return;
        }

        // Check if the user has permission to delete or update the object in this table.
        TablePermission.checkTableLevelPermissions(modelType, props, type);

        // if the control is here, then the user has table level permissions.
        const model: TBaseModel = new modelType();
        const modelAccessControlColumnName: string | null =
            model.getAccessControlColumn();

        if (modelAccessControlColumnName) {
            const accessControlIdsWhcihUserHasAccessTo: Array<ObjectID> =
                this.getAccessControlIdsForModel(modelType, props, type);

            if (accessControlIdsWhcihUserHasAccessTo.length === 0) {
                return; // The user has access to all resources, if no labels are specified.
            }

            const fetchedModel: TBaseModel | null =
                await data.fetchModelWithAccessControlIds();

            if (!fetchedModel) {
                throw new BadDataException(`${model.singularName} not found.`);
            }

            const accessControlIdsWhichUserHasAccessToAsStrings: Array<string> =
                accessControlIdsWhcihUserHasAccessTo.map((id: ObjectID) => {
                    return id.toString();
                }) || [];

            // Check if the object has any of these access control ids.  if not, then throw an error.
            const modelAccessControl: Array<AccessControlModel> =
                (fetchedModel.getColumnValue(
                    modelAccessControlColumnName
                ) as Array<AccessControlModel>) || [];

            const modelAccessControlNames: Array<string> = [];

            for (const accessControl of modelAccessControl) {
                if (!accessControl.id) {
                    continue;
                }

                if (
                    accessControlIdsWhichUserHasAccessToAsStrings.includes(
                        accessControl.id.toString()
                    )
                ) {
                    return;
                }

                const accessControlName: string = accessControl.getColumnValue(
                    'name'
                ) as string;

                if (accessControlName) {
                    modelAccessControlNames.push(accessControlName);
                }
            }

            let errorString: string = `You do not have permission to ${type.toLowerCase()} this ${
                model.singularName
            }.`;

            if (modelAccessControlNames.length > 0) {
                errorString += ` You need to have one of the following labels: ${modelAccessControlNames.join(
                    ', '
                )}.`;
            } else {
                errorString = ` You do not have permission to ${type.toLowerCase()} ${
                    model.singularName
                } without any labels.`;
            }

            throw new NotAuthorizedException(errorString);
        }
    }

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
            DatabaseCommonInteractionPropsUtil.getUserPermissions(
                props,
                PermissionType.Allow
            );

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
