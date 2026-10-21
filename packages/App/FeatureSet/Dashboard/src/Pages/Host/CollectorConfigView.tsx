import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HostCollectorConfig from "Common/Models/DatabaseModels/HostCollectorConfig";
import HostCollectorConfigVersion from "Common/Models/DatabaseModels/HostCollectorConfigVersion";
import Host from "Common/Models/DatabaseModels/Host";
import Label from "Common/Models/DatabaseModels/Label";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import CodeType from "Common/Types/Code/CodeType";
import IconProp from "Common/Types/Icon/IconProp";
import { Green } from "Common/Types/BrandColors";
import {
  HOST_COLLECTOR_INGESTION_KEY_REFERENCE,
  HOST_COLLECTOR_URL_REFERENCE,
} from "Common/Types/HostCollector/HostCollector";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CodeEditor from "Common/UI/Components/CodeEditor/CodeEditor";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Pill from "Common/UI/Components/Pill/Pill";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  describeHostCollectorConfigTarget,
  getHostCollectorConfigFormFields,
} from "../../Components/HostCollector/HostCollectorConfigForm";
import {
  canPutHostCollectorConfigVersionBack,
  describeHostCollectorConfigVersionChange,
  isCurrentHostCollectorConfigVersion,
} from "../../Components/HostCollector/HostCollectorConfigVersions";
import { HostCollectorTranslatableText } from "../../Components/HostCollector/HostCollectorStatus";
import HostCollectorStatePill from "../../Components/HostCollector/HostCollectorStatePill";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * One Collector Config: who it is for, its config.yaml, every version it
 * has had, and the hosts that run it.
 *
 *   - Saving the YAML checks it on the server (HostCollectorConfigPolicy)
 *     and makes a new version, which its hosts get within a minute.
 *   - Put back sends an older version again, as a new version: the list
 *     only grows, so it always says what each host was sent.
 */

const YAML_VIEW_MAX_HEIGHT: string = "min(70vh, 36rem)";

