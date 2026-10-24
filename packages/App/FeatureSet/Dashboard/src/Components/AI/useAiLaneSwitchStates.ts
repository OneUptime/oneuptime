import { AiLaneSwitchStates, AiOffSubjectType } from "./AiOffSummaryData";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { MutableRefObject, useEffect, useRef, useState } from "react";

/*
 * The project's "Investigate new ..." and "Fix new ... automatically"
 * switches for a kind of record, as they are now - for the AI card's
 * one-line summary, which then says "is on now" for a switch that was off
 * when the record was created rather than asking to turn on what is on.
 *
 * Read once per project and kind, and only while isEnabled: the summary is
 * the only thing that needs them, and most records never fold. A switch
 * that cannot be read (a reader whose role may not read it, a request that
 * fails) stays unknown, and the summary words its step as it would without
 * knowing.
 */

interface ReadSwitches {
  key: string;
  states: AiLaneSwitchStates;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

const useAiLaneSwitchStates: (data: {
  subjectType: AiOffSubjectType;
  isEnabled: boolean;
}) => AiLaneSwitchStates = (data: {
  subjectType: AiOffSubjectType;
  isEnabled: boolean;
}): AiLaneSwitchStates => {
  let projectId: string = "";

  try {
    projectId = ProjectUtil.getCurrentProjectId()?.toString() || "";
  } catch {
    projectId = "";
  }

  const key: string = `${projectId}:${data.subjectType}`;
  const [read, setRead] = useState<ReadSwitches>({ key: "", states: {} });
  const requestedKeyRef: MutableRefObject<string> = useRef<string>("");

  useEffect(() => {
    if (
      !data.isEnabled ||
      !projectId ||
      !ObjectID.isValidUUID(projectId) ||
      requestedKeyRef.current === key
    ) {
      return;
    }

    requestedKeyRef.current = key;
    let isCurrent: boolean = true;
    let isSettled: boolean = false;
    const isAlert: boolean = data.subjectType === "alert";

    ModelAPI.getItem<Project>({
      modelType: Project,
      id: new ObjectID(projectId),
      select: isAlert
        ? {
            enableAutomaticAlertInvestigation: true,
            enableAutomaticAlertRemediation: true,
          }
        : {
            enableAutomaticIncidentInvestigation: true,
            enableAutomaticIncidentRemediation: true,
          },
    })
      .then((project: Project | null): void => {
        if (!isCurrent) {
          return;
        }

        isSettled = true;
        setRead({
          key,
          states: {
            investigate: readBoolean(
              isAlert
                ? project?.enableAutomaticAlertInvestigation
                : project?.enableAutomaticIncidentInvestigation,
            ),
            fix: readBoolean(
              isAlert
                ? project?.enableAutomaticAlertRemediation
                : project?.enableAutomaticIncidentRemediation,
            ),
          },
        });
      })
      .catch((): void => {
        // Unknown: the summary says what it would without knowing.
        if (isCurrent) {
          isSettled = true;
          setRead({ key, states: {} });
        }
      });

    return () => {
      isCurrent = false;
      // A read that was cut short is read again when the card next folds.
      if (!isSettled && requestedKeyRef.current === key) {
        requestedKeyRef.current = "";
      }
    };
  }, [data.isEnabled, data.subjectType, key, projectId]);

  return read.key === key ? read.states : {};
};

export default useAiLaneSwitchStates;
