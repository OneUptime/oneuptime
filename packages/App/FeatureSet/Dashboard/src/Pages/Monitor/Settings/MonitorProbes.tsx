import ProbeStatusElement from "../../../Components/Probe/ProbeStatus";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
import Probe from "Common/Models/DatabaseModels/Probe";
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
import PermissionGate from "Common/UI/Utils/PermissionGate";

const ProbePage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);

  const [currentProbe, setCurrentProbe] = useState<Probe | null>(null);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Probe>({ modelType: Probe });

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
   * viewer may not read), so only they get the action that shows it.
   */
  const canReadProbeKey: boolean = PermissionGate.canReadColumn(
    new Probe(),
    "key",
  );

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
              "Global Probes help you monitor external resources from different locations around the world.",
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
          query={{
            projectId: ProjectUtil.getCurrentProjectId()!,
          }}
          id="probes-table"
          userPreferencesKey={"probes-table"}
          name="Settings > Probes"
          saveFilterProps={{
            tableId: "settings-project-probes-table",
          }}
          isDeleteable={false}
          isEditable={false}
          isViewable={true}
          isCreateable={true}
          bulkActions={{
            buttons: [...labelBulkActions],
          }}
          cardProps={{
            title: "Custom Probes",
            description:
              "Custom Probes help you monitor internal resources that is behind your firewall.",
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
              title: "Enable monitoring automatically on new monitors",
              description:
                "When on, this probe is pre-selected for every new monitor you create.",
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
          actionButtons={
            canReadProbeKey
              ? [
                  {
                    title: "Show ID and Key",
                    icon: IconProp.Key,
                    buttonStyleType: ButtonStyleType.NORMAL,
                    // Reveals the probe's ID and secret key for copying - a utility, not the row's button.
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
                ]
              : []
          }
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
            {
              field: {
                shouldAutoEnableProbeOnNewMonitors: true,
              },
              title: "Enable Monitoring by Default",
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
              title: "Enable Monitoring by Default",
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
          ]}
        />

        {labelBulkActionModals}

        {showKeyModal && currentProbe ? (
          <ConfirmModal
            title={`Probe Key`}
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
