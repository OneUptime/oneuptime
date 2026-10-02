import { FormTargetHandler } from "./FormTargetHandler";
import IncidentFormTarget from "./IncidentFormTarget";
import ScheduledMaintenanceFormTarget from "./ScheduledMaintenanceFormTarget";
import FormTargetType from "../../../Types/Form/FormTargetType";

/*
 * The handler for each target, created when asked for: a handler's services
 * sit in an import graph that loops back to FormService, so nothing here
 * runs at module load. A new target adds its case here (and the switch's
 * exhaustiveness makes the compiler ask for it).
 */
export type AnyFormTargetHandler = FormTargetHandler<unknown>;

export type GetFormTargetHandlerFunction = (
  targetType: FormTargetType,
) => AnyFormTargetHandler;

export const getFormTargetHandler: GetFormTargetHandlerFunction = (
  targetType: FormTargetType,
): AnyFormTargetHandler => {
  switch (targetType) {
    case FormTargetType.ScheduledMaintenance:
      return new ScheduledMaintenanceFormTarget() as AnyFormTargetHandler;
    case FormTargetType.Incident:
    default:
      return new IncidentFormTarget() as AnyFormTargetHandler;
  }
};
