import FormsCopy from "../FormsCopy";
import Alert from "Common/Models/DatabaseModels/Alert";
import FormTargetType, {
  FORM_TARGET_TYPES,
} from "Common/Types/Form/FormTargetType";
import IconProp from "Common/Types/Icon/IconProp";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";

/*
 * What a form can create, as the dashboard offers the choice: the Forms
 * list's Create Form and the On Submit page's "What Each Submission
 * Creates" (FormTargetCard). React-free, so the tests read the same rules.
 */

// Each target's icon: the icon its product's own pages use.
export const FORM_TARGET_ICONS: Record<FormTargetType, IconProp> = {
  [FormTargetType.Incident]: IconProp.Alert,
  [FormTargetType.Alert]: IconProp.ExclaimationCircle,
  [FormTargetType.ScheduledMaintenance]: IconProp.Clock,
};

/*
 * Whether the reader may set a form up to create this target, besides the
 * Form permissions: a form that creates alerts takes permission to create
 * alerts (#10760), as the server asks (FormService.assertMaySetUpTarget).
 * Incidents and maintenance events take the Form permissions alone. Follows
 * PermissionGate's three answers: allowed; refused, with why; not known
 * yet (the permission snapshot has not loaded).
 */
export const getFormTargetSetUpGate: (
  target: FormTargetType,
) => PermissionGateResult = (target: FormTargetType): PermissionGateResult => {
  if (target === FormTargetType.Alert) {
    return PermissionGate.check(new Alert(), ModelAction.Create);
  }

  return { isAllowed: true };
};

/*
 * The targets Create Form offers: every one the reader may set a form up
 * for. One the reader is known to be refused is left out - its card would
 * only be refused on save; one not known yet is offered, and the server
 * decides.
 */
export const getFormTargetsToOffer: () => Array<FormTargetType> =
  (): Array<FormTargetType> => {
    return FORM_TARGET_TYPES.filter((target: FormTargetType): boolean => {
      const gate: PermissionGateResult = getFormTargetSetUpGate(target);

      return gate.isAllowed || !gate.disabledReason;
    });
  };

/*
 * What changing what a form creates keeps, said before it is done: the
 * questions linked to fields both targets have stay linked
 * (convertFormFieldsForTarget) - between an incident and a maintenance
 * event, title, description, monitors and labels; to or from an alert,
 * which has its own severities and one monitor, title, description and
 * labels - and the On Submit settings start over.
 */
export const getChangeTargetDescription: (data: {
  from: FormTargetType;
  to: FormTargetType;
}) => string = (data: { from: FormTargetType; to: FormTargetType }): string => {
  const isFromAlert: boolean = data.from === FormTargetType.Alert;

  switch (data.to) {
    case FormTargetType.Alert:
      return FormsCopy.changeTargetToAlert;
    case FormTargetType.ScheduledMaintenance:
      return isFromAlert
        ? FormsCopy.changeTargetFromAlertToScheduledMaintenance
        : FormsCopy.changeTargetToScheduledMaintenance;
    case FormTargetType.Incident:
    default:
      return isFromAlert
        ? FormsCopy.changeTargetFromAlertToIncident
        : FormsCopy.changeTargetToIncident;
  }
};
