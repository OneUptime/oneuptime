import RunnerInstallInstructions from "../../Components/Runner/InstallInstructions";
import RunnerStatusElement from "../../Components/Runner/RunnerStatus";
import PageComponentProps from "../PageComponentProps";
import {
  NO_RUNNER_FORM_RESTRICTIONS,
  RunnerFormRestrictions,
  getRunnerFormRestrictions,
  getRunnerTableFormFields,
} from "./RunnerFormFields";
import ProjectUtil from "Common/UI/Utils/Project";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslateValue, {
  UseTranslateValueResult,
} from "Common/UI/Utils/Translation";
import Label from "Common/Models/DatabaseModels/Label";
import Runner from "Common/Models/DatabaseModels/Runner";
import {
  getRunnerLiveStatus,
  getRunnerLiveStatusLabel,
} from "Common/Types/Runner/RunnerLiveStatus";
import { Gray500 } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const RunnersPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showSetupAgent, setShowSetupAgent] = useState<Runner | null>(null);
  /*
   * What the edit form leaves out for the row being edited: on a Runner the
   * Kubernetes agent chart installed, the name and the runbook / code-fix
   * switches, which the server refuses (RunnerFormFields). Set when Edit is
   * clicked, before the form opens; the create form is never restricted.
   */
  const [editingRestrictions, setEditingRestrictions] =
    useState<RunnerFormRestrictions>(NO_RUNNER_FORM_RESTRICTIONS);

  const { translateString }: UseTranslateValueResult = useTranslateValue();

  return (
    <Fragment>
      <ModelTable<Runner>
        modelType={Runner}
        id="runbook-agents-table"
        userPreferencesKey="runbook-agents-table"
        saveFilterProps={{
          tableId: "runbook-agents-table",
        }}
        name="Runners"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={true}
        showRefreshButton={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Runners",
          description:
            "Self-hosted Runners that execute Bash and JavaScript runbook steps in your own infrastructure. Each step picks the Runner that should run it.",
        }}
        selectMoreFields={{
          _id: true,
          key: true,
          canRunCodeFixTasks: true,
          canRunAiCommands: true,
          // The posture: whether a row is a Runner the Kubernetes agent chart installed.
          hostInfo: true,
          /*
           * The Status column renders from lastAlive, so it has to be
           * selected here and not only by the Last Seen column — a Runner
           * fetched without it reads as never connected.
           */
          lastAlive: true,
        }}
        noItemsMessage={
          "No Runners yet. Create one, then run the Docker command on a host inside your infrastructure."
        }
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={[
          { title: "Runner", id: "runner" },
          { title: "Capabilities", id: "capabilities" },
          { title: "Labels", id: "labels" },
        ]}
        onBeforeEdit={(item: Runner): Promise<Runner> => {
          setEditingRestrictions(getRunnerFormRestrictions(item));
          return Promise.resolve(item);
        }}
        formFields={getRunnerTableFormFields(editingRestrictions)}
        searchableFields={["name", "description"]}
        actionButtons={[
          {
            title: "Show setup instructions",
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              item: Runner,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setShowSetupAgent(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            title: "Labels",
            type: FieldType.EntityArray,
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { description: true },
            title: "Description",
            type: FieldType.Text,
          },
          {
            /*
             * Rendered from lastAlive, not from connectionStatus — the column
             * this field names is written on create and on the first heartbeat
             * and never again, so it reports every Runner that ever connected
             * as connected forever. lastAlive comes in via selectMoreFields.
             */
            field: { connectionStatus: true },
            title: "Status",
            type: FieldType.Element,
            /*
             * Sorting and CSV export both go straight to the named column and
             * never through getElement, so leaving them on the default would
             * order and export the stale value this cell exists to stop
             * showing. Sorting is disabled outright — Last Seen next to it
             * sorts on lastAlive, which is the ordering "sort by status"
             * actually means — and the export is given the derived text.
             */
            disableSort: true,
            getExportValue: (item: Runner): string => {
              return getRunnerLiveStatusLabel(
                getRunnerLiveStatus(item.lastAlive),
              );
            },
            getElement: (item: Runner): ReactElement => {
              return <RunnerStatusElement runner={item} showLastSeen={false} />;
            },
          },
          {
            field: { lastAlive: true },
            title: "Last Seen",
            type: FieldType.Element,
            /*
             * Without this the export writes a raw Date toString next to a
             * column that reads "3 months ago" on screen.
             */
            getExportValue: (item: Runner): string => {
              if (!item.lastAlive) {
                return "Never";
              }

              return OneUptimeDate.fromNow(item.lastAlive);
            },
            getElement: (item: Runner): ReactElement => {
              if (!item.lastAlive) {
                return (
                  <span className="text-gray-500">
                    {translateString("Never") || "Never"}
                  </span>
                );
              }
              return <span>{OneUptimeDate.fromNow(item.lastAlive)}</span>;
            },
          },
          {
            field: { canRunRunbooks: true },
            title: "Capabilities",
            type: FieldType.Element,
            getElement: (item: Runner): ReactElement => {
              const capabilities: Array<string> = [];

              if (item.canRunRunbooks !== false) {
                capabilities.push("Runbooks");
              }

              if (item.canRunCodeFixTasks === true) {
                capabilities.push("AI code fixes");
              }

              if (item.canRunAiCommands === true) {
                capabilities.push("AI remediation commands");
              }

              if (capabilities.length === 0) {
                return (
                  <span className="text-gray-500">
                    {translateString("None") || "None"}
                  </span>
                );
              }

              /*
               * Pills rather than a comma-joined sentence: with three
               * capabilities the joined string wrapped to two lines and could
               * not be scanned down the column.
               */
              return (
                <div className="flex flex-wrap gap-1">
                  {capabilities.map((capability: string): ReactElement => {
                    return (
                      <Pill
                        key={capability}
                        text={translateString(capability) || capability}
                        color={Gray500}
                        size={PillSize.Small}
                      />
                    );
                  })}
                </div>
              );
            },
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            getElement: (item: Runner): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />

      {showSetupAgent ? (
        <Modal
          title="Runner setup"
          modalWidth={ModalWidth.Medium}
          submitButtonText="Done"
          submitButtonStyleType={ButtonStyleType.PRIMARY}
          onSubmit={() => {
            setShowSetupAgent(null);
          }}
          onClose={() => {
            setShowSetupAgent(null);
          }}
          closeButtonText="Close"
        >
          <RunnerInstallInstructions
            runnerId={new ObjectID(showSetupAgent._id!.toString())}
            runnerKey={(showSetupAgent.key as string) || ""}
          />
        </Modal>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default RunnersPage;
