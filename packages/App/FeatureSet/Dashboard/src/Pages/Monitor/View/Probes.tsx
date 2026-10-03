import DisabledWarning from "../../../Components/Monitor/DisabledWarning";
import MonitoringIntervalCard from "../../../Components/Monitor/MonitoringIntervalCard";
import ProbeAgreementCard from "../../../Components/Monitor/ProbeAgreementCard";
import ProbesAndIntervalCopy, {
  NOT_CHECKED_BY_PROBES_TEST_ID,
} from "../../../Components/Monitor/ProbesAndIntervalCopy";
import ProbeStatusElement from "../../../Components/Probe/ProbeStatus";
import ProbeUtil from "../../../Utils/Probe";
import PageComponentProps from "../../PageComponentProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
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

/*
 * A monitor's Probes & Interval page: how often it is checked, which probes
 * check it, and how many of them must agree before its status changes, in
 * that order - what Create Monitor asks on its "Probes & Interval" step, and
 * the agreement that counts those probes right under them. The interval had
 * a page of its own and the agreement a card on Settings; their old URL
 * forwards here (see ProbesAndIntervalCopy).
 *
 * Only a monitor that probes check (MonitorTypeHelper.isProbableMonitor) has
 * this page in its menu. Any other one, reached by its URL, is told why it
 * has neither.
 */
const MonitorProbes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [showViewLogsModal, setShowViewLogsModal] = useState<boolean>(false);
  const [logs, setLogs] = useState<Array<ProbeMonitorResponse>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [error, setError] = useState<string>("");

  const [probes, setProbes] = useState<Array<Probe>>([]);

  const [monitor, setMonitor] = useState<Monitor | null>(null);

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
          monitoringInterval: true,
          minimumProbeAgreement: true,
        },
      });

      if (!item) {
        setError(ExceptionMessages.MonitorNotFound);
        setIsLoading(false);
        return;
      }

      const probes: Array<Probe> = await ProbeUtil.getAllProbes();

      setProbes(probes);
      setMonitor(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  const monitorType: MonitorType | undefined = monitor?.monitorType;

  useAsyncEffect(async () => {
    // fetch the model
    await fetchItem();
  }, []);

  const getProbesTable: GetReactElementFunction = (): ReactElement => {
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
        saveFilterProps={{
          tableId: "monitor-view-probes-table",
        }}
        /*
         * Which probe a row points at is fixed once the row exists
         * (MonitorProbe.probe/probeId are create-only), so removing the row is
         * the only way to undo attaching the wrong probe. Without this the
         * table could add probes and never take one away.
         */
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Probes",
          description:
            "List of probes that help you monitor this resource. Only these probes monitor it - adding one here is what puts a probe to work on this resource.",
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
            description: "Which probe do you want to use?",
            /*
             * MonitorProbe.probe is create-only, so ModelForm drops this field
             * from an Update form - and from the request - with no error. The
             * modal used to render a "Save Changes" button over a Probe
             * dropdown that was silently missing, so a user who came here to
             * change which probe watches the resource found no control and no
             * explanation. Say so up front instead: to point a row at a
             * different probe, delete it and add the right one.
             */
            doNotShowWhenEditing: true,
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
            description:
              "When off, this probe stops monitoring this resource. It stays on the list so you can turn it back on.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            /*
             * Adding a probe is what puts it to work, so a new one starts on
             * (as the API's MonitorProbe.isEnabled does) and Add Probe asks
             * only which probe. Switching one off is an edit.
             */
            doNotShowWhenCreating: true,
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

  const getPageContent: GetReactElementFunction = (): ReactElement => {
    /*
     * The error first: a monitor that could not be read has no type, and
     * waiting for one kept the loader up for good.
     */
    if (error) {
      return <ErrorMessage message={error} />;
    }

    if (isLoading || !monitor || !monitorType) {
      return <ComponentLoader />;
    }

    if (!MonitorTypeHelper.isProbableMonitor(monitorType)) {
      const isManual: boolean = MonitorTypeHelper.isManualMonitor(monitorType);

      return (
        <EmptyState
          id={NOT_CHECKED_BY_PROBES_TEST_ID}
          icon={IconProp.Signal}
          title={
            isManual
              ? ProbesAndIntervalCopy.manualMonitorTitle
              : ProbesAndIntervalCopy.notCheckedByProbesTitle
          }
          description={
            isManual
              ? ProbesAndIntervalCopy.manualMonitorDescription
              : ProbesAndIntervalCopy.notCheckedByProbesDescription
          }
        />
      );
    }

    return (
      <Fragment>
        <MonitoringIntervalCard
          monitorId={modelId}
          monitorType={monitorType}
          initialInterval={monitor.monitoringInterval}
        />

        {getProbesTable()}

        <ProbeAgreementCard
          monitorId={modelId}
          initialValue={monitor.minimumProbeAgreement}
        />
      </Fragment>
    );
  };

  return (
    <Fragment>
      <DisabledWarning monitorId={modelId} />
      {getPageContent()}
      {showViewLogsModal && monitorType && (
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
          <SummaryInfo monitorType={monitorType} probeMonitorResponses={logs} />
        </Modal>
      )}
    </Fragment>
  );
};

export default MonitorProbes;