const CollectorConfigView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());

  // The version the config is on now, for the Versions list's Current and Put back.
  const [current, setCurrent] = useState<HostCollectorConfig | null>(null);
  // Every save bumps it: the Versions list and the current version follow.
  const [savedCount, setSavedCount] = useState<number>(0);
  // Put back changes the YAML from outside its card: the card reads it again.
  const [yamlRefresher, setYamlRefresher] = useState<boolean>(false);

  const [shownVersion, setShownVersion] =
    useState<HostCollectorConfigVersion | null>(null);
  const [versionToPutBack, setVersionToPutBack] =
    useState<HostCollectorConfigVersion | null>(null);
  const [isPuttingBack, setIsPuttingBack] = useState<boolean>(false);
  const [putBackError, setPutBackError] = useState<string>("");

  const updateGate: PermissionGateResult = PermissionGate.check(
    new HostCollectorConfig(),
    ModelAction.Update,
  );

  useEffect(() => {
    let isCurrentRequest: boolean = true;

    ModelAPI.getItem<HostCollectorConfig>({
      modelType: HostCollectorConfig,
      id: modelId,
      select: {
        configHash: true,
        currentVersionNumber: true,
      },
    })
      .then((item: HostCollectorConfig | null) => {
        if (isCurrentRequest) {
          setCurrent(item);
        }
      })
      .catch(() => {
        // The cards on the page say what went wrong with their own reads.
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [savedCount]);

  const onSaved: () => void = (): void => {
    setSavedCount((count: number): number => {
      return count + 1;
    });
  };

  const putVersionBack: (
    version: HostCollectorConfigVersion,
  ) => Promise<void> = async (
    version: HostCollectorConfigVersion,
  ): Promise<void> => {
    setIsPuttingBack(true);
    setPutBackError("");

    try {
      await ModelAPI.updateById<HostCollectorConfig>({
        modelType: HostCollectorConfig,
        id: modelId,
        data: {
          configYaml: version.configYaml || "",
        },
      });
      setVersionToPutBack(null);
      setYamlRefresher((value: boolean): boolean => {
        return !value;
      });
      onSaved();
    } catch (err) {
      setPutBackError(API.getFriendlyMessage(err));
    }

    setIsPuttingBack(false);
  };

  const canPutShownVersionBack: boolean = Boolean(
    shownVersion &&
      updateGate.isAllowed &&
      canPutHostCollectorConfigVersionBack({
        versionConfigHash: shownVersion.configHash,
        currentConfigHash: current?.configHash,
      }),
  );

  const renderYaml: (
    yaml: string | undefined,
    testId: string,
  ) => ReactElement = (
    yaml: string | undefined,
    testId: string,
  ): ReactElement => {
    return (
      <CodeEditor
        type={CodeType.YAML}
        value={yaml || ""}
        readOnly={true}
        dataTestId={testId}
        maxHeight={YAML_VIEW_MAX_HEIGHT}
      />
    );
  };

  return (
    <Fragment>
      <CardModelDetail<HostCollectorConfig>
        name="Collector Config > Details"
        cardProps={{
          title: "Collector Config",
          description:
            "Which hosts run this config. A host runs the first config in the list that applies to it.",
        }}
        isEditable={true}
        editModalTitle="Edit Collector Config"
        formFields={getHostCollectorConfigFormFields()}
        onSaveSuccess={onSaved}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: HostCollectorConfig,
          id: "host-collector-config-details",
          modelId: modelId,
          selectMoreFields: {
            osType: true,
          },
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Hosts",
              fieldType: FieldType.Element,
              getElement: (item: HostCollectorConfig): ReactElement => {
                const target: { template: string; labels: string } =
                  describeHostCollectorConfigTarget({
                    osType: item.osType,
                    labelNames: (item.labels || []).map(
                      (label: Label): string => {
                        return label.name || "";
                      },
                    ),
                  });
                return (
                  <span data-testid="host-collector-config-target">
                    {translator.translateTemplate(target.template, {
                      labels: target.labels,
                    })}
                  </span>
                );
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Host Labels",
              fieldType: FieldType.Element,
              showIf: (item: HostCollectorConfig): boolean => {
                return (item.labels || []).length > 0;
              },
              getElement: (item: HostCollectorConfig): ReactElement => {
                return <LabelsElement labels={item.labels || []} />;
              },
            },
          ],
        }}
      />

      <CardModelDetail<HostCollectorConfig>
        name="Collector Config > config.yaml"
        cardProps={{
          title: "config.yaml",
          description:
            "The OpenTelemetry Collector config its hosts run. A saved change is checked, becomes a new version and reaches them within a minute.",
        }}
        isEditable={true}
        editButtonText="Edit config"
        editModalTitle="Edit config.yaml"
        editModalDescription="A host this config does not start on keeps running the last config that worked there, and shows why."
        createEditModalWidth={ModalWidth.Large}
        refresher={yamlRefresher}
        onSaveSuccess={onSaved}
        formFields={[
          {
            field: {
              configYaml: true,
            },
            title: "config.yaml",
            fieldType: FormFieldSchemaType.YAML,
            required: true,
            dataTestId: "host-collector-config-yaml-editor",
            description: translator.translateTemplate(
              "Send with the otlp_http exporter to {{url}}/otlp, with the header x-oneuptime-token: {{key}}. Each host fills in its own address and key.",
              {
                url: HOST_COLLECTOR_URL_REFERENCE,
                key: HOST_COLLECTOR_INGESTION_KEY_REFERENCE,
              },
            ),
          },
        ]}
        modelDetailProps={{
          modelType: HostCollectorConfig,
          id: "host-collector-config-yaml",
          modelId: modelId,
          fields: [
            {
              field: {
                currentVersionNumber: true,
              },
              title: "Version",
              fieldType: FieldType.Element,
              getElement: (item: HostCollectorConfig): ReactElement => {
                return (
                  <span data-testid="host-collector-config-version">
                    {translator.formatNumber(item.currentVersionNumber || 1)}
                  </span>
                );
              },
            },
            {
              field: {
                configYaml: true,
              },
              fieldType: FieldType.Element,
              getElement: (item: HostCollectorConfig): ReactElement => {
                return renderYaml(
                  item.configYaml,
                  "host-collector-config-yaml",
                );
              },
            },
          ],
        }}
      />

      <ModelTable<HostCollectorConfigVersion>
        modelType={HostCollectorConfigVersion}
        id="host-collector-config-versions-table"
        name="Collector Config > Versions"
        userPreferencesKey="host-collector-config-versions-table"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          hostCollectorConfigId: modelId,
        }}
        refreshToggle={String(savedCount)}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        sortBy="versionNumber"
        sortOrder={SortOrder.Descending}
        showRefreshButton={true}
        cardProps={{
          title: "Versions",
          description:
            "Every saved change, newest first. Put an older version back to send it to the hosts again.",
        }}
        noItemsMessage="No versions yet."
        selectMoreFields={{
          configYaml: true,
          configHash: true,
        }}
        actionButtons={[
          {
            title: "View",
            icon: IconProp.Code,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: (
              item: HostCollectorConfigVersion,
              onCompleteAction: () => void,
            ) => {
              setShownVersion(item);
              onCompleteAction();
            },
          },
          {
            title: "Put back",
            icon: IconProp.Refresh,
            buttonStyleType: ButtonStyleType.OUTLINE,
            isVisible: (item: HostCollectorConfigVersion): boolean => {
              /*
               * Locked, with the reason, for a viewer who may not change
               * the config; hidden while there is no reason to give yet.
               */
              if (!updateGate.isAllowed && !updateGate.disabledReason) {
                return false;
              }
              return canPutHostCollectorConfigVersionBack({
                versionConfigHash: item.configHash,
                currentConfigHash: current?.configHash,
              });
            },
            disabled: !updateGate.isAllowed,
            tooltip: updateGate.disabledReason,
            onClick: (
              item: HostCollectorConfigVersion,
              onCompleteAction: () => void,
            ) => {
              setPutBackError("");
              setVersionToPutBack(item);
              onCompleteAction();
            },
          },
        ]}
        filters={[]}
        columns={[
          {
            field: {
              versionNumber: true,
            },
            title: "Version",
            type: FieldType.Element,
            getElement: (item: HostCollectorConfigVersion): ReactElement => {
              return (
                <span className="inline-flex items-center gap-2 text-sm text-gray-900">
                  {translator.translateTemplate("Version {{number}}", {
                    number: String(item.versionNumber || 1),
                  })}
                  {isCurrentHostCollectorConfigVersion({
                    versionNumber: item.versionNumber,
                    currentVersionNumber: current?.currentVersionNumber,
                  }) && <Pill text="Current" color={Green} />}
                </span>
              );
            },
          },
          {
            field: {
              changeNote: true,
            },
            title: "Change",
            type: FieldType.Element,
            getElement: (item: HostCollectorConfigVersion): ReactElement => {
              const change: HostCollectorTranslatableText =
                describeHostCollectorConfigVersionChange(item.changeNote);
              return (
                <span className="text-sm text-gray-700">
                  {translator.translateTemplate(change.template, change.values)}
                </span>
              );
            },
          },
          {
            field: {
              createdByUser: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "Saved by",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: HostCollectorConfigVersion): ReactElement => {
              const name: string =
                item.createdByUser?.name?.toString() ||
                item.createdByUser?.email?.toString() ||
                "";
              return (
                <span className="text-sm text-gray-700">
                  {name || translator.translateText("OneUptime")}
                </span>
              );
            },
          },
          {
            field: {
              createdAt: true,
            },
            title: "Saved",
            type: FieldType.DateTime,
          },
        ]}
      />

      <ModelTable<Host>
        modelType={Host}
        id="host-collector-config-hosts-table"
        name="Collector Config > Hosts"
        userPreferencesKey="host-collector-config-hosts-table"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          collectorConfigId: modelId,
          isArchived: false,
        }}
        refreshToggle={String(savedCount)}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.HOSTS] as Route,
        )}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        showRefreshButton={true}
        cardProps={{
          title: "Hosts",
          description:
            "The hosts OneUptime sends this config to, and the version each one runs.",
        }}
        noItemsMessage="No host runs this config yet. A host gets it once it reports and this config is the first that applies to it."
        selectMoreFields={{
          collectorInstanceUid: true,
          collectorLastContactAt: true,
          collectorConfigStatus: true,
          isCollectorHealthy: true,
          isCollectorConfigPinned: true,
        }}
        filters={[]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              collectorConfigStatus: true,
            },
            title: "Collector",
            type: FieldType.Element,
            getElement: (item: Host): ReactElement => {
              return <HostCollectorStatePill host={item} />;
            },
          },
          {
            field: {
              collectorConfigVersion: {
                versionNumber: true,
              },
            },
            title: "Version",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: Host): ReactElement => {
              const versionNumber: number | undefined =
                item.collectorConfigVersion?.versionNumber;
              return (
                <span className="text-sm text-gray-700">
                  {versionNumber
                    ? translator.formatNumber(versionNumber)
                    : translator.translateText("Not yet")}
                  {item.isCollectorConfigPinned ? (
                    <span className="ml-2 text-xs text-gray-500">
                      {translator.translateText("Picked for this host")}
                    </span>
                  ) : (
                    <></>
                  )}
                </span>
              );
            },
          },
        ]}
      />

      <ModelDelete
        modelType={HostCollectorConfig}
        modelId={modelId}
        confirmationContent={
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "Its hosts go back to the first config that applies to them, or to OneUptime's default. Their collectors keep running.",
            )}
          </p>
        }
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.HOST_COLLECTOR_CONFIGS] as Route,
            ),
          );
        }}
      />

      {shownVersion && (
        <Modal
          title={translator.translateTemplate("Version {{number}}", {
            number: String(shownVersion.versionNumber || 1),
          })}
          description={translator.translateTemplate(
            describeHostCollectorConfigVersionChange(shownVersion.changeNote)
              .template,
            describeHostCollectorConfigVersionChange(shownVersion.changeNote)
              .values,
          )}
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setShownVersion(null);
          }}
          closeButtonText="Close"
          // An older version can be put back from here, once it has been read.
          submitButtonText={canPutShownVersionBack ? "Put back" : undefined}
          onSubmit={
            canPutShownVersionBack
              ? () => {
                  setPutBackError("");
                  setVersionToPutBack(shownVersion);
                  setShownVersion(null);
                }
              : undefined
          }
        >
          {renderYaml(
            shownVersion.configYaml,
            "host-collector-config-version-yaml",
          )}
        </Modal>
      )}

      {versionToPutBack && (
        <ConfirmModal
          title={translator.translateTemplate("Put version {{number}} back?", {
            number: String(versionToPutBack.versionNumber || 1),
          })}
          description={translator.translateTemplate(
            "Its hosts get the config of version {{number}} again, saved as a new version. Every version stays in the list.",
            {
              number: String(versionToPutBack.versionNumber || 1),
            },
          )}
          submitButtonText="Put back"
          isLoading={isPuttingBack}
          error={putBackError || undefined}
          onClose={() => {
            setVersionToPutBack(null);
            setPutBackError("");
          }}
          onSubmit={() => {
            void putVersionBack(versionToPutBack);
          }}
        />
      )}
    </Fragment>
  );
};

export default CollectorConfigView;
