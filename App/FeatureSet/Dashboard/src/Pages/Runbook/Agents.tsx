import RunbookAgentInstallInstructions from "../../Components/RunbookAgent/InstallInstructions";
import PageComponentProps from "../PageComponentProps";
import ProjectUtil from "Common/UI/Utils/Project";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { IconType } from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import RunbookAgent, {
  RunbookAgentConnectionStatus,
} from "Common/Models/DatabaseModels/RunbookAgent";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const RunbookAgentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [showSetupAgent, setShowSetupAgent] = useState<RunbookAgent | null>(
    null,
  );

  return (
    <Fragment>
      <ModelTable<RunbookAgent>
        modelType={RunbookAgent}
        id="runbook-agents-table"
        userPreferencesKey="runbook-agents-table"
        name="Runbook Agents"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        cardProps={{
          title: "Runbook Agents",
          description:
            "Self-hosted agents that execute Bash and JavaScript runbook steps in your own infrastructure. Each step picks the agent that should run it.",
        }}
        selectMoreFields={{
          _id: true,
          key: true,
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
        ]}
        searchableFields={["name", "description"]}
        actionButtons={[
          {
            title: "Show setup instructions",
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              item: RunbookAgent,
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
            getElement: (item: RunbookAgent): ReactElement => {
              const status: string | undefined = item.connectionStatus as
                | string
                | undefined;
              const last: Date | undefined = item.lastAlive;
              const lastLabel: string = last
                ? `Last seen ${OneUptimeDate.fromNow(last)}`
                : "Never connected";
              if (status === RunbookAgentConnectionStatus.Connected) {
                return (
                  <span className="text-green-700">
                    Connected · {lastLabel}
                  </span>
                );
              }
              return (
                <span className="text-gray-500">
                  Disconnected · {lastLabel}
                </span>
              );
            },
          },
        ]}
      />

      {showSetupAgent ? (
        <Modal
          title="Runbook Agent setup"
          icon={IconProp.Terminal}
          iconType={IconType.Info}
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
          <RunbookAgentInstallInstructions
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

export default RunbookAgentsPage;
