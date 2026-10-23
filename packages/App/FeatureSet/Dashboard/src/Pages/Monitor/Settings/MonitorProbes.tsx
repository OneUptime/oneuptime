import ProbeStatusElement from "../../../Components/Probe/ProbeStatus";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import RecordIdModal from "Common/UI/Components/ObjectID/RecordIdModal";
import { getApiReferencePagePath } from "Common/Utils/ApiReferencePage";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeOwnerTeam from "Common/Models/DatabaseModels/ProbeOwnerTeam";
import ProbeOwnerUser from "Common/Models/DatabaseModels/ProbeOwnerUser";
import OwnersCell from "../../../Components/ResourceOwners/OwnersCell";
import useResourceOwners from "../../../Components/ResourceOwners/useResourceOwners";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import LabelsElement from "Common/UI/Components/Label/Labels";
import GlobalProbesOnNewMonitorsCard from "../../../Components/Probe/GlobalProbesOnNewMonitorsCard";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import {
  getMonitorThisProbeRoute,
  MONITOR_THIS_PROBE_ICON,
  MONITOR_THIS_PROBE_TITLE,
} from "../../../Utils/MonitorThisProbe";
import { PROBE_ON_NEW_MONITORS_COPY } from "../../../Components/Probe/ProbeOnNewMonitorsCopy";

