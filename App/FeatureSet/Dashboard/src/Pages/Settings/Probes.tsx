import ProbeStatusElement from "../../Components/Probe/ProbeStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ProbeElement from "Common/UI/Components/Probe/Probe";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
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

const ProbePage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);

  const [currentProbe, setCurrentProbe] = useState<Probe | null>(null);

  return (
    <Fragment>
      <>
        <ModelTable<Probe>
          modelType={Probe}
          id="probes-table"
          name="Settings > Global Probes"
          userPreferencesKey={"admin-probes-table"}
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
          isDeleteable={false}
          isEditable={false}
          isViewable={true}
          isCreateable={true}
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
          formSteps={[
            {
              title: "Basic Info",
              id: "basic-info",
            },
            {
              title: "More",
              id: "more",
            },
          ]}
          formFields={[
            {
              field: {
                name: true,
              },
              stepId: "basic-info",
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
              stepId: "basic-info",
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
              stepId: "basic-info",
              fieldType: FormFieldSchemaType.ImageFile,
              required: false,
              placeholder: "Upload logo",
            },
            {
              field: {
                shouldAutoEnableProbeOnNewMonitors: true,
              },
              stepId: "more",
              title: "Enable monitoring automatically on new monitors",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
            },
            {
              field: {
                labels: true,
              },

              title: "Labels ",
              stepId: "more",
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
          showRefreshButton={true}
          actionButtons={[
            {
              title: "Show ID and Key",
              buttonStyleType: ButtonStyleType.NORMAL,
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

        {showKeyModal && currentProbe ? (
          <ConfirmModal
            title={`Probe Key`}
            description={
              <div>
                <span>Here is your probe key. Please keep this a secret.</span>
                <br />
                <br />
                <span>
                  <b>Probe ID: </b> {currentProbe["_id"]?.toString()}
                </span>
                <br />
                <br />
                <span>
                  <b>Probe Key: </b> {currentProbe["key"]?.toString()}
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
                    Global probes disabled for new monitors. New monitors will
                    not have Global Probes assigned by default.
                  </span>
                ) : (
                  <span>
                    Global probes enabled for new monitors. New monitors will
                    have Global Probes assigned by default.
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
