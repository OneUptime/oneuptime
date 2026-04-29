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
    ctr.prototype.enableAuditLogOn = {
      create: enableAuditLogOn.create ?? true,
      update: enableAuditLogOn.update ?? true,
      delete: enableAuditLogOn.delete ?? true,
    };
  };
};
