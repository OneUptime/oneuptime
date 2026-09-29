import EnableAuditLogOn from "../BaseDatabase/EnableAuditLogOn";
import GenericFunction from "../GenericFunction";

export default (
  enableAuditLogOn: EnableAuditLogOn = {
    create: true,
    update: true,
    delete: true,
  },
) => {
  return (ctr: GenericFunction) => {
    const config: EnableAuditLogOn = {
      create: enableAuditLogOn.create ?? true,
      update: enableAuditLogOn.update ?? true,
      delete: enableAuditLogOn.delete ?? true,
    };

    /*
     * Only the keys copied here reach the prototype, so every new option has
     * to be added below or it is silently dropped. The optional ones are set
     * only when configured: a model that uses none of them keeps exactly the
     * three-flag shape it always had. They are copied rather than aliased so
     * nothing can rewrite a model's audit configuration through the object it
     * was declared with.
     */
    if (enableAuditLogOn.rootResource) {
      config.rootResource = { ...enableAuditLogOn.rootResource };
    }

    if (enableAuditLogOn.ignoreColumns) {
      config.ignoreColumns = [...enableAuditLogOn.ignoreColumns];
    }

    if (enableAuditLogOn.resourceNameRelation) {
      config.resourceNameRelation = enableAuditLogOn.resourceNameRelation;
    }

    ctr.prototype.enableAuditLogOn = config;
  };
};
