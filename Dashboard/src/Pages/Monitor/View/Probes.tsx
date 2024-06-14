import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import ProbeStatusElement from "../../../Components/Probe/ProbeStatus";
import DashboardNavigation from "../../../Utils/Navigation";
import ProbeUtil from "../../../Utils/Probe";
import PageComponentProps from "../../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "CommonUI/src/Components/Button/Button";
import ComponentLoader from "CommonUI/src/Components/ComponentLoader/ComponentLoader";
import EmptyState from "CommonUI/src/Components/EmptyState/EmptyState";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import Modal, { ModalWidth } from "CommonUI/src/Components/Modal/Modal";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import ProbeElement from "CommonUI/src/Components/Probe/Probe";
import SimpleLogViewer from "CommonUI/src/Components/SimpleLogViewer/SimpleLogViewer";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import { GetReactElementFunction } from "CommonUI/src/Types/FunctionTypes";
import API from "CommonUI/src/Utils/API/API";
import ModelAPI from "CommonUI/src/Utils/ModelAPI/ModelAPI";
import Navigation from "CommonUI/src/Utils/Navigation";
import Monitor from "Model/Models/Monitor";
import MonitorProbe from "Model/Models/MonitorProbe";
import Probe from "Model/Models/Probe";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";

const MonitorProbes: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
  const [logs, setLogs] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [error, setError] = useState<string>("");

  const [probes, setProbes] = useState<Array<Probe>>([]);

  const fetchItem: PromiseVoidFunction = async (): Promise<void> => {
    // get item.
    setIsLoading(true);

    setError("");
    try {
      const item: Monitor | null = await ModelAPI.getItem({
        modelType: Monitor,
        id: modelId,
        select: {
          monitorType: true,
        },
      });

      if (!item) {
        setError(`Monitor not found`);

        return;
      }

      const probes: Array<Probe> = await ProbeUtil.getAllProbes();

      setProbes(probes);
      setMonitorType(item.monitorType);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  const [monitorType, setMonitorType] = useState<MonitorType | undefined>(
    undefined,
  );

  useAsyncEffect(async () => {
    // fetch the model
    await fetchItem();
  }, []);

  const getPageContent: GetReactElementFunction = (): ReactElement => {
    if (!monitorType || isLoading) {
      return <ComponentLoader />;
    }

    if (error) {
      return <ErrorMessage error={error} />;
    }

    if (monitorType === MonitorType.Manual) {
      return (
        <EmptyState
          id="monitoring-probes-empty-state"
          icon={IconProp.Signal}
          title={"No Monitoring Probes for Manual Monitors"}
          description={
            <>
              This is a manual monitor. It does not monitor anything and so, it
              cannot have monitoring probes set. You can have monitoring probes
              on other monitor types.{" "}
            </>
          }
        />
      );
    }

    return (
      <ModelTable<MonitorProbe>
        modelType={MonitorProbe}
        query={{
          projectId: DashboardNavigation.getProjectId()?.toString(),
          monitorId: modelId.toString(),
        }}
        onBeforeCreate={(item: MonitorProbe): Promise<MonitorProbe> => {
          item.monitorId = modelId;
          item.projectId = DashboardNavigation.getProjectId()!;

          return Promise.resolve(item);
        }}
        id="probes-table"
        name="Monitor > Monitor Probes"
        isDeleteable={false}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Probes",
          description: "List of probes that help you monitor this resource.",
        }}
        noItemsMessage={
          "No probes found for this resource. However, you can add some probes to monitor this resource."
        }
        viewPageRoute={Navigation.getCurrentRoute()}
        selectMoreFields={{
          lastMonitoringLog: true,
        }}
        actionButtons={[
          {
            title: "View Logs",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (
              item: MonitorProbe,
              onCompleteAction: VoidFunction,
            ) => {
              setLogs(
                item["lastMonitoringLog"]
                  ? JSON.stringify(item["lastMonitoringLog"], null, 2)
                  : "Not monitored yet",
              );
              setShowViewLogsModal(true);

              onCompleteAction();
            },
          },
        ]}
        formFields={[
          {
            field: {
              probe: true,
            },
            title: "Probe",
            stepId: "incident-details",
            description: "Which probe do you want to use?",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: probes.map((probe: Probe) => {
              if (!probe.name || !probe._id) {
                throw new BadDataException(`Probe name or id is missing`);
              }

              return {
                label: probe.name,
                value: probe._id,
              };
            }),
            required: true,
            placeholder: "Probe",
          },

          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: {
              probe: {
                name: true,
              },
            },
            type: FieldType.Text,
            title: "Probe Name",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: {
              probe: {
                name: true,
                iconFileId: true,
              },
            },

            title: "Probe",
            type: FieldType.Entity,
            getElement: (item: MonitorProbe): ReactElement => {
              return <ProbeElement probe={item["probe"]} />;
            },
          },
          {
            field: {
              probe: {
                lastAlive: true,
              },
            },
            title: "Probe Status",
            type: FieldType.Text,

            getElement: (item: MonitorProbe): ReactElement => {
              return <ProbeStatusElement probe={item["probe"]!} />;
            },
          },
          {
            field: {
              lastPingAt: true,
            },
            title: "Last Monitored At",
            type: FieldType.DateTime,

            noValueMessage: "Will be picked up by this probe soon.",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
      />
    );
  };

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      {getPageContent()}
      {showViewLogsModal && (
        <Modal
          title={"Monitoring Logs"}
          description="Here are the latest monitoring log for this resource."
          isLoading={false}
          modalWidth={ModalWidth.Large}
          onSubmit={() => {
            setShowViewLogsModal(false);
          }}
          submitButtonText={"Close"}
          submitButtonStyleType={ButtonStyleType.NORMAL}
        >
          <SimpleLogViewer>
            {logs.split("\n").map((log: string, i: number) => {
              return <div key={i}>{log}</div>;
            })}
          </SimpleLogViewer>
        </Modal>
      )}
    </Fragment>
  );
};

export default MonitorProbes;
