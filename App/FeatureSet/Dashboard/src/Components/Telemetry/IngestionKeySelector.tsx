import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { getTelemetryPayAsYouGoFormFields } from "../Billing/PayAsYouGo";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Query from "Common/Types/BaseDatabase/Query";
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
   * Restrict the picker to one class of key, and pin new keys created from
   * here to it.
   *
   * Optional, and undefined keeps exactly the behaviour this component has
   * always had: every key in the project, and a create form that defaults to
   * Server. A guide whose snippet ends up in a page the public can read
   * (a browser SDK, a session replay tag) passes Browser, so the list cannot
   * offer a server secret for pasting into a page in the first place - the
   * warning below the token is the second line of defence, not the first.
   */
  keyTypeFilter?: TelemetryIngestionKeyType | undefined;

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

  const isBrowserKeyOnly: boolean =
    props.keyTypeFilter === TelemetryIngestionKeyType.Browser;

  const loadIngestionKeys: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoadingKeys(true);
      setKeyError("");

      const query: Query<TelemetryIngestionKey> = {
        projectId: ProjectUtil.getCurrentProjectId()!,
      };

      if (props.keyTypeFilter) {
        query.keyType = props.keyTypeFilter;
      }

      const result: ListResult<TelemetryIngestionKey> =
        await ModelAPI.getList<TelemetryIngestionKey>({
          modelType: TelemetryIngestionKey,
          query: query,
          limit: 50,
          skip: 0,
          select: {
            _id: true,
            name: true,
            secretKey: true,
            description: true,
            /*
             * Not shown as a column anywhere - it decides which caution the
             * token panel prints. Rendering a secret without saying which
             * kind of secret it is is how a server key ends up in a page.
             */
            keyType: true,
            allowedOrigins: true,
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

  /*
   * Fetch on mount, and again if the caller narrows to a different key type -
   * the filter is part of the query, so a stale list would offer keys the
   * guide has just said it does not want.
   */
  useEffect(() => {
    loadIngestionKeys().catch(() => {});
  }, [props.keyTypeFilter]);

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

  /*
   * Printed directly under the token, every time, on every guide that uses
   * this component. A token on screen is a token about to be pasted
   * somewhere, and the one thing the reader cannot tell by looking at it is
   * whether the place they are about to paste it is safe.
   */
  const renderSelectedKeyCaution: (
    key: TelemetryIngestionKey,
  ) => ReactElement = (key: TelemetryIngestionKey): ReactElement => {
    if (key.keyType === TelemetryIngestionKeyType.Browser) {
      /*
       * A browser key with no origins is refused on every request, so
       * handing someone a snippet built around one only produces a
       * confusing 403 later. Say so here, while they are still on the page
       * that can fix it.
       */
      if (!key.allowedOrigins || key.allowedOrigins.length === 0) {
        return (
          <div className="text-xs text-red-600 mt-2 leading-relaxed">
            This browser key has no allowed origins, so every request made with
            it is refused. Add the origins your site is served from in Settings
            &gt; Telemetry Ingestion Keys before using this snippet.
          </div>
        );
      }

      return (
        <div className="text-xs text-gray-500 mt-2 leading-relaxed">
          Browser key — safe to publish in your page. It is accepted only from{" "}
          {key.allowedOrigins.join(", ")}, and only for trace, log, metric and
          session replay ingest.
        </div>
      );
    }

    return (
      <div className="text-xs text-amber-700 mt-2 leading-relaxed">
        Server key — treat it as a secret. It can write every kind of telemetry
        into this project from anywhere, so it belongs in server environment
        variables and collector config only. Never paste it into browser
        JavaScript, a mobile app bundle, or anything else your users can read:
        use a Browser ingestion key there.
      </div>
    );
  };

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
            {isBrowserKeyOnly
              ? "No browser ingestion keys yet"
              : "No ingestion keys yet"}
          </p>
          <p className="text-xs text-gray-500 mb-4">
            {isBrowserKeyOnly
              ? "A browser key is the one safe to publish in a page: it is accepted only from the origins you list, and it can only write browser telemetry."
              : "Create an ingestion key to authenticate your telemetry data."}
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
                  {renderSelectedKeyCaution(selectedKey)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  /*
   * True when the key about to be created is a Browser key - either because
   * the caller pinned the type, or because the user picked Browser in the
   * dropdown below. The origin allowlist and the pinned service name are
   * ignored on a Server key, so they are only offered when they will
   * actually do something.
   */
  const isBrowserKeyBeingCreated: (
    item: FormValues<TelemetryIngestionKey>,
  ) => boolean = (item: FormValues<TelemetryIngestionKey>): boolean => {
    if (props.keyTypeFilter) {
      return props.keyTypeFilter === TelemetryIngestionKeyType.Browser;
    }

    return item.keyType === TelemetryIngestionKeyType.Browser;
  };

  const getCreateKeyFormFields: () => Array<
    ModelField<TelemetryIngestionKey>
  > = (): Array<ModelField<TelemetryIngestionKey>> => {
    const fields: Array<ModelField<TelemetryIngestionKey>> = [
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
    ];

    /*
     * A pinned type is applied in onBeforeCreate rather than shown as a
     * disabled dropdown: the guide has already decided which kind of key its
     * snippet needs, and offering the choice back only invites picking the
     * wrong one for the code on screen.
     */
    if (!props.keyTypeFilter) {
      fields.push({
        field: {
          keyType: true,
        },
        title: "Key Type",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions:
          DropdownUtil.getDropdownOptionsFromEnumWithReadableLabels(
            TelemetryIngestionKeyType,
          ),
        required: true,
        defaultValue: TelemetryIngestionKeyType.Server,
        description:
          "A Server key is a secret and belongs in your servers, containers and collectors - never in browser JavaScript or anywhere else your users can read it. A Browser key is safe to publish in a page: it is accepted only from the origins you list and can write only traces, logs, metrics and session replays. The type cannot be changed later.",
      });
    }

    fields.push({
      field: {
        allowedOrigins: true,
      },
      title: "Allowed Origins",
      fieldType: FormFieldSchemaType.JSON,
      showIf: isBrowserKeyBeingCreated,
      required: isBrowserKeyBeingCreated,
      placeholder: '["https://app.example.com"]',
      description:
        'JSON array of the origins this key may be used from. Required on a browser key and enforced on the server for every request: telemetry from an origin that is not listed, or with no Origin header at all, is refused. One leading "*." host wildcard is allowed.',
    });

    fields.push({
      field: {
        pinnedServiceName: true,
      },
      title: "Pinned Service Name",
      fieldType: FormFieldSchemaType.Text,
      showIf: isBrowserKeyBeingCreated,
      required: false,
      placeholder: "storefront-web",
      description:
        "Forces service.name to this value on everything the key writes. Anyone who copies the key out of your page can then only write into this one service, instead of forging telemetry that looks like it came from one of your backend services.",
    });

    return fields;
  };

  return (
    <div>
      {renderContent()}

      {/* Create Ingestion Key Modal */}
      {showCreateModal && (
        <ModelFormModal<TelemetryIngestionKey>
          modelType={TelemetryIngestionKey}
          name="Create Ingestion Key"
          title={
            isBrowserKeyOnly
              ? "Create Browser Ingestion Key"
              : "Create Ingestion Key"
          }
          description={
            isBrowserKeyOnly
              ? "Create a browser telemetry ingestion key. It is safe to publish in your page, and is accepted only from the origins you list below."
              : "Create a new telemetry ingestion key for sending data to OneUptime."
          }
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
            fields: getCreateKeyFormFields(),
            formType: FormType.Create,
          }}
          onBeforeCreate={(
            item: TelemetryIngestionKey,
          ): Promise<TelemetryIngestionKey> => {
            item.projectId = ProjectUtil.getCurrentProjectId()!;

            if (props.keyTypeFilter) {
              item.keyType = props.keyTypeFilter;
            }

            return Promise.resolve(item);
          }}
        />
      )}
    </div>
  );
};

export default IngestionKeySelector;
