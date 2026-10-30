import PageComponentProps from "../../PageComponentProps";
import DataSecurityApi from "../../../Components/DataSecurity/DataSecurityApi";
import {
  ConfidencePill,
  SensitivityPill,
} from "../../../Components/DataSecurity/DataSecurityPills";
import { STORE_SENSITIVITY_OPTIONS } from "../../../Components/DataSecurity/StoreFieldOptions";
import { getDataTypeName } from "../../../Components/DataSecurity/StoreDataTypeList";
import StoreNotSensitiveModal from "../../../Components/DataSecurity/StoreNotSensitiveModal";
import {
  getDataStoreKindFacts,
  useDataStoreViewContext,
} from "./DataStoreViewContext";
import DataStoreFinding from "Common/Models/DatabaseModels/DataStoreFinding";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import { Gray500, Green500 } from "Common/Types/BrandColors";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DataConfidence from "Common/Types/DataSecurity/DataConfidence";
import { DataSecurityScrubResult } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * WHAT IS INSIDE A STORE: every kind of sensitive data a scan found in it,
 * and where - a table and column, a field, an object path, a telemetry
 * attribute - with how sure the scan is, how many sampled values matched,
 * how many different values there were, and a few masked examples
 * (j***@e******.com, never a value; only some roles read them, and the
 * others see a dash).
 *
 * A finding that is wrong is marked Not Sensitive, with a reason: it then
 * no longer counts toward the store's sensitivity or its checks. In a
 * service's telemetry, Scrub It adds a scrub rule that masks the data at
 * ingest from then on.
 */

const CONFIDENCE_OPTIONS: Array<DropdownOption> = [
  { label: "High", value: DataConfidence.High },
  { label: "Medium", value: DataConfidence.Medium },
  { label: "Low", value: DataConfidence.Low },
];

const NO_SAMPLES: string = translationKey("No masked samples");

const CONFIDENCE_BELOW_HIGH: string = translationKey(
  "{{confidence}} confidence",
);

