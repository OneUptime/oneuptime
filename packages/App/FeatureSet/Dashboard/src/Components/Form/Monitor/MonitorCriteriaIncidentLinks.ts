import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

export interface LinkedIncidentActionOptionArgs {
  criteriaInstances: Array<MonitorCriteriaInstance>;
  currentCriteriaId: string | undefined;
  currentIncident: CriteriaIncident;
  severityOptions: Array<DropdownOption>;
}

interface IncidentActionCandidate {
  action: CriteriaIncident;
  criteriaId: string | undefined;
  criteriaName: string;
  criteriaNumber: number;
  isEnabled: boolean;
}

/** Build direct-link targets that belong to a different monitor criterion. */
export function getLinkedIncidentActionOptions(
  args: LinkedIncidentActionOptionArgs,
): Array<DropdownOption> {
  const actions: Array<IncidentActionCandidate> =
    args.criteriaInstances.flatMap(
      (
        criteria: MonitorCriteriaInstance,
        criteriaIndex: number,
      ): Array<IncidentActionCandidate> => {
        const data: MonitorCriteriaInstance["data"] = criteria.data;
        return (data?.incidents || []).map((action: CriteriaIncident) => {
          return {
            action: action,
            criteriaId: data?.id,
            criteriaName: data?.name || "Unnamed criteria",
            criteriaNumber: criteriaIndex + 1,
            isEnabled:
              data?.isEnabled !== false && data?.createIncidents === true,
          };
        });
      },
    );

  const currentActionIsAnchor: boolean = actions.some(
    (item: IncidentActionCandidate) => {
      return (
        item.action.id !== args.currentIncident.id &&
        item.criteriaId !== args.currentCriteriaId &&
        item.action.linkedIncidentActionId === args.currentIncident.id
      );
    },
  );

  const describeAction: (item: IncidentActionCandidate) => string = (
    item: IncidentActionCandidate,
  ): string => {
    const severity: string | undefined = args.severityOptions.find(
      (option: DropdownOption) => {
        return option.value === item.action.incidentSeverityId?.toString();
      },
    )?.label;

    return `Criteria ${item.criteriaNumber}: ${item.criteriaName} — ${item.action.title || "Untitled incident"}${severity ? ` (${severity})` : ""}`;
  };

  const options: Array<DropdownOption> = currentActionIsAnchor
    ? []
    : actions
        .filter((item: IncidentActionCandidate) => {
          return (
            Boolean(args.currentCriteriaId) &&
            item.criteriaId !== args.currentCriteriaId &&
            item.action.id !== args.currentIncident.id &&
            item.isEnabled &&
            !item.action.linkedIncidentActionId &&
            Boolean(item.action.incidentSeverityId)
          );
        })
        .map((item: IncidentActionCandidate) => {
          return {
            value: item.action.id,
            label: describeAction(item),
          };
        });

  const selectedActionId: string | undefined =
    args.currentIncident.linkedIncidentActionId;
  if (
    selectedActionId &&
    !options.some((item: DropdownOption) => {
      return item.value === selectedActionId;
    })
  ) {
    const selectedAction: IncidentActionCandidate | undefined = actions.find(
      (item: IncidentActionCandidate) => {
        return item.action.id === selectedActionId;
      },
    );

    options.push({
      value: selectedActionId,
      label: selectedAction
        ? describeAction(selectedAction)
        : "Linked incident action is unavailable",
      description: "Clear this selection to remove the link.",
      isDisabled: true,
    });
  }

  return options;
}
