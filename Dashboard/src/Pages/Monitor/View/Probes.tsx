import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import ProbeStatusElement from "../../../Components/Probe/ProbeStatus";
import ProbeUtil from "../../../Utils/Probe";
import PageComponentProps from "../../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import FieldType from "Common/UI/Components/Types/FieldType";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useAsyncEffect from "use-async-effect";
import SummaryInfo from "../../../Components/Monitor/SummaryView/SummaryInfo";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";

const MonitorProbes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
  const [logs, setLogs] = useState<Array<ProbeMonitorResponse>>([]);
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
        setError(ExceptionMessages.MonitorNotFound);

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
      return <ErrorMessage message={error} />;
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
          projectId: ProjectUtil.getCurrentProjectId()!,
          monitorId: modelId.toString(),
        }}
        onBeforeCreate={(item: MonitorProbe): Promise<MonitorProbe> => {
          item.monitorId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;

          return Promise.resolve(item);
        }}
        userPreferencesKey="monitor-probes-table"
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
            title: "View Summary",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.List,
            onClick: async (
              item: MonitorProbe,
              onCompleteAction: VoidFunction,
            ) => {
              setLogs(
                item["lastMonitoringLog"] &&
                  Object.keys(item["lastMonitoringLog"]).length > 0
                  ? (Object.values(
                      item["lastMonitoringLog"],
                    ) as Array<ProbeMonitorResponse>)
                  : [],
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
                connectionStatus: true,
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
          title={"Monitoring Summary"}
          description="Here are the latest monitoring summary for this resource."
          isLoading={false}
          modalWidth={ModalWidth.Large}
          onSubmit={() => {
            setShowViewLogsModal(false);
          }}
          submitButtonText={"Close"}
          submitButtonStyleType={ButtonStyleType.NORMAL}
        >
          <SummaryInfo
            monitorType={monitorType!}
            probeMonitorResponses={logs}
          />
        </Modal>
      )}
    </Fragment>
  );
};

export default MonitorProbes;
