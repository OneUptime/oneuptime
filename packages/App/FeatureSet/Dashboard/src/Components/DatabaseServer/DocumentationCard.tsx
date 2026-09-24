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
import { getTelemetryPayAsYouGoFormFields } from "../Billing/PayAsYouGo";
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
import Route from "Common/Types/API/Route";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  DATABASE_AGENT_ENGINES,
  DatabaseAgentEngine,
} from "../../Pages/Database/Utils/DatabaseAgentConfigs";
import {
  DatabaseDocumentationTarget,
  getDatabaseAgentEngine,
  getDatabaseAgentEngineLabel,
  getDatabaseAgentInstallationMarkdown,
  getDatabaseOwnCollectorMarkdown,
} from "../../Pages/Database/Utils/DocumentationMarkdown";

/*
 * The Database Agent install guide with the viewer's ingestion key filled
 * in. Two uses:
 *
 *   - the product Documentation page and the empty list: no `database`, an
 *     engine picker over the four engines the agent ships a config for;
 *   - a database's Documentation tab: `database` prefills the guide for that
 *     row — its identity and its oneuptime.database.server.id — for the
 *     row's own engine. An engine the agent has no config for gets the
 *     "use your own collector" guide instead (or, without any collector
 *     receiver, an explanation of what the page shows without one).
 */

export interface ComponentProps {
  title: string;
  description: string;
  database?: DatabaseDocumentationTarget | undefined;
}

const DatabaseDocumentationCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [ingestionKeys, setIngestionKeys] = useState<
    Array<TelemetryIngestionKey>
  >([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [isLoadingKeys, setIsLoadingKeys] = useState<boolean>(true);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string>("");

  const rowEngine: DatabaseAgentEngine | null = props.database
    ? getDatabaseAgentEngine(props.database.dbSystem)
    : null;
  const [selectedEngine, setSelectedEngine] = useState<DatabaseAgentEngine>(
    rowEngine || "postgresql",
  );

  const httpProtocol: string =
    HTTP_PROTOCOL === Protocol.HTTPS ? "https" : "http";
  const oneuptimeUrl: string = HOST
    ? `${httpProtocol}://${HOST}`
    : "<YOUR_ONEUPTIME_URL>";

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

      if (result.data.length > 0 && !selectedKeyId) {
        setSelectedKeyId(result.data[0]!.id?.toString() || "");
      }
    } catch (err) {
      setKeyError(API.getFriendlyErrorMessage(err as Error));
    } finally {
      setIsLoadingKeys(false);
    }
  };

  const selectedKey: TelemetryIngestionKey | undefined = useMemo(() => {
    return ingestionKeys.find((k: TelemetryIngestionKey) => {
      return k.id?.toString() === selectedKeyId;
    });
  }, [ingestionKeys, selectedKeyId]);

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
            Create an ingestion key to authenticate your Database Agent.
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
                  .filter((key: TelemetryIngestionKey) => {
                    return key.id?.toString() === selectedKeyId;
                  })
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

  const engineOptions: Array<DropdownOption> = DATABASE_AGENT_ENGINES.map(
    (engine: DatabaseAgentEngine): DropdownOption => {
      return { value: engine, label: getDatabaseAgentEngineLabel(engine) };
    },
  );

  const renderEngineSelector: () => ReactElement = (): ReactElement => {
    return (
      <div className="mb-6">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Database Engine
        </label>
        <Dropdown
          options={engineOptions}
          value={engineOptions.find((option: DropdownOption): boolean => {
            return option.value === selectedEngine;
          })}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            const engine: DatabaseAgentEngine | null = getDatabaseAgentEngine(
              value ? value.toString() : "",
            );
            if (engine) {
              setSelectedEngine(engine);
            }
          }}
          placeholder="Select a database engine"
          ariaLabel="Select database engine"
        />
      </div>
    );
  };

  const databaseHealthMonitorUrl: string = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_CREATE] as Route,
  ).toString();

  /*
   * A database's own tab always uses the row's engine; the picker is only
   * for the product page, where the user says what they run.
   */
  const installationMarkdown: string =
    props.database && !rowEngine
      ? getDatabaseOwnCollectorMarkdown({
          oneuptimeUrl: oneuptimeUrl,
          apiKey: apiKeyValue,
          database: props.database,
          databaseHealthMonitorUrl: databaseHealthMonitorUrl,
        })
      : getDatabaseAgentInstallationMarkdown({
          oneuptimeUrl: oneuptimeUrl,
          apiKey: apiKeyValue,
          engine: rowEngine || selectedEngine,
          database: props.database,
          databaseHealthMonitorUrl: databaseHealthMonitorUrl,
        });

  return (
    <div>
      <Card title={props.title} description={props.description}>
        <div className="px-4 pb-6">
          <div className="mb-6">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              Select Ingestion Key
            </label>
            {renderKeySelector()}
          </div>

          {props.database ? <></> : renderEngineSelector()}

          <MarkdownViewer text={installationMarkdown} />
        </div>
      </Card>

      {showCreateModal && (
        <ModelFormModal<TelemetryIngestionKey>
          modelType={TelemetryIngestionKey}
          name="Create Ingestion Key"
          title="Create Ingestion Key"
          description="Create a new telemetry ingestion key for authenticating your Database Agent."
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
              /*
               * The same pay-as-you-go notice and acknowledgement the settings
               * page shows. This is another door onto creating a key, and a
               * gate with a way around it is not a gate.
               */
              ...getTelemetryPayAsYouGoFormFields(),
              {
                field: {
                  name: true,
                },
                title: "Name",
                fieldType: FormFieldSchemaType.Text,
                required: true,
                placeholder: "e.g. Database Agent Key",
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

export default DatabaseDocumentationCard;
