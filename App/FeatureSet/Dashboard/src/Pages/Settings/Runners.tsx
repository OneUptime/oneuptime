import RunnerInstallInstructions from "../../Components/Runner/InstallInstructions";
import PageComponentProps from "../PageComponentProps";
import ProjectUtil from "Common/UI/Utils/Project";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Runner, {
  RunnerConnectionStatus,
} from "Common/Models/DatabaseModels/Runner";
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
        cardProps={{
          title: "Runners",
          description:
            "Self-hosted agents that execute Bash and JavaScript runbook steps in your own infrastructure. Each step picks the agent that should run it.",
        }}
        selectMoreFields={{
          _id: true,
          key: true,
          canRunCodeFixTasks: true,
          canRunAiCommands: true,
        }}
        noItemsMessage={
          "No runbook agents yet. Create one, then run the Docker command on a host inside your infrastructure."
        }
        viewPageRoute={Navigation.getCurrentRoute()}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "prod-eu-runbook-agent",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Runs inside the production EU cluster. Can reach internal services.",
          },
          {
            field: { canRunRunbooks: true },
            title: "Runs Runbooks",
            description:
              "Let this Runner execute runbook Bash and JavaScript steps on the host it runs on. On by default — this is why most Runners are installed.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
          },
          {
            field: { canRunCodeFixTasks: true },
            title: "Runs AI Code Fixes",
            description:
              "Let this Runner work in the code repositories connected to this project and open draft pull requests. Off by default; it needs a connected repository. The Runner picks this up on its next heartbeat — no restart needed.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: false,
          },
          {
            field: { canRunAiCommands: true },
            title: "Runs AI Remediation Commands",
            description:
              "Let AI auto-remediation execute policy-checked commands on this Runner. Off by default — commands either match the rule's allowlist or wait for one-click human approval, and destructive commands are always refused. Takes effect on the Runner's next heartbeat, no restart needed.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: false,
          },
          {
            field: { labels: true },
            title: "Labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
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
            field: { connectionStatus: true },
            title: "Status",
            type: FieldType.Element,
            getElement: (item: Runner): ReactElement => {
              const isConnected: boolean =
                item.connectionStatus === RunnerConnectionStatus.Connected;
              return (
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      isConnected ? "bg-emerald-500" : "bg-red-500"
                    }`}
                  />
                  <span
                    className={`text-sm font-medium ${
                      isConnected ? "text-emerald-700" : "text-red-700"
                    }`}
                  >
                    {isConnected ? "Connected" : "Disconnected"}
                  </span>
                </div>
              );
            },
          },
          {
            field: { lastAlive: true },
            title: "Last Seen",
            type: FieldType.Element,
            getElement: (item: Runner): ReactElement => {
              if (!item.lastAlive) {
                return <span className="text-gray-500">Never</span>;
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
                return <span className="text-gray-500">None</span>;
              }

              return <span>{capabilities.join(", ")}</span>;
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
            agentId={new ObjectID(showSetupAgent._id!.toString())}
            agentKey={(showSetupAgent.key as string) || ""}
          />
        </Modal>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default RunnersPage;
