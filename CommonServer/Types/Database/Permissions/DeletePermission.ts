import DatabaseRequestType from '../../BaseDatabase/DatabaseRequestType';
import Query from '../Query';
import AccessControlUtil from './AccessControlPermission';
import PermissionUtil from './PermissionsUtil';
import TablePermission from './TablePermission';
import TenantPermission from './TenantPermission';
import AccessControlModel from 'Common/Models/AccessControlModel';
import BaseModel from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import BadDataException from 'Common/Types/Exception/BadDataException';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import ObjectID from 'Common/Types/ObjectID';

export default class DeletePermission {
    public static async checkDeletePermissionByModel<
        TBaseModel extends BaseModel
    >(data: {
        fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
        modelType: { new (): TBaseModel };
        props: DatabaseCommonInteractionProps;
    }): Promise<void> {
        const { modelType, props } = data;

        if (props.isRoot || props.isMasterAdmin) {
            return; // Root and master admin can delete anything.
        }

        // Check if the user has permission to delete the object in this table.
        TablePermission.checkTableLevelPermissions(
            modelType,
            props,
            DatabaseRequestType.Delete
        );

        // if the control is here, then the user has table level permissions.
        const model: TBaseModel = new modelType();
        const modelAccessControlColumnName = model.getAccessControlColumn();

        if (modelAccessControlColumnName) {
            const accessControlIdsWhcihUserHasAccessTo: Array<ObjectID> =
                AccessControlUtil.getAccessControlIdsForModel(
                    modelType,
                    props,
                    DatabaseRequestType.Delete
                );

            if (accessControlIdsWhcihUserHasAccessTo.length === 0) {
                return; // The user has access to all resources, if no labels are specified.
            }

            const fetchedModel: TBaseModel | null =
                await data.fetchModelWithAccessControlIds();

            if (!fetchedModel) {
                throw new BadDataException(`${model.singularName} not found.`);
            }

            const hasAccessToDelete: boolean = false;

            const accessControlIdsWhichUserHasAccessToAsStrings: Array<string> =
                accessControlIdsWhcihUserHasAccessTo.map((id) => {
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

                const accessControlName = accessControl.getColumnValue(
                    'name'
                ) as string;

                if (accessControlName) {
                    modelAccessControlNames.push(accessControlName);
                }
            }

            if (!hasAccessToDelete) {
                // The user does not have access to delete this object.
                throw new NotAuthorizedException(
                    `You do not have permission to delete this ${
                        model.singularName
                    }. You need to have one of the following labels: ${modelAccessControlNames.join(
                        ', '
                    )}.`
                );
            }
        }
    }

    public static async checkDeletePermission<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        props: DatabaseCommonInteractionProps
    ): Promise<Query<TBaseModel>> {
        if (props.isRoot || props.isMasterAdmin) {
            query = await PermissionUtil.addTenantScopeToQueryAsRoot(
                modelType,
                query,
                props
            );
        }

        if (!props.isRoot && !props.isMasterAdmin) {
            // Does the user have permission to delete the object in this table? If no, then throw an error.
            TablePermission.checkTableLevelPermissions(
                modelType,
                props,
                DatabaseRequestType.Delete
            );

            // Add tenant scope to query.
            query = await TenantPermission.addTenantScopeToQuery(
                modelType,
                query,
                null,
                props,
                DatabaseRequestType.Delete
            );

            // add access control ids to query
            query = await AccessControlUtil.addAccessControlIdsToQuery(
                modelType,
                query,
                null,
                props,
                DatabaseRequestType.Delete
            );
        }

        return query;
    }
}
