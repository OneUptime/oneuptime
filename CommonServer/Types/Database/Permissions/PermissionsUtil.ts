import Query from "../Query";
import BaseModel from "Common/Models/BaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";

export default class PermissionUtil {
  public static async addTenantScopeToQueryAsRoot<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    const model: BaseModel = new modelType();

    const tenantColumn: string | null = model.getTenantColumn();

    // If this model has a tenantColumn, and request has tenantId, and is multiTenantQuery null then add tenantId to query.
    if (tenantColumn && props.tenantId && !props.isMultiTenantRequest) {
      (query as any)[tenantColumn] = props.tenantId;
    }

    return query;
  }
}
