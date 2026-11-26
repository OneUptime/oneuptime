import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import CloudTagSetting from "Common/Models/DatabaseModels/CloudTagSetting";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ObjectID from "Common/Types/ObjectID";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelSwitchesCard from "Common/UI/Components/ModelSwitch/ModelSwitchesCard";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * HOW A PROJECT IS TOLD ABOUT A NEW RESOURCE WITHOUT A REQUIRED TAG
 * (#11012): its one settings row (CloudTagSetting), made with its defaults
 * the first time the page opens, as Data Observability's is. Its three
 * switches save when flipped; where an alert goes - its severity and the
 * on-call policies it pages - is edited on a card of its own.
 */

export const TAG_SETTINGS_TITLE: string = translationKey("Who Is Told");
export const TAG_SETTINGS_DESCRIPTION: string = translationKey(
  "When a resource is created without a required tag: who is told, how often, and whether an alert is raised.",
);
export const NOTIFY_PEOPLE_TITLE: string = translationKey(
  "Tell Who Created It and Its Owners",
);
export const NOTIFY_PEOPLE_ON: string = translationKey(
  "Who created it, from its account's change log, and its owners are emailed. With nobody to tell, the project's owners are.",
);
export const NOTIFY_PEOPLE_OFF: string = translationKey(
  "Nobody is emailed. New resources are still listed on this page.",
);
export const EMAIL_EACH_TITLE: string = translationKey(
  "One Email for Each Resource",
);
export const EMAIL_EACH_ON: string = translationKey(
  "Each new resource is emailed on its own, as soon as it is found.",
);
export const EMAIL_EACH_OFF: string = translationKey(
  "One email an hour lists everything new for each person.",
);
export const RAISE_ALERT_TITLE: string = translationKey("Raise an Alert");
export const RAISE_ALERT_ON: string = translationKey(
  "An alert is raised for each account new resources without required tags are found in.",
);
export const RAISE_ALERT_OFF: string = translationKey(
  "No alert is raised: people are only emailed.",
);
export const ALERT_ROUTING_TITLE: string = translationKey("Where Alerts Go");
export const ALERT_ROUTING_DESCRIPTION: string = translationKey(
  "The severity of the alerts raised for new resources without required tags, and the on-call policies they page.",
);

async function readSettingId(projectId: ObjectID): Promise<ObjectID | null> {
  const result: ListResult<CloudTagSetting> =
    await ModelAPI.getList<CloudTagSetting>({
      modelType: CloudTagSetting,
      query: { projectId },
      limit: 1,
      skip: 0,
      select: { _id: true },
      sort: {},
    });

  return result.data[0]?.id || null;
}

// The project's settings row: read, or made with its defaults.
export async function readOrMakeCloudTagSetting(
  projectId: ObjectID,
): Promise<ObjectID | null> {
  const id: ObjectID | null = await readSettingId(projectId);

  if (id) {
    return id;
  }

  const setting: CloudTagSetting = new CloudTagSetting();
  setting.projectId = projectId;

  try {
    await ModelAPI.create<CloudTagSetting>({
      model: setting,
      modelType: CloudTagSetting,
    });
  } catch {
    // Another tab made it first, or this person may only read: read below.
  }

  return await readSettingId(projectId);
}

export const CloudTagSettingsCards: FunctionComponent<{
  projectId: ObjectID;
}> = (props: { projectId: ObjectID }): ReactElement => {
  const [settingId, setSettingId] = useState<ObjectID | null>(null);

  useEffect(() => {
    let ignore: boolean = false;

    readOrMakeCloudTagSetting(props.projectId)
      .then((id: ObjectID | null): void => {
        if (!ignore) {
          setSettingId(id);
        }
      })
      .catch((): void => {
        // The rest of the page stands without these cards.
      });

    return (): void => {
      ignore = true;
    };
  }, [props.projectId.toString()]);

  if (!settingId) {
    return <></>;
  }

  return (
    <Fragment>
      <ModelSwitchesCard<CloudTagSetting>
        modelType={CloudTagSetting}
        modelId={settingId}
        cardTitle={TAG_SETTINGS_TITLE}
        cardDescription={TAG_SETTINGS_DESCRIPTION}
        switches={[
          {
            column: "notifyPeople",
            title: NOTIFY_PEOPLE_TITLE,
            getDescription: (isOn: boolean): string => {
              return isOn ? NOTIFY_PEOPLE_ON : NOTIFY_PEOPLE_OFF;
            },
            dataTestId: "cloud-tag-setting-notify-people",
          },
          {
            column: "emailEachResource",
            title: EMAIL_EACH_TITLE,
            getDescription: (isOn: boolean): string => {
              return isOn ? EMAIL_EACH_ON : EMAIL_EACH_OFF;
            },
            dataTestId: "cloud-tag-setting-email-each",
          },
          {
            column: "raiseAlert",
            title: RAISE_ALERT_TITLE,
            getDescription: (isOn: boolean): string => {
              return isOn ? RAISE_ALERT_ON : RAISE_ALERT_OFF;
            },
            dataTestId: "cloud-tag-setting-raise-alert",
          },
        ]}
        dataTestId="cloud-tag-settings"
      />
      <CardModelDetail<CloudTagSetting>
        name="cloud-tag-alert-routing"
        cardProps={{
          title: ALERT_ROUTING_TITLE,
          description: ALERT_ROUTING_DESCRIPTION,
        }}
        isEditable={true}
        formFields={[
          {
            field: { alertSeverity: true },
            title: "Alert Severity",
            description: "Empty: the project's least severe.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: AlertSeverity,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Least severe",
          },
          {
            field: { onCallDutyPolicies: true },
            title: "On-Call Policies",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: OnCallDutyPolicy,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Nobody is paged",
          },
        ]}
        modelDetailProps={{
          modelType: CloudTagSetting,
          id: "cloud-tag-alert-routing",
          modelId: settingId,
          fields: [
            {
              field: { alertSeverity: { name: true, color: true } },
              title: "Alert Severity",
              fieldType: FieldType.Entity,
              placeholder: "Least severe",
            },
            {
              field: { onCallDutyPolicies: { name: true, _id: true } },
              title: "On-Call Policies",
              fieldType: FieldType.EntityArray,
              placeholder: "Nobody is paged",
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default CloudTagSettingsCards;
