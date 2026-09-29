import GenericFunction from "../../GenericFunction";

export interface OwnedThroughMetadata {
  fkColumn: string;
  /*
   * The parent resource type(s) whose ownership grants access to this
   * model's rows. Usually one (e.g. Monitor), but a polymorphic FK can
   * inherit ownership from several resource types — e.g. a telemetry
   * row's serviceId may reference a Service, Host, DockerHost or
   * KubernetesCluster, so Owned scope unions the owned ids across all of
   * them.
   */
  parentModels: Array<GenericFunction>;
  /*
   * When true, rows whose fkColumn equals the tenant (project) id itself
   * are also visible under Owned scope. Telemetry with no owning resource
   * (the unattributed "Unknown" bucket) is tagged with the projectId in
   * place of a resource id; it belongs to the project, not any single
   * owner, so every in-project user with the table permission may see it.
   */
  includeProjectScope: boolean;
}

export interface OwnedThroughOptions {
  includeProjectScope?: boolean;
}

export default (
  fkColumn: string,
  parentModel: GenericFunction | Array<GenericFunction>,
  options?: OwnedThroughOptions,
) => {
  return (ctr: GenericFunction) => {
    ctr.prototype.ownedThrough = {
      fkColumn,
      parentModels: Array.isArray(parentModel) ? parentModel : [parentModel],
      includeProjectScope: options?.includeProjectScope ?? false,
    };
  };
};
