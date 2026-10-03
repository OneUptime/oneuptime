import LabelsElement from "Common/UI/Components/Label/Labels";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeOwnerTeam from "Common/Models/DatabaseModels/ProbeOwnerTeam";
import ProbeOwnerUser from "Common/Models/DatabaseModels/ProbeOwnerUser";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import ProbeStatusElement from "../../../Components/Probe/ProbeStatus";
import CustomProbeDocumentation from "../../../Components/Probe/CustomProbeDocumentation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

export enum PermissionType {
  AllowPermissions = "AllowPermissions",
  BlockPermissions = "BlockPermissions",
}

const ProbeView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());

  const [probeKey, setProbeKey] = useState<string | null>(null);

  return (
    <Fragment>
      {/* API Key View  */}
      <CardModelDetail<Probe>
        name="Probe Details"
        cardProps={{
          title: "Probe Details",
          description: "Here are more details for this probe.",
        }}
        isEditable={true}
        /*
         * Deliberately NOT a multi-step form. With steps, the modal's primary
         * button reads "Next" until the last step, so someone editing the name
         * or the auto-enable toggle sees only "Cancel" and "Next" and closes
         * the modal thinking there is nothing to save - and the edit is lost.
         * Five fields fit on one page with a real "Save Changes" button.
         */
        formSteps={[
          { title: "Basic Info", id: "basic-info" },
          { title: "More", id: "more" },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "basic-info",
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
            required: false,
            placeholder: "This probe is to monitor all the internal services.",
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
            title: "Enable monitoring automatically on new monitors",
            stepId: "more",
            description:
              "When on, this probe is pre-selected for every new monitor you create.",
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
        modelDetailProps={{
          onItemLoaded: (item: Probe) => {
            if (item.key) {
              setProbeKey(item.key);
            }
          },
          modelType: Probe,
          id: "model-detail-team",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Probe ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
            {
              field: {
                key: true,
              },
              title: "Probe Key",
              fieldType: FieldType.HiddenText,
            },
            {
              /*
               * The edit form sets this, so the card has to show it -
               * otherwise saving the toggle looks like it did nothing.
               */
              field: {
                shouldAutoEnableProbeOnNewMonitors: true,
              },
              title: "Enable Monitoring on New Monitors",
              description:
                "When on, this probe is pre-selected for every new monitor you create.",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: Probe): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<Probe>
        name="Probe Status"
        cardProps={{
          title: "Probe Status",
          description:
            "Here is more details on the connection status for this probe.",
        }}
        isEditable={false}
        modelDetailProps={{
          modelType: Probe,
          id: "model-detail-team",
          fields: [
            {
              field: {
                lastAlive: true,
              },
              title: "Last Ping Time",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                connectionStatus: true,
              },
              title: "Connection Status",
              fieldType: FieldType.Element,
              getElement: (item: Probe): ReactElement => {
                return <ProbeStatusElement probe={item} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {probeKey && (
        <CustomProbeDocumentation probeKey={probeKey} probeId={modelId} />
      )}

      {/*
       * Its owners, people and teams together, added and removed the way
       * the Owners pages and every owners field do.
       */}
      <OwnersCard<ProbeOwnerUser, ProbeOwnerTeam>
        resourceId={modelId}
        resourceIdField="probeId"
        resourceDisplayName="probe"
        ownerUserModelType={ProbeOwnerUser}
        ownerTeamModelType={ProbeOwnerTeam}
        description="People and teams who own this probe. They are alerted when its status changes."
        emptyDescription="Add a teammate or a team so they are alerted when this probe's status changes."
      />

      <ResetObjectID<Probe>
        modelType={Probe}
        onUpdateComplete={async () => {
          Navigation.reload();
        }}
        fieldName={"key"}
        title={"Reset Probe Key"}
        description={
          <p className="mt-2">
            {translator.translateText(
              "Resetting the secret key will generate a new key. Secret is used to authenticate probe requests.",
            )}
          </p>
        }
        modelId={modelId}
      />

      {/* Delete Probe */}
      <ModelDelete
        modelType={Probe}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITORS_SETTINGS_PROBES] as Route,
              { modelId },
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default ProbeView;
