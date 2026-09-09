import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../Utils/API/API";
import LabelRuleImportExport, {
  LabelRuleImportResult,
} from "../../Utils/LabelRuleImportExport";
import ModelImportExportUtil from "../../Utils/ModelImportExport";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../Utils/PermissionGate";
import ProjectUtil from "../../Utils/Project";
import Alert, { AlertType } from "../Alerts/Alert";
import { ButtonStyleType } from "../Button/Button";
import { CardButtonSchema } from "../Card/Card";
import ModelTable, { ComponentProps } from "../ModelTable/ModelTable";
import ImportLabelRulesModal from "./ImportLabelRulesModal";
import React, { ReactElement, useRef, useState } from "react";

const LabelRuleTable: <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
) => ReactElement = <TBaseModel extends BaseModel>(
  props: ComponentProps<TBaseModel>,
): ReactElement => {
  const model: TBaseModel = new props.modelType();
  const [importProjectId, setImportProjectId] = useState<ObjectID | null>(null);
  const [refreshCounter, setRefreshCounter] = useState<number>(0);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const exportInProgress: React.MutableRefObject<boolean> = useRef(false);
  const [error, setError] = useState<string>("");
  const buttons: Array<CardButtonSchema | ReactElement> = [
    ...(props.cardProps?.buttons || []),
  ];

  const readGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Read,
  );
  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
  );

  if (readGate.isAllowed || readGate.disabledReason) {
    buttons.push({
      title: "Export JSON",
      icon: IconProp.Download,
      buttonStyle: ButtonStyleType.OUTLINE,
      disabled: !readGate.isAllowed || isExporting,
      tooltip:
        readGate.disabledReason ||
        "Export all label rules in this project, including rules on other pages.",
      isLoading: isExporting,
      onClick: async () => {
        if (!readGate.isAllowed || exportInProgress.current) {
          return;
        }

        exportInProgress.current = true;
        setIsExporting(true);
        setError("");
        try {
          const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
          if (!projectId) {
            throw new Error("Select a project before exporting label rules.");
          }

          const envelope: JSONObject = await LabelRuleImportExport.exportAll({
            modelType: props.modelType,
            projectId,
            modelAPI: props.modelAPI,
          });
          ModelImportExportUtil.downloadJSONFile({
            content: JSON.stringify(envelope, null, 2),
            filename: `${model.tableName || "label-rules"}-export.json`,
          });
        } catch (err) {
          setError(API.getFriendlyMessage(err));
        } finally {
          exportInProgress.current = false;
          setIsExporting(false);
        }
      },
    });
  }

  if (createGate.isAllowed || createGate.disabledReason) {
    buttons.push({
      title: "Import JSON",
      icon: IconProp.Upload,
      buttonStyle: ButtonStyleType.OUTLINE,
      disabled: !createGate.isAllowed,
      tooltip: createGate.disabledReason,
      onClick: () => {
        if (!createGate.isAllowed) {
          return;
        }
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          setError("Select a project before importing label rules.");
          return;
        }
        setError("");
        setImportProjectId(projectId);
      },
    });
  }

  return (
    <>
      {error && <Alert type={AlertType.DANGER} title={error} />}
      <ModelTable<TBaseModel>
        {...props}
        enableJsonImportExport={false}
        cardProps={{ ...props.cardProps, buttons }}
        refreshToggle={`${props.refreshToggle || ""}-label-import-${refreshCounter}`}
      />
      {importProjectId && (
        <ImportLabelRulesModal<TBaseModel>
          modelType={props.modelType}
          modelAPI={props.modelAPI}
          projectId={importProjectId}
          onClose={() => {
            setImportProjectId(null);
          }}
          onImportComplete={(result: LabelRuleImportResult) => {
            // A failed response can still follow a successful server write.
            if (result.successCount + result.failures.length > 0) {
              setRefreshCounter((counter: number) => {
                return counter + 1;
              });
            }
          }}
        />
      )}
    </>
  );
};

export default LabelRuleTable;
