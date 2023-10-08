import DatabaseRequestType from '../BaseDatabase/DatabaseRequestType';
import Permission, {
    PermissionHelper,
    UserPermission,
} from 'Common/Types/Permission';
import BaseModel from 'Common/AnalyticsModels/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import PaymentRequiredException from 'Common/Types/Exception/PaymentRequiredException';
import Query from './Query';
import Select from './Select';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Columns from 'Common/Types/Database/Columns';
import ColumnBillingAccessControl from 'Common/Types/BaseDatabase/ColumnBillingAccessControl';
import ObjectID from 'Common/Types/ObjectID';
import { getAllEnvVars, IsBillingEnabled } from '../../EnvironmentConfig';
import SubscriptionPlan from 'Common/Types/Billing/SubscriptionPlan';
import NotAuthenticatedException from 'Common/Types/Exception/NotAuthenticatedException';
import UserType from 'Common/Types/UserType';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
import DatabaseCommonInteractionPropsUtil from 'Common/Types/BaseDatabase/DatabaseCommonInteractionPropsUtil';

export interface CheckReadPermissionType<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    select: Select<TBaseModel> | null;
}

export default class ModelPermission {
    public static async checkDeletePermission<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        props: DatabaseCommonInteractionProps
    ): Promise<Query<TBaseModel>> {
        if (props.isRoot || props.isMasterAdmin) {
            query = await this.addTenantScopeToQueryAsRoot(
                modelType,
                query,
                props
            );
        }

        if (!props.isRoot && !props.isMasterAdmin) {
            this.checkModelLevelPermissions(
                modelType,
                props,
                DatabaseRequestType.Delete
            );
            query = await this.addTenantScopeToQuery(
                modelType,
                query,
                null,
                props
            );
        }

        return query;
    }

    public static async checkUpdatePermissions<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        data: TBaseModel,
        props: DatabaseCommonInteractionProps
    ): Promise<Query<TBaseModel>> {
        if (props.isRoot || props.isMasterAdmin) {
            return query;
        }

        this.checkModelLevelPermissions(
            modelType,
            props,
            DatabaseRequestType.Update
        );

        const checkReadPermissionType: CheckReadPermissionType<TBaseModel> =
            await this.checkReadPermission(modelType, query, null, props);

        query = checkReadPermissionType.query;

        this.checkDataColumnPermissions(
            modelType,
            data as any,
            props,
            DatabaseRequestType.Update
        );

        return query;
    }

    public static checkCreatePermissions<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        data: TBaseModel,
        props: DatabaseCommonInteractionProps
    ): void {
        // If system is making this query then let the query run!
        if (props.isRoot || props.isMasterAdmin) {
            return;
        }

        this.checkModelLevelPermissions(
            modelType,
            props,
            DatabaseRequestType.Create
        );

        this.checkDataColumnPermissions(
            modelType,
            data,
            props,
            DatabaseRequestType.Create
        );
    }

    private static checkDataColumnPermissions<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        data: TBaseModel,
        props: DatabaseCommonInteractionProps,
        requestType: DatabaseRequestType
    ): void {
        const model: BaseModel = new modelType();
        const userPermissions: Array<UserPermission> =
            DatabaseCommonInteractionPropsUtil.getUserPermissions(props);

        const permissionColumns: Columns = this.getModelColumnsByPermissions(
            modelType,
            userPermissions,
            requestType
        );

        const excludedColumnNames: Array<string> =
            ModelPermission.getExcludedColumnNames();

        const tableColumns: Array<AnalyticsTableColumn> =
            model.getTableColumns();

        for (const column of tableColumns) {
            const key: string = column.key;
            if ((data as any)[key] === undefined) {
                continue;
            }

            if (excludedColumnNames.includes(key)) {
                continue;
            }

            if (!permissionColumns.columns.includes(key)) {
                if (
                    requestType === DatabaseRequestType.Create &&
                    column.forceGetDefaultValueOnCreate
                ) {
                    continue; // this is a special case where we want to force the default value on create.
                }

                throw new BadDataException(
                    `User is not allowed to ${requestType} on ${key} column of ${model.singularName}`
                );
            }

            const billingAccessControl: ColumnBillingAccessControl | null =
                model.getColumnBillingAccessControl(key);

            if (IsBillingEnabled && props.currentPlan && billingAccessControl) {
                if (
                    requestType === DatabaseRequestType.Create &&
                    billingAccessControl.create
                ) {
                    if (
                        !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
                            billingAccessControl.create,
                            props.currentPlan,
                            getAllEnvVars()
                        )
                    ) {
                        throw new PaymentRequiredException(
                            'Please upgrade your plan to ' +
                                billingAccessControl.create +
                                ' to access this feature'
                        );
                    }
                }

                if (
                    requestType === DatabaseRequestType.Read &&
                    billingAccessControl.read
                ) {
                    if (
                        !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
                            billingAccessControl.read,
                            props.currentPlan,
                            getAllEnvVars()
                        )
                    ) {
                        throw new PaymentRequiredException(
                            'Please upgrade your plan to ' +
                                billingAccessControl.read +
                                ' to access this feature'
                        );
                    }
                }

                if (
                    requestType === DatabaseRequestType.Update &&
                    billingAccessControl.update
                ) {
                    if (
                        !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
                            billingAccessControl.update,
                            props.currentPlan,
                            getAllEnvVars()
                        )
                    ) {
                        throw new PaymentRequiredException(
                            'Please upgrade your plan to ' +
                                billingAccessControl.update +
                                ' to access this feature'
                        );
                    }
                }
            }
        }
    }

    public static async checkReadPermission<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        select: Select<TBaseModel> | null,
        props: DatabaseCommonInteractionProps
    ): Promise<CheckReadPermissionType<TBaseModel>> {
        if (props.isRoot || props.isMasterAdmin) {
            query = await this.addTenantScopeToQueryAsRoot(
                modelType,
                query,
                props
            );
        }

        if (!props.isRoot && !props.isMasterAdmin) {
            //check if the user is logged in.
            this.checkIfUserIsLoggedIn(
                modelType,
                props,
                DatabaseRequestType.Read
            );

            // add tenant scope.
            query = await this.addTenantScopeToQuery(
                modelType,
                query,
                select,
                props
            );

            if (!props.isMultiTenantRequest) {
                // We will check for this permission in recursive function.

                // check model level permissions.
                this.checkModelLevelPermissions(
                    modelType,
                    props,
                    DatabaseRequestType.Read
                );

                // We will check for this permission in recursive function.
                // check query permissions.
                this.checkQueryPermission(modelType, query, props);

                if (select) {
                    // check query permission.
                    this.checkSelectPermission(modelType, select, props);
                }
            }
        }

        query = this.serializeQuery(query);

        if (select) {
            const result: {
                select: Select<TBaseModel>;
            } = this.sanitizeSelect(select);
            select = result.select;
        }

        return { query, select };
    }

    private static serializeQuery<TBaseModel extends BaseModel>(
        query: Query<TBaseModel>
    ): Query<TBaseModel> {
        query = query as Query<TBaseModel>;

        return query;
    }

    private static sanitizeSelect<TBaseModel extends BaseModel>(
        select: Select<TBaseModel>
    ): {
        select: Select<TBaseModel>;
    } {
        return { select };
    }

    private static getExcludedColumnNames(): string[] {
        const returnArr: Array<string> = [
            '_id',
            'createdAt',
            'deletedAt',
            'updatedAt',
            'version',
        ];

        return returnArr;
    }

    private static checkQueryPermission<TBaseModel extends BaseModel>(
        modelType: { new (): BaseModel },
        query: Query<TBaseModel>,
        props: DatabaseCommonInteractionProps
    ): void {
        const model: BaseModel = new modelType();

        const userPermissions: Array<UserPermission> =
            DatabaseCommonInteractionPropsUtil.getUserPermissions(props);

        const canReadOnTheseColumns: Columns =
            this.getModelColumnsByPermissions(
                modelType,
                userPermissions || [],
                DatabaseRequestType.Read
            );

        const tableColumns: Array<AnalyticsTableColumn> =
            model.getTableColumns();

        const excludedColumnNames: Array<string> =
            ModelPermission.getExcludedColumnNames();

        // Now we need to check all columns.

        for (const key in query) {
            if (excludedColumnNames.includes(key)) {
                continue;
            }

            if (!canReadOnTheseColumns.columns.includes(key)) {
                const column: AnalyticsTableColumn | undefined =
                    tableColumns.find((item: AnalyticsTableColumn) => {
                        return item.key === key;
                    });

                if (!column) {
                    throw new BadDataException(
                        `Invalid column on ${model.singularName} - ${key}. Column does not exist.`
                    );
                }

                throw new NotAuthorizedException(
                    `You do not have permissions to query on - ${key}. You need any one of these permissions: ${PermissionHelper.getPermissionTitles(
                        column.accessControl?.read || []
                    ).join(', ')}`
                );
            }
        }
    }

    private static async addTenantScopeToQueryAsRoot<
        TBaseModel extends BaseModel
    >(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        props: DatabaseCommonInteractionProps
    ): Promise<Query<TBaseModel>> {
        const model: BaseModel = new modelType();

        const tenantColumn: string | null =
            model.getTenantColumn()?.key || null;

        // If this model has a tenantColumn, and request has tenantId, and is multiTenantQuery null then add tenantId to query.
        if (tenantColumn && props.tenantId && !props.isMultiTenantRequest) {
            (query as any)[tenantColumn] = props.tenantId;
        }

        return query;
    }

    private static async addTenantScopeToQuery<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        query: Query<TBaseModel>,
        select: Select<TBaseModel> | null,
        props: DatabaseCommonInteractionProps
    ): Promise<Query<TBaseModel>> {
        const model: BaseModel = new modelType();

        const tenantColumn: string | null =
            model.getTenantColumn()?.key || null;

        // If this model has a tenantColumn, and request has tenantId, and is multiTenantQuery null then add tenantId to query.
        if (tenantColumn && props.tenantId && !props.isMultiTenantRequest) {
            (query as any)[tenantColumn] = props.tenantId;
        } else if (
            tenantColumn &&
            !props.tenantId &&
            props.userGlobalAccessPermission
        ) {
            // for each of these projectIds,
            // check if they have valid permissions for these projects
            // and if they do, include them in the query.

            const queries: Array<Query<TBaseModel>> = [];

            let projectIDs: Array<ObjectID> = [];

            if (
                props.userGlobalAccessPermission &&
                props.userGlobalAccessPermission.projectIds
            ) {
                projectIDs = props.userGlobalAccessPermission?.projectIds;
            }

            let lastException: Error | null = null;

            for (const projectId of projectIDs) {
                if (!props.userId) {
                    continue;
                }

                try {
                    const checkReadPermissionType: CheckReadPermissionType<TBaseModel> =
                        await this.checkReadPermission(
                            modelType,
                            query,
                            select,
                            {
                                ...props,
                                isMultiTenantRequest: false,
                                tenantId: projectId,
                                userTenantAccessPermission:
                                    props.userTenantAccessPermission,
                            }
                        );
                    queries.push({
                        ...(checkReadPermissionType.query as Query<TBaseModel>),
                    });
                } catch (e) {
                    // do nothing here. Ignore.
                    lastException = e as Error;
                }
            }

            if (queries.length === 0) {
                throw new NotAuthorizedException(
                    lastException?.message ||
                        'Does not have permission to read ' + model.singularName
                );
            }

            return queries as any;
        }

        return query;
    }

    private static getModelColumnsByPermissions<TBaseModel extends BaseModel>(
        modelType: { new (): TBaseModel },
        userPermissions: Array<UserPermission>,
        requestType: DatabaseRequestType
    ): Columns {
        const model: BaseModel = new modelType();
        const tableColumns: Array<AnalyticsTableColumn> =
            model.getTableColumns();

        const columns: Array<string> = [];

        const permissions: Array<Permission> = userPermissions.map(
            (item: UserPermission) => {
                return item.permission;
            }
        );

        for (const column of tableColumns) {
            let columnPermissions: Array<Permission> = [];

            if (requestType === DatabaseRequestType.Read) {
                columnPermissions = column.accessControl?.read || [];
            }

            if (requestType === DatabaseRequestType.Create) {
                columnPermissions = column.accessControl?.create || [];
            }

            if (requestType === DatabaseRequestType.Update) {
                columnPermissions = column.accessControl?.update || [];
            }

            if (requestType === DatabaseRequestType.Delete) {
                throw new BadDataException('Invalid request type delete');
            }

            if (
                columnPermissions &&
                PermissionHelper.doesPermissionsIntersect(
                    permissions,
                    columnPermissions
                )
            ) {
                columns.push(column.key);
            }
        }

        return new Columns(columns);
    }

    private static checkSelectPermission<TBaseModel extends BaseModel>(
        modelType: { new (): BaseModel },
        select: Select<TBaseModel>,
        props: DatabaseCommonInteractionProps
    ): void {
        const model: BaseModel = new modelType();

        const userPermissions: Array<UserPermission> =
            DatabaseCommonInteractionPropsUtil.getUserPermissions(props);

        const canReadOnTheseColumns: Columns =
            this.getModelColumnsByPermissions(
                modelType,
                userPermissions || [],
                DatabaseRequestType.Read
            );

        const tableColumns: Array<AnalyticsTableColumn> =
            model.getTableColumns();

        const excludedColumnNames: Array<string> =
            ModelPermission.getExcludedColumnNames();

        for (const key in select) {
            if (excludedColumnNames.includes(key)) {
                continue;
            }

            if (!canReadOnTheseColumns.columns.includes(key)) {
                const column: AnalyticsTableColumn | undefined =
                    tableColumns.find((column: AnalyticsTableColumn) => {
                        return column.key === key;
                    });
                if (!column) {
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
                        column.accessControl?.read || []
                    ).join(', ')}`
                );
            }
        }
    }

    private static getModelPermissions(
        modelType: { new (): BaseModel },
        type: DatabaseRequestType
    ): Array<Permission> {
        let modelPermissions: Array<Permission> = [];
        const model: BaseModel = new modelType();

        if (type === DatabaseRequestType.Create) {
            modelPermissions = model.accessControl?.create || [];
        }

        if (type === DatabaseRequestType.Update) {
            modelPermissions = model.accessControl?.update || [];
        }

        if (type === DatabaseRequestType.Delete) {
            modelPermissions = model.accessControl?.delete || [];
        }

        if (type === DatabaseRequestType.Read) {
            modelPermissions = model.accessControl?.read || [];
        }

        return modelPermissions;
    }

    private static isPublicPermissionAllowed(
        modelType: { new (): BaseModel },
        type: DatabaseRequestType
    ): boolean {
        let isPublicAllowed: boolean = false;
        isPublicAllowed = this.getModelPermissions(modelType, type).includes(
            Permission.Public
        );
        return isPublicAllowed;
    }

    public static checkIfUserIsLoggedIn(
        modelType: { new (): BaseModel },
        props: DatabaseCommonInteractionProps,
        type: DatabaseRequestType
    ): void {
        // 1 CHECK: PUBLIC check -- Check if this is a public request and if public is allowed.

        if (!this.isPublicPermissionAllowed(modelType, type) && !props.userId) {
            if (props.userType === UserType.API) {
                // if its an API request then continue.
                return;
            }

            // this means the record is not publicly createable and the user is not logged in.
            throw new NotAuthenticatedException(
                `A user should be logged in to ${type} record of ${
                    new modelType().singularName
                }.`
            );
        }
    }

    private static checkModelLevelPermissions(
        modelType: { new (): BaseModel },
        props: DatabaseCommonInteractionProps,
        type: DatabaseRequestType
    ): void {
        this.checkIfUserIsLoggedIn(modelType, props, type);

        // 2nd CHECK: Does user have access to CRUD data on this model.
        const userPermissions: Array<UserPermission> =
            DatabaseCommonInteractionPropsUtil.getUserPermissions(props);
        const modelPermissions: Array<Permission> = this.getModelPermissions(
            modelType,
            type
        );

        if (
            !PermissionHelper.doesPermissionsIntersect(
                userPermissions.map((userPermission: UserPermission) => {
                    return userPermission.permission;
                }) || [],
                modelPermissions
            )
        ) {
            throw new NotAuthorizedException(
                `You do not have permissions to ${type} ${
                    new modelType().singularName
                }. You need one of these permissions: ${PermissionHelper.getPermissionTitles(
                    modelPermissions
                ).join(', ')}`
            );
        }

        /// Check billing permissions.

        if (IsBillingEnabled && props.currentPlan) {
            const model: BaseModel = new modelType();

            if (
                props.isSubscriptionUnpaid &&
                !model.allowAccessIfSubscriptionIsUnpaid
            ) {
                throw new PaymentRequiredException(
                    'Your current subscription is in an unpaid state. Looks like your payment method failed. Please add a new payment method in Project Settings > Invoices to pay unpaid invoices.'
                );
            }

            if (
                type === DatabaseRequestType.Create &&
                model.tableBillingAccessControl?.create
            ) {
                if (
                    !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
                        model.tableBillingAccessControl.create,
                        props.currentPlan,
                        getAllEnvVars()
                    )
                ) {
                    throw new PaymentRequiredException(
                        'Please upgrade your plan to ' +
                            model.tableBillingAccessControl.create +
                            ' to access this feature'
                    );
                }
            }

            if (
                type === DatabaseRequestType.Update &&
                model.tableBillingAccessControl?.update
            ) {
                if (
                    !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
                        model.tableBillingAccessControl.update,
                        props.currentPlan,
                        getAllEnvVars()
                    )
                ) {
                    throw new PaymentRequiredException(
                        'Please upgrade your plan to ' +
                            model.tableBillingAccessControl.create +
                            ' to access this feature'
                    );
                }
            }

            if (
                type === DatabaseRequestType.Delete &&
                model.tableBillingAccessControl?.delete
            ) {
                if (
                    !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
                        model.tableBillingAccessControl.delete,
                        props.currentPlan,
                        getAllEnvVars()
                    )
                ) {
                    throw new PaymentRequiredException(
                        'Please upgrade your plan to ' +
                            model.tableBillingAccessControl.create +
                            ' to access this feature'
                    );
                }
            }

            if (
                type === DatabaseRequestType.Read &&
                model.tableBillingAccessControl?.read
            ) {
                if (
                    !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
                        model.tableBillingAccessControl?.read,
                        props.currentPlan,
                        getAllEnvVars()
                    )
                ) {
                    throw new PaymentRequiredException(
                        'Please upgrade your plan to ' +
                            model.tableBillingAccessControl?.read +
                            ' to access this feature'
                    );
                }
            }
        }
    }
}
