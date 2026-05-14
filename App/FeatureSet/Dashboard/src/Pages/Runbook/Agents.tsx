import RunbookAgentInstallInstructions from "../../Components/RunbookAgent/InstallInstructions";
import PageComponentProps from "../PageComponentProps";
import ProjectUtil from "Common/UI/Utils/Project";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
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

const PLACEHOLDER_TAGS: string = "prod, eu-west-1";

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
            "Self-hosted agents that execute Bash runbook steps in your own infrastructure. Each Bash step targets agents by tag.",
        }}
        selectMoreFields={{
          _id: true,
          key: true,
          tags: true,
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
            field: { tags: true },
            title: "Tags",
            description:
              "Comma-separated tags. Bash steps target a tag; any healthy agent with that tag may run them.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: PLACEHOLDER_TAGS,
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
            field: { tags: true },
            title: "Tags",
            type: FieldType.Element,
            getElement: (item: RunbookAgent): ReactElement => {
              const raw: unknown = item["tags"];
              const list: Array<string> = Array.isArray(raw)
                ? raw
                    .filter((t: unknown): t is string => {
                      return typeof t === "string" && t.length > 0;
                    })
                    .map((t: string) => {
                      return t;
                    })
                : [];
              if (list.length === 0) {
                return <span className="text-gray-400">none</span>;
              }
              return (
                <div className="flex flex-wrap gap-1">
                  {list.map((tag: string, idx: number) => {
                    return (
                      <span
                        key={idx}
                        className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800"
                      >
                        {tag}
                      </span>
                    );
                  })}
                </div>
              );
            },
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
        <ConfirmModal
          title="Runbook Agent setup"
          description={
            <div>
              <RunbookAgentInstallInstructions
                agentId={new ObjectID(showSetupAgent._id!.toString())}
                agentKey={(showSetupAgent.key as string) || ""}
              />
            </div>
          }
          submitButtonText="Done"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={async () => {
            setShowSetupAgent(null);
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default RunbookAgentsPage;
