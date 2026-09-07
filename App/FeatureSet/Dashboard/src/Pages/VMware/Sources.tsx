import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";
import VMwareSource from "Common/Models/DatabaseModels/VMwareSource";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Link from "Common/UI/Components/Link/Link";
import VMwareSetup from "../../Components/VMware/Setup";
import VMwareStatus from "../../Components/VMware/Status";
import { sourceRoute, sourceStatus, sourceKindLabel } from "./Utils";

const VMwareSources: FunctionComponent = (): ReactElement => {
  const [refresh, setRefresh] = useState<number>(0);
  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setRefresh((value: number) => value + 1);
    }, 10000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  return (
    <div className="space-y-6">
      <VMwareSetup />
      <ModelTable<VMwareSource>
        modelType={VMwareSource}
        id="vmware-sources"
        name="VMware Sources"
        isCreateable={false}
        isDeleteable={false}
        isEditable={true}
        isViewable={false}
        query={{ isArchived: showArchived }}
        showRefreshButton={true}
        refreshToggle={`${showArchived}-${refresh}`}
        topContent={
          <label className="flex items-center gap-2 py-2 text-sm text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setShowArchived(event.target.checked);
              }}
            />
            Show archived sources
          </label>
        }
        cardProps={{
          title: "VMware sources",
          description:
            "Each source connects one vCenter or standalone ESXi endpoint. Inventory appears after the first successful collection.",
        }}
        noItemsMessage={
          showArchived
            ? "No archived sources."
            : "Waiting for your first source. Follow the installation guide above; this list checks for your source every 10 seconds."
        }
        searchableFields={["name", "sourceIdentifier", "description"]}
        selectMoreFields={{
          metrics: true,
          lastSeenAt: true,
          lastCollectionAt: true,
          collectionIntervalSeconds: true,
          lastSuccessfulCollectionAt: true,
          isArchived: true,
        }}
        formFields={[
          {
            field: { name: true },
            title: "Display name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
          },
          {
            field: { isArchived: true },
            title: "Archive source",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Hide this source from the active list. Existing monitors keep their own enable/disable settings.",
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Source",
            type: FieldType.Element,
            getElement: (item: VMwareSource): ReactElement => (
              <Link
                to={sourceRoute(item._id!)}
                className="font-medium text-gray-900 hover:underline dark:text-gray-100"
              >
                {item.name || item.sourceIdentifier}
              </Link>
            ),
          },
          {
            field: { sourceIdentifier: true },
            title: "Source identifier",
            type: FieldType.Text,
          },
          {
            field: { kind: true },
            title: "Endpoint type",
            type: FieldType.Text,
          },
          {
            field: { lastSeenAt: true },
            title: "Collection",
            type: FieldType.Element,
            getElement: (item: VMwareSource): ReactElement => (
              <VMwareStatus status={sourceStatus(item)} />
            ),
          },
          {
            field: { lastSuccessfulCollectionAt: true },
            title: "Last successful collection",
            type: FieldType.DateTime,
          },
        ]}
      />
    </div>
  );
};
export default VMwareSources;
