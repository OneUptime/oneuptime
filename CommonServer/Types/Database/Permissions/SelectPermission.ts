import DatabaseRequestType from '../../BaseDatabase/DatabaseRequestType';
import Select from '../Select';
import ColumnPermissions from './ColumnPermission';
import BaseModel, { BaseModelType } from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import DatabaseCommonInteractionPropsUtil, {
    PermissionType,
} from 'Common/Types/BaseDatabase/DatabaseCommonInteractionPropsUtil';
import Columns from 'Common/Types/Database/Columns';
import BadDataException from 'Common/Types/Exception/BadDataException';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import { PermissionHelper, UserPermission } from 'Common/Types/Permission';

export default class SelectPermission {
    public static checkSelectPermission<TBaseModel extends BaseModel>(
        modelType: BaseModelType,
        select: Select<TBaseModel>,
        props: DatabaseCommonInteractionProps
    ): void {
        const model: BaseModel = new modelType();

        const userPermissions: Array<UserPermission> =
            DatabaseCommonInteractionPropsUtil.getUserPermissions(
                props,
                PermissionType.Allow
            );

        const canReadOnTheseColumns: Columns =
            ColumnPermissions.getModelColumnsByPermissions(
                modelType,
                userPermissions || [],
                DatabaseRequestType.Read
            );

        const tableColumns: Array<string> = model.getTableColumns().columns;

        const excludedColumnNames: Array<string> =
            ColumnPermissions.getExcludedColumnNames();

        for (const key in select) {
            if (excludedColumnNames.includes(key)) {
                continue;
            }

            if (!canReadOnTheseColumns.columns.includes(key)) {
                if (!tableColumns.includes(key)) {
                    throw new BadDataException(
                        `Invalid select clause. Cannot select on "${key}". This column does not exist on ${
                            model.singularName
                        }. Here are the columns you can select on instead: ${tableColumns.join(
                            ', '
                        )}`
                    );
                }

                throw new NotAuthorizedException(
                    `You do not have permissions to select on - ${key}.
                    You need any one of these permissions: ${PermissionHelper.getPermissionTitles(
                        model.getColumnAccessControlFor(key)
                            ? model.getColumnAccessControlFor(key)!.read
                            : []
                    ).join(', ')}`
                );
            }
        }
    }
}
