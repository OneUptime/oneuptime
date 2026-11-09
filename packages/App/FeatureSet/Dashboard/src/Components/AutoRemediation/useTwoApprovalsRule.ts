import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import { subscribeToModelSwitchSaved } from "Common/UI/Components/ModelSwitch/ModelSwitchEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";
import { TWO_APPROVALS_COLUMN } from "../AISettings/FixApprovalsCopy";

/*
 * Whether the selected project asks two people to approve a riskier fix
 * (Project.requireTwoApprovalsForRiskierFixes), for the AI card's
 * Remediation step: a fix that needs two says so before anyone approves it,
 * and its first approver's press says "Approve", not "Approve & Run".
 *
 * Read only while the step holds a fix it matters for (`isNeeded`: a riskier
 * command plan that waits for approval), once per project, and followed
 * live when the switch is flipped anywhere on the screen
 * (ModelSwitchEvents). Undefined until it is read, or when it cannot be:
 * the step then says nothing of two approvals before a first one is in -
 * the server decides, and the step reads what it decided.
 *
 * Read again each time `readCount` moves: the step moves it after every
 * Approve, since the server reads the rule as it is then (RemediationApproval)
 * and someone may have flipped it on another screen while this page was
 * open - a press that turned out to be the first of two then reads as one,
 * rather than offering its own first approver an Approve & Run the server
 * would refuse. A value already read stays shown while it is read again.
 */
const readSelectedProjectId: () => string = (): string => {
  try {
    return ProjectUtil.getCurrentProjectId()?.toString() || "";
  } catch {
    return "";
  }
};

interface RuleRead {
  projectId: string;
  value: boolean | undefined;
}

const useTwoApprovalsRule: (
  isNeeded: boolean,
  readCount?: number,
) => boolean | undefined = (
  isNeeded: boolean,
  readCount: number = 0,
): boolean | undefined => {
  const projectId: string = readSelectedProjectId();
  const [read, setRead] = useState<RuleRead>({
    projectId: "",
    value: undefined,
  });

  useEffect(() => {
    if (!isNeeded || !projectId || !ObjectID.isValidUUID(projectId)) {
      return;
    }

    let isCurrent: boolean = true;
    const id: ObjectID = new ObjectID(projectId);

    /*
     * Set when the switch is saved: a read that was already on its way must
     * not put back the value from before the save.
     */
    let hasHeardSave: boolean = false;

    const readRule: () => Promise<void> = async (): Promise<void> => {
      try {
        const project: Project | null = await ModelAPI.getItem<Project>({
          modelType: Project,
          id: id,
          select: {
            requireTwoApprovalsForRiskierFixes: true,
          },
        });

        if (isCurrent && !hasHeardSave) {
          setRead({
            projectId,
            value: project
              ? project.requireTwoApprovalsForRiskierFixes === true
              : undefined,
          });
        }
      } catch {
        // Unknown: the server decides, and the step reads what it decided.
      }
    };

    void readRule();

    const unsubscribe: () => void = subscribeToModelSwitchSaved({
      modelType: Project,
      modelId: id,
      column: TWO_APPROVALS_COLUMN,
      onSaved: (value: boolean): void => {
        hasHeardSave = true;

        if (isCurrent) {
          setRead({ projectId, value });
        }
      },
    });

    return () => {
      isCurrent = false;
      unsubscribe();
    };
  }, [isNeeded, projectId, readCount]);

  return read.projectId === projectId ? read.value : undefined;
};

export default useTwoApprovalsRule;
