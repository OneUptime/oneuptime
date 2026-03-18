import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Protocol from "Common/Types/API/Protocol";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import { getKubernetesInstallationMarkdown } from "../../Pages/Kubernetes/Utils/DocumentationMarkdown";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";

export interface ComponentProps {
  clusterName: string;
  title: string;
  description: string;
}

const KubernetesDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // Ingestion key state
  const [ingestionKeys, setIngestionKeys] = useState<
    Array<TelemetryIngestionKey>
  >([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [isLoadingKeys, setIsLoadingKeys] = useState<boolean>(true);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string>("");

  // Compute OneUptime URL
  const httpProtocol: string =
    HTTP_PROTOCOL === Protocol.HTTPS ? "https" : "http";
  const oneuptimeUrl: string = HOST
    ? `${httpProtocol}://${HOST}`
    : "<YOUR_ONEUPTIME_URL>";

  // Fetch ingestion keys on mount
  useEffect(() => {
    loadIngestionKeys().catch(() => {});
  }, []);

  const loadIngestionKeys: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoadingKeys(true);
      setKeyError("");
      const result: ListResult<TelemetryIngestionKey> =
        await ModelAPI.getList<TelemetryIngestionKey>({
          modelType: TelemetryIngestionKey,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          limit: 50,
          skip: 0,
          select: {
            _id: true,
            name: true,
            secretKey: true,
            description: true,
          },
          sort: {},
        });

      setIngestionKeys(result.data);

      // Auto-select the first key if available and none selected
      if (result.data.length > 0 && !selectedKeyId) {
        setSelectedKeyId(result.data[0]!.id?.toString() || "");
      }
    } catch (err) {
      setKeyError(API.getFriendlyErrorMessage(err as Error));
    } finally {
      setIsLoadingKeys(false);
    }
  };

  // Get the selected key object
  const selectedKey: TelemetryIngestionKey | undefined = useMemo(() => {
    return ingestionKeys.find((k: TelemetryIngestionKey) => {
      return k.id?.toString() === selectedKeyId;
    });
  }, [ingestionKeys, selectedKeyId]);

  // Get API key for code snippets
  const apiKeyValue: string =
    selectedKey?.secretKey?.toString() || "<YOUR_API_KEY>";

  const renderKeySelector: () => ReactElement = (): ReactElement => {
    if (isLoadingKeys) {
      return <PageLoader isVisible={true} />;
    }

    if (keyError) {
      return <ErrorMessage message={keyError} />;
    }

    if (ingestionKeys.length === 0) {
      return (
        <div className="text-center py-6">
          <p className="text-sm font-medium text-gray-900 mb-1">
            No ingestion keys yet
          </p>
          <p className="text-xs text-gray-500 mb-4">
            Create an ingestion key to authenticate your Kubernetes agent.
          </p>
          <button
            type="button"
            onClick={() => {
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Icon icon={IconProp.Add} className="w-4 h-4" />
            Create Ingestion Key
          </button>
        </div>
      );
    }

    return (
      <div>
        {/* Key selector row */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1">
            <Dropdown
              options={ingestionKeys.map(
                (key: TelemetryIngestionKey): DropdownOption => {
                  return {
                    value: key.id?.toString() || "",
                    label: key.name || "Unnamed Key",
                  };
                },
              )}
              value={
                ingestionKeys
                  .filter(
                    (key: TelemetryIngestionKey) =>
                      key.id?.toString() === selectedKeyId,
                  )
                  .map((key: TelemetryIngestionKey): DropdownOption => {
                    return {
                      value: key.id?.toString() || "",
                      label: key.name || "Unnamed Key",
                    };
                  })[0]
              }
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (value) {
                  setSelectedKeyId(value.toString());
                }
              }}
              placeholder="Select an ingestion key"
              ariaLabel="Select ingestion key"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setShowCreateModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors flex-shrink-0"
          >
            <Icon icon={IconProp.Add} className="w-4 h-4" />
            New Key
          </button>
        </div>

        {/* Credentials display */}
        {selectedKey && (
          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            <div className="grid grid-cols-1 divide-y divide-gray-100">
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-md bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon
                    icon={IconProp.Globe}
                    className="w-4 h-4 text-blue-600"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    OneUptime URL
                  </div>
                  <div className="text-sm text-gray-900 font-mono mt-0.5 break-all select-all">
                    {oneuptimeUrl}
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-md bg-amber-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon
                    icon={IconProp.Key}
                    className="w-4 h-4 text-amber-600"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    API Key
                  </div>
                  <div className="text-sm text-gray-900 font-mono mt-0.5 break-all select-all">
                    {selectedKey.secretKey?.toString() || "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const installationMarkdown: string = getKubernetesInstallationMarkdown({
    clusterName: props.clusterName,
    oneuptimeUrl: oneuptimeUrl,
    apiKey: apiKeyValue,
  });

  return (
    <div>
      <Card title={props.title} description={props.description}>
        <div className="px-4 pb-6">
          {/* Ingestion Key Section */}
          <div className="mb-6">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              Select Ingestion Key
            </label>
            {renderKeySelector()}
          </div>

          {/* Documentation */}
          <MarkdownViewer text={installationMarkdown} />
        </div>
      </Card>

      {/* Create Ingestion Key Modal */}
      {showCreateModal && (
        <ModelFormModal<TelemetryIngestionKey>
          modelType={TelemetryIngestionKey}
          name="Create Ingestion Key"
          title="Create Ingestion Key"
          description="Create a new telemetry ingestion key for authenticating your Kubernetes agent."
          onClose={() => {
            setShowCreateModal(false);
          }}
          submitButtonText="Create Key"
          onSuccess={(item: TelemetryIngestionKey) => {
            setShowCreateModal(false);
            loadIngestionKeys()
              .then(() => {
                if (item.id) {
                  setSelectedKeyId(item.id.toString());
                }
              })
              .catch(() => {});
          }}
          formProps={{
            name: "Create Ingestion Key",
            modelType: TelemetryIngestionKey,
            id: "create-ingestion-key",
            fields: [
              {
                field: {
                  name: true,
                },
                title: "Name",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "e.g. Kubernetes Agent Key",
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
                placeholder: "Optional description for this key",
              },
            ],
            formType: FormType.Create,
          }}
          onBeforeCreate={(
            item: TelemetryIngestionKey,
          ): Promise<TelemetryIngestionKey> => {
            item.projectId = ProjectUtil.getCurrentProjectId()!;
            return Promise.resolve(item);
          }}
        />
      )}
    </div>
  );
};

export default KubernetesDocumentationCard;
