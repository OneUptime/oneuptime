import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
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

/*
 * "Which key do I send this with, and where do I send it?" — step one of
 * every ingestion guide in the product.
 *
 * Extracted from Components/Telemetry/Documentation.tsx so the security
 * events guide could ask the same question without a second copy of the
 * list/select/create-key flow. The endpoint row is a prop rather than a
 * telemetry-type switch: OTLP, Pyroscope and the security-events ingest
 * URL are three different addresses, and a component that had to know
 * about all of them would grow a branch for every future pillar.
 */

export interface ComponentProps {
  endpointLabel: string;
  endpointValue: string;
  endpointHint?: string | undefined;

  /*
   * Fires with the key the snippets should be rendered with, and with
   * null while none is selectable (still loading, load failed, or the
   * project has no keys yet) so callers fall back to their placeholder
   * instead of showing a stale secret from a previous selection.
   */
  onSelectedKeyChange: (key: TelemetryIngestionKey | null) => void;
}

const IngestionKeySelector: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [ingestionKeys, setIngestionKeys] = useState<
    Array<TelemetryIngestionKey>
  >([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [isLoadingKeys, setIsLoadingKeys] = useState<boolean>(true);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string>("");

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

  // Fetch ingestion keys on mount
  useEffect(() => {
    loadIngestionKeys().catch(() => {});
  }, []);

  const selectedKey: TelemetryIngestionKey | undefined = useMemo(() => {
    return ingestionKeys.find((k: TelemetryIngestionKey) => {
      return k.id?.toString() === selectedKeyId;
    });
  }, [ingestionKeys, selectedKeyId]);

  /*
   * Held in a ref so the notify effect can depend on the selection alone.
   * Callers pass an inline arrow, which is a new function on every parent
   * render; in the dependency array that would re-notify the parent with
   * an unchanged key, and a parent that sets state from it would loop.
   */
  const onSelectedKeyChangeRef: React.MutableRefObject<
    (key: TelemetryIngestionKey | null) => void
  > = useRef(props.onSelectedKeyChange);
  onSelectedKeyChangeRef.current = props.onSelectedKeyChange;

  useEffect(() => {
    onSelectedKeyChangeRef.current(selectedKey || null);
  }, [selectedKey]);

  const renderContent: () => ReactElement = (): ReactElement => {
    if (isLoadingKeys) {
      return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm text-gray-500">Loading ingestion keys...</p>
        </div>
      );
    }

    if (keyError) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-600">
            Failed to load ingestion keys: {keyError}
          </p>
          <button
            type="button"
            onClick={() => {
              loadIngestionKeys().catch(() => {});
            }}
            className="mt-2 text-sm text-red-700 underline hover:text-red-800"
          >
            Retry
          </button>
        </div>
      );
    }

    if (ingestionKeys.length === 0) {
      return (
        <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center mx-auto mb-3">
            <Icon icon={IconProp.Key} className="w-5 h-5 text-indigo-600" />
          </div>
          <p className="text-sm font-medium text-gray-900 mb-1">
            No ingestion keys yet
          </p>
          <p className="text-xs text-gray-500 mb-4">
            Create an ingestion key to authenticate your telemetry data.
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
                    {props.endpointLabel}
                  </div>
                  <div className="text-sm text-gray-900 font-mono mt-0.5 break-all select-all">
                    {props.endpointValue}
                  </div>
                  {props.endpointHint && (
                    <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                      {props.endpointHint}
                    </div>
                  )}
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
                    Ingestion Token
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

  return (
    <div>
      {renderContent()}

      {/* Create Ingestion Key Modal */}
      {showCreateModal && (
        <ModelFormModal<TelemetryIngestionKey>
          modelType={TelemetryIngestionKey}
          name="Create Ingestion Key"
          title="Create Ingestion Key"
          description="Create a new telemetry ingestion key for sending data to OneUptime."
          onClose={() => {
            setShowCreateModal(false);
          }}
          submitButtonText="Create Key"
          onSuccess={(item: TelemetryIngestionKey) => {
            setShowCreateModal(false);
            // Refresh the list and select the new key
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
               * page shows. This is the second door onto creating a key, and a
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
                placeholder: "e.g. Production Key",
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

export default IngestionKeySelector;
