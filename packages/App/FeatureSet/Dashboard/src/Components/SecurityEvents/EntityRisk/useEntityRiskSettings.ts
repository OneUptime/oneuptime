import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import { DEFAULT_ENTITY_RISK_CASE_THRESHOLD } from "Common/Types/SecurityCase/SecurityEntityRisk";
import { readRiskCaseThreshold } from "Common/Utils/SecurityCase/SecurityEntityRiskScore";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";

export interface EntityRiskSettings {
  // Where a case opens and an entity reads High: the project's, or 100.
  threshold: number;
  // Whether risk opens cases; null until read, or when it could not be.
  isRiskCaseEnabled: boolean | null;
  isLoaded: boolean;
}

/*
 * The project's say in entity risk (Project.securityRiskCaseThreshold and
 * enableSecurityRiskCases), for the pages that draw levels and say whether
 * risk opens cases. A read that fails leaves the default threshold - the
 * levels read as a new project's - and says nothing about cases.
 */
export default function useEntityRiskSettings(): EntityRiskSettings {
  const [settings, setSettings] = useState<EntityRiskSettings>({
    threshold: DEFAULT_ENTITY_RISK_CASE_THRESHOLD,
    isRiskCaseEnabled: null,
    isLoaded: false,
  });

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      setSettings({
        threshold: DEFAULT_ENTITY_RISK_CASE_THRESHOLD,
        isRiskCaseEnabled: null,
        isLoaded: true,
      });
      return () => {};
    }

    let isCurrent: boolean = true;

    ModelAPI.getItem<Project>({
      modelType: Project,
      id: projectId,
      select: {
        securityRiskCaseThreshold: true,
        enableSecurityRiskCases: true,
      },
    })
      .then((project: Project | null) => {
        if (!isCurrent) {
          return;
        }

        setSettings({
          threshold: readRiskCaseThreshold(project?.securityRiskCaseThreshold),
          isRiskCaseEnabled:
            project && typeof project.enableSecurityRiskCases === "boolean"
              ? project.enableSecurityRiskCases
              : null,
          isLoaded: true,
        });
      })
      .catch(() => {
        if (isCurrent) {
          setSettings({
            threshold: DEFAULT_ENTITY_RISK_CASE_THRESHOLD,
            isRiskCaseEnabled: null,
            isLoaded: true,
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  return settings;
}