const DataStoreInside: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataStoreId, dataStore } = useDataStoreViewContext();
  const isTelemetry: boolean = getDataStoreKindFacts(
    dataStore?.kind,
  ).isTelemetry;

  const [notSensitiveFindingId, setNotSensitiveFindingId] =
    useState<ObjectID | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const refresh: () => void = (): void => {
    setRefreshToggle(Date.now().toString());
  };

  // Marking a finding needs the right to edit findings; scrubbing, to add scrub rules.
  const editGate: PermissionGateResult = PermissionGate.check(
    new DataStoreFinding(),
    ModelAction.Update,
  );
  const scrubGate: PermissionGateResult = PermissionGate.check(
    new LogScrubRule(),
    ModelAction.Create,
  );

  return (
    <Fragment>
      {message ? (
        <Alert
          type={AlertType.SUCCESS}
          title={message}
          onClose={() => {
            setMessage("");
          }}
        />
      ) : (
        <></>
      )}
      {error ? (
        <Alert
          type={AlertType.DANGER}
          title={error}
          onClose={() => {
            setError("");
          }}
        />
      ) : (
        <></>
      )}

      <ModelTable<DataStoreFinding>
        modelType={DataStoreFinding}
        id="data-store-findings-table"
        userPreferencesKey="data-store-findings-table"
        name="What's Inside"
        query={{ dataStoreId: dataStoreId }}
        refreshToggle={refreshToggle}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        sortBy="matchCount"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: "What's Inside",
          description:
            "The sensitive data found in this store and where, from samples of its content. Low confidence findings do not count toward the store's sensitivity until you judge them.",
        }}
        noItemsMessage="Nothing sensitive found in this store yet. Findings appear once its content is scanned."
        searchableFields={["dataTypeName", "location"]}
        selectMoreFields={{
          dataTypeId: true,
          dataCategory: true,
          locationKind: true,
          valueCount: true,
          matchPercent: true,
          isScrubbed: true,
          suppressedReason: true,
        }}
        actionButtons={[
          {
            title: "Not Sensitive",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Close,
            isVisible: (item: DataStoreFinding): boolean => {
              return !item.isSuppressed;
            },
            getDisabledReason: (): string | undefined => {
              return editGate.isAllowed ? undefined : editGate.disabledReason;
            },
            onClick: (
              item: DataStoreFinding,
              onCompleteAction: VoidFunction,
            ): void => {
              setNotSensitiveFindingId(new ObjectID(item._id!.toString()));
              onCompleteAction();
            },
          },
          {
            title: "Sensitive Again",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.ArrowUturnLeft,
            isVisible: (item: DataStoreFinding): boolean => {
              return Boolean(item.isSuppressed);
            },
            getDisabledReason: (): string | undefined => {
              return editGate.isAllowed ? undefined : editGate.disabledReason;
            },
            getConfirmation: () => {
              return {
                title: "Mark as Sensitive Again",
                description:
                  "It will count toward this store's sensitivity and its checks again.",
                submitButtonText: "Mark as Sensitive",
              };
            },
            onClick: async (
              item: DataStoreFinding,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ): Promise<void> => {
              try {
                await ModelAPI.updateById<DataStoreFinding>({
                  modelType: DataStoreFinding,
                  id: new ObjectID(item._id!.toString()),
                  data: {
                    isSuppressed: false,
                    suppressedReason: "",
                  },
                });
                onCompleteAction();
                refresh();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
          {
            title: "Scrub It",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.EyeSlash,
            isVisible: (item: DataStoreFinding): boolean => {
              return isTelemetry && !item.isScrubbed && !item.isSuppressed;
            },
            getDisabledReason: (): string | undefined => {
              return scrubGate.isAllowed ? undefined : scrubGate.disabledReason;
            },
            getConfirmation: () => {
              return {
                title: "Scrub This Data at Ingest",
                description:
                  "OneUptime adds a scrub rule that masks this kind of data at this place in new telemetry, before it is stored. What is already stored does not change.",
                submitButtonText: "Scrub It",
              };
            },
            onClick: async (
              item: DataStoreFinding,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ): Promise<void> => {
              try {
                setError("");
                const result: DataSecurityScrubResult =
                  await DataSecurityApi.scrubFinding(
                    new ObjectID(item._id!.toString()),
                  );
                setMessage(
                  translator.translateTemplate(
                    result.signal === "trace"
                      ? "The scrub rule {{name}} now masks this data in new traces."
                      : "The scrub rule {{name}} now masks this data in new logs.",
                    { name: result.scrubRuleName || "" },
                  ),
                );
                onCompleteAction();
                refresh();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        filters={[
          {
            field: { dataTypeName: true },
            title: "Data Type",
            type: FieldType.Text,
          },
          {
            field: { location: true },
            title: "Location",
            type: FieldType.Text,
          },
          {
            field: { confidence: true },
            title: "Confidence",
            type: FieldType.Dropdown,
            filterDropdownOptions: CONFIDENCE_OPTIONS,
          },
          {
            field: { sensitivity: true },
            title: "Sensitivity",
            type: FieldType.Dropdown,
            filterDropdownOptions: STORE_SENSITIVITY_OPTIONS,
          },
          {
            field: { isSuppressed: true },
            title: "Not Sensitive",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: { dataTypeName: true },
            title: "Data Type",
            type: FieldType.Element,
            getElement: (item: DataStoreFinding): ReactElement => {
              const name: string =
                item.dataTypeName ||
                (item.dataTypeId ? getDataTypeName(item.dataTypeId) : "") ||
                item.dataTypeId ||
                "";

              return (
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium text-gray-900">
                    {translator.translateText(name) || "—"}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {item.sensitivity ? (
                      <SensitivityPill sensitivity={item.sensitivity} />
                    ) : (
                      <></>
                    )}
                    {/*
                     * A finding the scan is not sure of says so here, while
                     * the Confidence column is left out: those are the ones
                     * to judge, and they do not count toward the store's
                     * sensitivity until someone does.
                     */}
                    {item.confidence &&
                    item.confidence !== DataConfidence.High ? (
                      <Pill
                        text={translator.translateTemplate(
                          CONFIDENCE_BELOW_HIGH,
                          {
                            confidence:
                              translator.translateText(item.confidence) ||
                              item.confidence,
                          },
                        )}
                        color={Gray500}
                      />
                    ) : (
                      <></>
                    )}
                    {item.dataCategory ? (
                      <span className="text-xs text-gray-500">
                        {translator.translateText(item.dataCategory)}
                      </span>
                    ) : (
                      <></>
                    )}
                  </div>
                </div>
              );
            },
          },
          {
            field: { location: true },
            title: "Location",
            type: FieldType.Element,
            // A long path wraps rather than pushing the table past its card.
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-xs",
            getElement: (item: DataStoreFinding): ReactElement => {
              return (
                <div className="min-w-0">
                  <div className="font-mono text-sm text-gray-800 [overflow-wrap:anywhere]">
                    {item.location || "—"}
                  </div>
                  {item.locationKind ? (
                    <div className="text-xs text-gray-500">
                      {translator.translateText(item.locationKind)}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: { confidence: true },
            title: "Confidence",
            type: FieldType.Element,
            isHiddenByDefault: true,
            getElement: (item: DataStoreFinding): ReactElement => {
              return <ConfidencePill confidence={item.confidence} />;
            },
          },
          {
            field: { matchCount: true },
            title: "Matches",
            type: FieldType.Element,
            getElement: (item: DataStoreFinding): ReactElement => {
              return (
                <div className="text-sm text-gray-700">
                  <div>
                    {translator.translateTemplate(
                      "{{matches}} of {{sampled}}",
                      {
                        matches: translator.formatNumber(item.matchCount || 0),
                        sampled: translator.formatNumber(item.valueCount || 0),
                      },
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {translator.translateTemplate("{{percent}}%", {
                      percent: translator.formatNumber(
                        Math.round((item.matchPercent || 0) * 10) / 10,
                      ),
                    })}
                  </div>
                </div>
              );
            },
          },
          {
            field: { distinctValues: true },
            title: "Distinct Values",
            type: FieldType.Number,
            hideOnMobile: true,
            isHiddenByDefault: true,
          },
          {
            field: { maskedSamples: true },
            title: "Masked Samples",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: DataStoreFinding): ReactElement => {
              const samples: Array<string> = Array.isArray(item.maskedSamples)
                ? item.maskedSamples
                : [];

              if (samples.length === 0) {
                return <TableEmptyValue screenReaderText={NO_SAMPLES} />;
              }

              return (
                <div className="flex flex-col gap-0.5">
                  {samples.map((sample: string): ReactElement => {
                    return (
                      <code
                        key={sample}
                        className="truncate font-mono text-xs text-gray-700"
                      >
                        {sample}
                      </code>
                    );
                  })}
                </div>
              );
            },
          },
          {
            field: { isSuppressed: true },
            title: "Status",
            type: FieldType.Element,
            hideOnMobile: true,
            isHiddenByDefault: true,
            getElement: (item: DataStoreFinding): ReactElement => {
              if (item.isSuppressed) {
                return (
                  <Pill
                    text="Not sensitive"
                    color={Gray500}
                    tooltip={item.suppressedReason || undefined}
                  />
                );
              }

              if (item.isScrubbed) {
                return (
                  <Pill
                    text="Scrubbed"
                    color={Green500}
                    tooltip="A scrub rule masks this data at ingest."
                  />
                );
              }

              return <TableEmptyValue />;
            },
          },
          {
            field: { firstSeenAt: true },
            title: "First Seen",
            type: FieldType.DateTime,
            hideOnMobile: true,
            isHiddenByDefault: true,
          },
          {
            field: { lastSeenAt: true },
            title: "Last Seen",
            type: FieldType.DateTime,
            hideOnMobile: true,
            isHiddenByDefault: true,
          },
        ]}
      />

      {notSensitiveFindingId ? (
        <StoreNotSensitiveModal
          findingId={notSensitiveFindingId}
          onClose={() => {
            setNotSensitiveFindingId(null);
          }}
          onDone={() => {
            setNotSensitiveFindingId(null);
            refresh();
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default DataStoreInside;
