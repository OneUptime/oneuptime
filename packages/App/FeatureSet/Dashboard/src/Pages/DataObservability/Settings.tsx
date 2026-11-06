import PageComponentProps from "../PageComponentProps";
import DataObservabilitySetting from "Common/Models/DatabaseModels/DataObservabilitySetting";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * How Data Observability treats this project's databases. A project has one
 * settings row, made with every default the first time anything asks for it:
 * the page may be opened before any collection ran, so it does the same.
 * Failing rows are kept only once someone here turns that on, on OneUptime
 * Cloud as on a self-hosted install, and turning it off deletes them.
 */
async function readSettingId(projectId: ObjectID): Promise<ObjectID | null> {
  const result: ListResult<DataObservabilitySetting> =
    await ModelAPI.getList<DataObservabilitySetting>({
      modelType: DataObservabilitySetting,
      query: { projectId },
      limit: 1,
      skip: 0,
      select: { _id: true },
      sort: {},
    });

  return result.data[0]?.id || null;
}

const DataObservabilitySettingsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [settingId, setSettingId] = useState<ObjectID | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        return;
      }

      try {
        let id: ObjectID | null = await readSettingId(projectId);

        if (!id) {
          const setting: DataObservabilitySetting =
            new DataObservabilitySetting();

          setting.projectId = projectId;

          try {
            await ModelAPI.create<DataObservabilitySetting>({
              model: setting,
              modelType: DataObservabilitySetting,
            });
          } catch {
            // Another tab made it first, or this person may only read: read below.
          }

          id = await readSettingId(projectId);
        }

        setSettingId(id);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    };

    load().catch(() => {
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!settingId) {
    return (
      <ErrorMessage message="These settings have not been made yet. Someone who may edit Data Observability needs to open this page first." />
    );
  }

  return (
    <CardModelDetail<DataObservabilitySetting>
      name="data-observability-settings"
      cardProps={{
        title: "Checks",
        description:
          "What a check may cost a database. Table health reads only the catalog, so these never apply to it.",
      }}
      isEditable={true}
      formFields={[
        {
          field: { maxGigabytesScannedPerCheck: true },
          title: "Most a Check May Read (GB)",
          fieldType: FormFieldSchemaType.Number,
          required: true,
          placeholder: "10",
        },
        {
          field: { waitWhenDatabaseIsBusy: true },
          title: "Wait When a Database Is Busy",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
        {
          field: { keepFailingRows: true },
          title: "Keep Failing Rows",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
      ]}
      modelDetailProps={{
        showDetailsInNumberOfColumns: 1,
        modelType: DataObservabilitySetting,
        id: "data-observability-settings",
        modelId: settingId,
        fields: [
          {
            field: { maxGigabytesScannedPerCheck: true },
            title: "Most a Check May Read (GB)",
            fieldType: FieldType.Number,
          },
          {
            field: { waitWhenDatabaseIsBusy: true },
            title: "Wait When a Database Is Busy",
            fieldType: FieldType.Boolean,
          },
          {
            field: { keepFailingRows: true },
            title: "Keep Failing Rows",
            fieldType: FieldType.Boolean,
          },
        ],
      }}
    />
  );
};

export default DataObservabilitySettingsPage;
