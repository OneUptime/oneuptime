import ProbeStatusElement from "../../Components/Probe/ProbeStatus";
import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import Banner from "Common/UI/src/Components/Banner/Banner";
import { ButtonStyleType } from "Common/UI/src/Components/Button/Button";
import FormFieldSchemaType from "Common/UI/src/Components/Forms/Types/FormFieldSchemaType";
import ConfirmModal from "Common/UI/src/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/src/Components/ModelTable/ModelTable";
import ProbeElement from "Common/UI/src/Components/Probe/Probe";
import FieldType from "Common/UI/src/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/src/Config";
import Navigation from "Common/UI/src/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Probe from "Common/Models/DatabaseModels/Probe";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import LabelsElement from "../../Components/Label/Labels";

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

        <Banner
          openInNewTab={true}
          title="Need help with setting up Custom Probes?"
          description="Here is a guide which will help you get set up"
          link={Route.fromString("/docs/probe/custom-probe")}
        />

        <ModelTable<Probe>
          modelType={Probe}
          query={{
            projectId: DashboardNavigation.getProjectId()?.toString(),
          }}
          id="probes-table"
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
                projectId: DashboardNavigation.getProjectId()?.toString(),
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
    </Fragment>
  );
};

export default ProbePage;
