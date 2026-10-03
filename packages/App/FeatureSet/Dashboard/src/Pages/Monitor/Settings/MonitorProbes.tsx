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
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Project from "Common/Models/DatabaseModels/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

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
          actionButtons={[
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
                    "Here is your probe key. Please keep this a secret.",
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

      <CardModelDetail
        name="Global Probe Settings"
        cardProps={{
          title: "Global Probe Settings",
          description:
            "Configure settings related to the automatic addition of Global Probes to new monitors.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              doNotAddGlobalProbesByDefaultOnNewMonitors: true,
            },
            title: "Disable Global Probes on New Monitors",
            description:
              "Toggle to enable or disable the automatic addition of Global Probes to new monitors.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "global-probe-auto-add",
          fields: [
            {
              field: {
                doNotAddGlobalProbesByDefaultOnNewMonitors: true,
              },
              fieldType: FieldType.Boolean,
              title: "Global Probes on New Monitors",
              description:
                "Toggle to enable or disable the automatic addition of Global Probes to new monitors.",
              placeholder: "New Monitors will have Global Probes by default",
              getElement: (item: Project): ReactElement => {
                return item.doNotAddGlobalProbesByDefaultOnNewMonitors ? (
                  <span>
                    {translator.translateText(
                      "Global probes disabled for new monitors. New monitors will not have Global Probes assigned by default.",
                    )}
                  </span>
                ) : (
                  <span>
                    {translator.translateText(
                      "Global probes enabled for new monitors. New monitors will have Global Probes assigned by default.",
                    )}
                  </span>
                );
              },
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
    </Fragment>
  );
};

export default ProbePage;
