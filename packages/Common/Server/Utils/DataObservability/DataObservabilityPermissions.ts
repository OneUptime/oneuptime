import Permission from "../../../Types/Permission";
import ProductKey from "../../../Types/Product/ProductKey";
import { withProductLevelsOf } from "../../../Types/Product/ProductLevels";

/*
 * WHO READS, OPERATES AND CONNECTS DATA OBSERVABILITY'S OWN ROUTES.
 *
 * With Data Observability's own levels (Types/Product/ProductLevels): its
 * Viewer reads, its Member operates and its Admin connects, as Viewer,
 * Project Member and Project Admin do. A database's settings (#11147) are
 * read by its readers and changed by those who may connect one: renaming
 * it, changing how it is reached, removing it from Data Observability and
 * deleting it.
 */
export const DATA_OBSERVABILITY_READ_PERMISSIONS: Array<Permission> =
  withProductLevelsOf({
    products: [ProductKey.DataObservability],
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadDataAsset,
    ],
  });

export const DATA_OBSERVABILITY_OPERATE_PERMISSIONS: Array<Permission> =
  withProductLevelsOf({
    products: [ProductKey.DataObservability],
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.EditDataAsset,
    ],
  });

export const DATA_OBSERVABILITY_CONNECT_PERMISSIONS: Array<Permission> =
  withProductLevelsOf({
    products: [ProductKey.DataObservability],
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.TelemetryAdmin,
      Permission.CreateDataAsset,
    ],
  });
