import LabelsElement from "Common/UI/Components/Label/Labels";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
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
import getLabelsFormField from "../../../Utils/Form/LabelsFormField";
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
import ProbePacketCaptures from "../../../Components/PacketCapture/ProbePacketCaptures";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import {
  getMonitorThisProbeRoute,
  MONITOR_THIS_PROBE_ICON,
  MONITOR_THIS_PROBE_TITLE,
} from "../../../Utils/MonitorThisProbe";
import { PROBE_ON_NEW_MONITORS_COPY } from "../../../Components/Probe/ProbeOnNewMonitorsCopy";

export enum PermissionType {
  AllowPermissions = "AllowPermissions",
  BlockPermissions = "BlockPermissions",
}

const advancedSection: FormFieldCollapsibleSection<Probe> =
  getAdvancedFormSection<Probe>();

const ProbeView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());

  const [probeKey, setProbeKey] = useState<string | null>(null);

  /*
   * Beside the probe's status: the way to be told, once, when it goes
   * offline - a Probe Status monitor watching this probe.
   */
  const monitorThisProbeButton: CardButtonSchema | null =
    PermissionGate.gateCardButton(
      {
        title: MONITOR_THIS_PROBE_TITLE,
        icon: MONITOR_THIS_PROBE_ICON,
        buttonStyle: ButtonStyleType.NORMAL,
        onClick: () => {
          Navigation.navigate(getMonitorThisProbeRoute(modelId.toString()));
        },
      },
      new Monitor(),
      ModelAction.Create,
    );

  return (
    <Fragment>
      {/* API Key View  */}
      <CardModelDetail<Probe>
        name="Probe Details"
        cardProps={{
          title: "Probe Details",
        }}
        isEditable={true}
        /*
         * One page, with a real "Save Changes" button: the name and the
         * description, and Advanced folding the logo, the auto-enable switch
         * and the labels (it says "Configured" when any is set). It was
         * meant to be a one-page form long before stepped edit dialogs
         * could save from any step, and the "More" step held only the
         * switch and the labels.
         */
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
            required: false,
            placeholder: "This probe is to monitor all the internal services.",
          },

          {
            field: {
              iconFile: true,
            },
            title: "Probe Logo",
            fieldType: FormFieldSchemaType.ImageFile,
            required: false,
            placeholder: "Upload logo",
            // The column's description only said "Probe Icon".
            hideColumnDescription: true,
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
              /*
               * A custom probe is installed with its ID and its key
               * (PROBE_ID, PROBE_KEY), so the ID stays a field, read beside
               * the key, rather than going to the card's ID line.
               */
              showIdAsField: true,
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
              title: PROBE_ON_NEW_MONITORS_COPY.columnTitle,
              description: PROBE_ON_NEW_MONITORS_COPY.description,
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
          // The title says it all; the button is how to be told it went down.
          title: "Probe Status",
          buttons: monitorThisProbeButton ? [monitorThisProbeButton] : [],
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

      {/*
       * Captures of the traffic this probe sees, started here and downloaded
       * for Wireshark - once whoever runs the probe has turned them on.
       */}
      <ProbePacketCaptures probeId={modelId} />

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
          // A span: the card draws its description in a <p>.
          <span>
            {translator.translateText(
              "The old key stops working at once. Set the new one as PROBE_KEY and restart the probe.",
            )}
          </span>
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