const ProbePage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);

  const [currentProbe, setCurrentProbe] = useState<Probe | null>(null);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Probe>({ modelType: Probe });

  // Owners in Bulk Actions too: the list shows and filters probes by them.
  const { bulkActions: ownerBulkActions, modals: ownerBulkActionModals } =
    useBulkOwnerActions<Probe>({
      ownerUserModelType: ProbeOwnerUser,
      ownerTeamModelType: ProbeOwnerTeam,
      resourceIdField: "probeId",
    });

  /*
   * The Owner and Labels chips above the custom probes: a probe can be found
   * by the person or the team that owns it - the server answers the Owner
   * chip in the list's own query - and the Owners column shows who that is.
   * The global probes above are OneUptime's, owned by nobody in a project.
   */
  const {
    getOwnersForResource,
    isLoadingOwners,
    onResourcesFetched,
    filterBar,
    emptyState: facetEmptyState,
    mergeFiltersIntoQuery,
    facetSaveState,
    restoreFacetState,
  } = useResourceOwners<Probe>({
    persistKey: "settings-project-probes-table",
    ownerUserModelType: ProbeOwnerUser,
    ownerTeamModelType: ProbeOwnerTeam,
    resourceIdField: "probeId",
    showLabelsFacet: true,
  });

  /*
   * Create Probe asks for a name and a description, and folds the rest
   * under Advanced: the logo, whether new monitors use the probe by
   * default, and the labels. Three rows, so no steps - the "More" step
   * held only the switch and the labels.
   */
  const advancedSection: FormFieldCollapsibleSection<Probe> =
    getAdvancedFormSection<Probe>();

  /*
   * A probe's key is read by project owners and admins alone (Probe.key).
   * The table asks for it only for them (BaseModelTable leaves out what the
   * viewer may not read); everyone who sees the table gets the probe's ID,
   * which installing a probe needs too, and the key only those who may read
   * it.
   */
  const canReadProbeKey: boolean = PermissionGate.canReadColumn(
    new Probe(),
    "key",
  );

  /*
   * "Monitor this probe": Create Monitor on a Probe Status monitor that
   * opens an incident when this probe disconnects. In both tables, in the
   * row's menu: the global probes are the ones a self-hosted installation
   * runs every monitor on. Locked, with the reason, for whoever may not
   * create monitors; left out when there is no honest reason to give.
   */
  const createMonitorGate: PermissionGateResult = PermissionGate.check(
    new Monitor(),
    ModelAction.Create,
  );

  const monitorThisProbeAction: ActionButtonSchema<Probe> = {
    title: MONITOR_THIS_PROBE_TITLE,
    icon: MONITOR_THIS_PROBE_ICON,
    buttonStyleType: ButtonStyleType.NORMAL,
    placement: ActionButtonPlacement.MoreMenu,
    isVisible: (): boolean => {
      return (
        createMonitorGate.isAllowed || Boolean(createMonitorGate.disabledReason)
      );
    },
    disabled: !createMonitorGate.isAllowed,
    tooltip: createMonitorGate.isAllowed
      ? undefined
      : createMonitorGate.disabledReason,
    onClick: async (
      item: Probe,
      onCompleteAction: VoidFunction,
      onError: ErrorFunction,
    ) => {
      try {
        onCompleteAction();
        Navigation.navigate(
          getMonitorThisProbeRoute(item._id?.toString() || ""),
        );
      } catch (err) {
        onCompleteAction();
        onError(err as Error);
      }
    },
  };

  return (
    <Fragment>
      <>
        <ModelTable<Probe>
          modelType={Probe}
          id="probes-table"
          name="Settings > Global Probes"
          userPreferencesKey={"admin-probes-table"}
          saveFilterProps={{
            tableId: "settings-global-probes-table",
          }}
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          cardProps={{
            title: "Global Probes",
            description:
              "OneUptime's probes around the world. They check what is reachable from the internet.",
          }}
          fetchRequestOptions={{
            overrideRequestUrl: URL.fromString(APP_API_URL.toString()).addRoute(
              "/probe/global-probes",
            ),
          }}
          noItemsMessage={"No probes found."}
          showRefreshButton={true}
          searchableFields={["name", "description"]}
          selectMoreFields={{
            // The Name cell renders the probe logo, which no column declares.
            iconFileId: true,
          }}
          actionButtons={[monitorThisProbeAction]}
          filters={[
            {
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              type: FieldType.Text,
            },
          ]}
          columns={[
            {
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Text,

              getElement: (item: Probe): ReactElement => {
                return <ProbeElement probe={item} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              type: FieldType.Text,
            },
            {
              field: {
                connectionStatus: true,
              },
              title: "Probe Status",
              type: FieldType.Text,

              getElement: (item: Probe): ReactElement => {
                return <ProbeStatusElement probe={item} />;
              },
            },
          ]}
        />

        <ModelTable<Probe>
          /*
           * Listed again when whether keys may be read changes: the
           * permission snapshot can land after the first paint.
           */
          key={canReadProbeKey ? "probes-with-keys" : "probes"}
          modelType={Probe}
          topContent={filterBar}
          emptyState={facetEmptyState}
          currentFacetState={facetSaveState}
          onFacetStateRestored={restoreFacetState}
          query={mergeFiltersIntoQuery({
            projectId: ProjectUtil.getCurrentProjectId()!,
          })}
          onFetchSuccess={(data: Array<Probe>) => {
            onResourcesFetched(data);
          }}
          id="probes-table"
          userPreferencesKey={"probes-table"}
          name="Settings > Probes"
          saveFilterProps={{
            tableId: "settings-project-probes-table",
          }}
          isDeleteable={true}
          isEditable={false}
          isViewable={true}
          isCreateable={true}
          bulkActions={{
            buttons: [...labelBulkActions, ...ownerBulkActions],
          }}
          cardProps={{
            title: "Custom Probes",
            description:
              "Probes you install in your own network, to check what is behind your firewall.",
          }}
          documentationLink={Route.fromString("/docs/probe/custom-probe")}
          selectMoreFields={{
            key: true,
            iconFileId: true,
          }}
          noItemsMessage={"No probes found."}
          viewPageRoute={Navigation.getCurrentRoute()}
          formFields={[
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
              placeholder: "internal-probe",
              validation: {
                minLength: 2,
              },
            },

            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FormFieldSchemaType.LongText,
              required: true,
              placeholder:
                "This probe is to monitor all the internal services.",
            },

            {
              field: {
                iconFile: true,
              },
              title: "Probe Logo",
              fieldType: FormFieldSchemaType.ImageFile,
              required: false,
              placeholder: "Upload logo",
              collapsibleSection: advancedSection,
            },
            {
              field: {
                shouldAutoEnableProbeOnNewMonitors: true,
              },
              title: PROBE_ON_NEW_MONITORS_COPY.switchTitle,
              description: PROBE_ON_NEW_MONITORS_COPY.description,
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
              collapsibleSection: advancedSection,
            },
            getLabelsFormField<Probe>({
              collapsibleSection: advancedSection,
            }),
          ]}
          showRefreshButton={true}
          searchableFields={["name", "description"]}
          actionButtons={[
            monitorThisProbeAction,
            {
              title: canReadProbeKey ? "Show ID and Key" : "Show ID",
              icon: canReadProbeKey ? IconProp.Key : IconProp.Identification,
              buttonStyleType: ButtonStyleType.NORMAL,
              // Reveals the probe's ID (and its key, to who may read it) for copying - a utility, not the row's button.
              placement: ActionButtonPlacement.MoreMenu,
              onClick: async (
                item: Probe,
                onCompleteAction: VoidFunction,
                onError: ErrorFunction,
              ) => {
                try {
                  setCurrentProbe(item);
                  setShowKeyModal(true);

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
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              type: FieldType.Text,
            },
            {
              field: {
                shouldAutoEnableProbeOnNewMonitors: true,
              },
              title: PROBE_ON_NEW_MONITORS_COPY.columnTitle,
              type: FieldType.Boolean,
            },
          ]}
          columns={[
            {
              field: {
                name: true,
              },
              title: "Name",
              type: FieldType.Text,

              getElement: (item: Probe): ReactElement => {
                return <ProbeElement probe={item} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              type: FieldType.Text,
            },
            {
              field: {
                shouldAutoEnableProbeOnNewMonitors: true,
              },
              title: PROBE_ON_NEW_MONITORS_COPY.columnTitle,
              type: FieldType.Boolean,
            },
            {
              field: {
                connectionStatus: true,
              },
              title: "Status",
              type: FieldType.Element,

              getElement: (item: Probe): ReactElement => {
                return <ProbeStatusElement probe={item} />;
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

              getElement: (item: Probe): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                _id: true,
              },
              title: "Owners",
              type: FieldType.Element,
              hideOnMobile: true,
              getElement: (item: Probe): ReactElement => {
                return (
                  <OwnersCell
                    owners={getOwnersForResource(item)}
                    isLoading={isLoadingOwners}
                  />
                );
              },
            },
          ]}
        />

        {labelBulkActionModals}
        {ownerBulkActionModals}

        {showKeyModal && currentProbe && canReadProbeKey ? (
          <ConfirmModal
            title="Probe Key"
            description={
              <div>
                <span>
                  {translator.translateText(
                    "Your probe connects to OneUptime with this ID and key. Keep the key secret.",
                  )}
                </span>
                <br />
                <br />
                <span>
                  <b>{translator.translateText("Probe ID:")} </b>{" "}
                  {currentProbe["_id"]?.toString()}
                </span>
                <br />
                <br />
                <span>
                  <b>{translator.translateText("Probe Key:")} </b>{" "}
                  {currentProbe["key"]?.toString()}
                </span>
              </div>
            }
            submitButtonText={"Close"}
            submitButtonType={ButtonStyleType.NORMAL}
            onSubmit={async () => {
              setShowKeyModal(false);
            }}
          />
        ) : (
          <></>
        )}

        {/*
         * Everyone else who sees the table gets the probe's ID - installing a
         * probe needs it as well as the key - in the shared Show ID dialog.
         */}
        {showKeyModal && currentProbe && !canReadProbeKey ? (
          <RecordIdModal
            recordId={currentProbe["_id"]}
            itemName="Probe"
            apiReferencePagePath={getApiReferencePagePath(new Probe(), {
              isBillingEnabled: BILLING_ENABLED,
            })}
            onClose={() => {
              setShowKeyModal(false);
            }}
          />
        ) : (
          <></>
        )}
      </>

      {/*
       * Whether a new monitor starts with OneUptime's global probes: one
       * switch that saves when it is flipped.
       */}
      <GlobalProbesOnNewMonitorsCard
        projectId={ProjectUtil.getCurrentProjectId()!}
      />
    </Fragment>
  );
};

export default ProbePage;
