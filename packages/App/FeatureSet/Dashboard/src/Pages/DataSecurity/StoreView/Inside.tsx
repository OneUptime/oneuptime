import PageComponentProps from "../../PageComponentProps";
import {
  ConfidencePill,
  SensitivityPill,
} from "../../../Components/DataSecurity/DataSecurityPills";
import { STORE_SENSITIVITY_OPTIONS } from "../../../Components/DataSecurity/StoreFieldOptions";
import { getDataTypeName } from "../../../Components/DataSecurity/StoreDataTypeList";
import {
  FindingDecisions,
  useFindingDecisions,
} from "../../../Components/DataSecurity/FindingDecisions";
import {
  FINDING_ROW_NOTE_SELECT,
  getFindingRowNote,
} from "../../../Components/DataSecurity/FindingRowNote";
import { FindingVerdictCopy } from "../../../Components/DataSecurity/FindingVerdictCopy";
import ScrubItModal from "../../../Components/DataSecurity/ScrubItModal";
import { SCRUB_NOTICES } from "../../../Components/DataSecurity/TelemetryScrubIt";
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
import {
  DATA_STORE_FINDING_VERDICT_TITLES,
  DATA_STORE_FINDING_VERDICTS,
  DataStoreFindingVerdict,
} from "Common/Types/DataSecurity/DataStoreFindingVerdict";
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
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

export {
  FINDING_AI_REASON_TEST_ID,
  FINDING_AI_SUGGESTION_TEST_ID,
} from "../../../Components/DataSecurity/FindingRowNote";

/*
 * WHAT IS INSIDE A STORE: every kind of sensitive data a scan found in it,
 * and where - a table and column, a field, an object path, a telemetry
 * attribute - with how sure the scan is, how many sampled values matched,
 * how many different values there were, and a few masked examples
 * (j***@e******.com, never a value; only some roles read them, and the
 * others see a dash).
 *
 * A finding that is wrong is marked Not Sensitive, with a reason: it then
 * no longer counts toward the store's sensitivity or its checks. A Low
 * finding that is right is confirmed: it then counts as High. In a
 * service's telemetry, Scrub It adds a scrub rule that masks the data at
 * ingest from then on.
 *
 * A field no detector placed can hold OneUptime AI's suggestion, from the
 * field's name, the names beside it and the shapes of its values - never a
 * value (Server/Utils/AI/DataSecurity/FieldSuggestion). It reads as
 * OneUptime AI's, with its reason, matched no value, and counts toward
 * nothing until a person confirms it. Being OneUptime AI's says it is not
 * sure, so it carries no Low confidence pill beside it.
 *
 * What OneUptime AI says of a finding reads across its row, under its
 * cells (FindingRowNote, #10372 and #6105): a suggestion's reason, which a
 * 120px column held to a word a line; its verdict on a finding that waits
 * for a person - Confirm it, Not sensitive or Cannot tell - with why and
 * the team's decisions it rests on; and that it confirmed one on its own,
 * where an AI rule allows. Mark as Not Sensitive starts from its draft when
 * its verdict was Not sensitive, and after Confirm or Not Sensitive, Apply
 * to similar offers the findings like it (FindingDecisions).
 */

const CONFIDENCE_OPTIONS: Array<DropdownOption> = [
  { label: "High", value: DataConfidence.High },
  { label: "Medium", value: DataConfidence.Medium },
  { label: "Low", value: DataConfidence.Low },
];

const NO_SAMPLES: string = translationKey("No masked samples");

const VALUES_READ: PluralTemplate = {
  one: "{{count}} value read",
  other: "{{count}} values read",
};

const CONFIDENCE_BELOW_HIGH: string = translationKey(
  "{{confidence}} confidence",
);

export const SUGGESTED_BY_AI: string = translationKey(
  "Suggested by OneUptime AI",
);
export const CONFIRMED: string = translationKey("Confirmed");

// OneUptime AI's verdicts, as the list filters by them.
const VERDICT_OPTIONS: Array<DropdownOption> = DATA_STORE_FINDING_VERDICTS.map(
  (verdict: DataStoreFindingVerdict): DropdownOption => {
    return {
      label: DATA_STORE_FINDING_VERDICT_TITLES[verdict],
      value: verdict,
    };
  },
);

// Whether a person can confirm a finding: one the scan, or OneUptime AI, was not sure of.
export function canConfirmFinding(item: DataStoreFinding): boolean {
  return (
    !item.isSuppressed &&
    !item.isConfirmed &&
    item.confidence === DataConfidence.Low
  );
}

const DataStoreInside: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { dataStoreId, dataStore } = useDataStoreViewContext();
  const isTelemetry: boolean = getDataStoreKindFacts(
    dataStore?.kind,
  ).isTelemetry;

  const [refreshToggle, setRefreshToggle] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  // The finding Scrub It's dialog is open on (ScrubItModal, #10433).
  const [scrubbing, setScrubbing] = useState<DataStoreFinding | null>(null);

  const refresh: () => void = (): void => {
    setRefreshToggle(Date.now().toString());
  };

  // Not Sensitive and Confirm, then Apply to similar (#10372).
  const decisions: FindingDecisions = useFindingDecisions(refresh);

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
            "The sensitive data found in this store and where, from samples of its content. Low confidence findings, and OneUptime AI's suggestions for fields no detector placed, count toward nothing until you confirm them.",
        }}
        noItemsMessage="No findings in this store yet. Findings appear once its content is scanned."
        searchableFields={["dataTypeName", "location"]}
        selectMoreFields={{
          ...FINDING_ROW_NOTE_SELECT,
          dataCategory: true,
          valueCount: true,
          matchPercent: true,
          isScrubbed: true,
          suppressedReason: true,
        }}
        getRowNote={getFindingRowNote}
        actionButtons={[
          {
            title: "Confirm",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Check,
            isVisible: (item: DataStoreFinding): boolean => {
              return canConfirmFinding(item);
            },
            getDisabledReason: (): string | undefined => {
              return editGate.isAllowed ? undefined : editGate.disabledReason;
            },
            getConfirmation: (item: DataStoreFinding) => {
              return {
                title: "Confirm This Finding",
                description: item.isAiSuggested
                  ? "You confirm this field holds this kind of data. It then counts toward this store's sensitivity and its checks as High confidence."
                  : "You confirm this location holds this kind of data. It then counts toward this store's sensitivity and its checks as High confidence.",
                submitButtonText: "Confirm",
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
                  data: { isConfirmed: true },
                });
                onCompleteAction();
                refresh();
                // The findings like it, one decision for all (#10372).
                decisions.afterConfirm(item);
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
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
              decisions.markNotSensitive(item);
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
            /*
             * A dialog says what the rule does, whose records it changes
             * and what reads the data, then makes it (#10433).
             */
            onClick: (
              item: DataStoreFinding,
              onCompleteAction: VoidFunction,
            ): void => {
              setError("");
              setScrubbing(item);
              onCompleteAction();
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
          {
            field: { isAiSuggested: true },
            title: "Suggested by OneUptime AI",
            type: FieldType.Boolean,
          },
          {
            field: { isConfirmed: true },
            title: "Confirmed",
            type: FieldType.Boolean,
          },
          {
            field: { aiVerdict: true },
            title: FindingVerdictCopy.verdictFilter,
            type: FieldType.Dropdown,
            filterDropdownOptions: VERDICT_OPTIONS,
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

              /*
               * The name and its category wrap at a space when the table is
               * short of room, as the pills under them do, rather than set
               * the column's width: a busy project's German must fit a
               * laptop's card.
               */
              return (
                <div className="min-w-0 space-y-1">
                  <div className="whitespace-normal text-sm font-medium text-gray-900">
                    {translator.translateText(name) || <TableEmptyValue />}
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
                     * sensitivity until someone does. OneUptime AI's says
                     * so on its own line below.
                     */}
                    {item.confidence &&
                    item.confidence !== DataConfidence.High &&
                    !item.isAiSuggested ? (
                      <Pill
                        text={translator.translateTemplate(
                          CONFIDENCE_BELOW_HIGH,
                          {
                            confidence:
                              translator.translateText(item.confidence) ||
                              item.confidence,
                          },
                        )}
                        isUserContent={true}
                        color={Gray500}
                      />
                    ) : (
                      <></>
                    )}
                    {item.isConfirmed ? (
                      <Pill text={CONFIRMED} color={Green500} />
                    ) : (
                      <></>
                    )}
                    {item.dataCategory ? (
                      <span className="whitespace-normal text-xs text-gray-500">
                        {translator.translateText(item.dataCategory)}
                      </span>
                    ) : (
                      <></>
                    )}
                  </div>
                  {/*
                   * Whose suggestion it is, and why, read across the row
                   * under its cells (FindingRowNote, #6105).
                   */}
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
                    {item.location || <TableEmptyValue />}
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
              // A suggestion matched no value: it says what was read instead.
              if (item.isAiSuggested && !item.matchCount) {
                return (
                  <div className="text-sm text-gray-700">
                    <div>{translator.translateText("No value matched")}</div>
                    <div className="text-xs text-gray-500">
                      {translator.translatePlural(
                        VALUES_READ,
                        item.valueCount || 0,
                      )}
                    </div>
                  </div>
                );
              }

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
                    tooltip="A scrub rule hides this data at ingest."
                  />
                );
              }

              if (item.isConfirmed) {
                return <Pill text={CONFIRMED} color={Green500} />;
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

      {decisions.dialogs}

      {scrubbing?._id ? (
        <ScrubItModal
          findingId={new ObjectID(scrubbing._id.toString())}
          onClose={() => {
            setScrubbing(null);
          }}
          onScrubbed={(result: DataSecurityScrubResult) => {
            setMessage(
              translator.translateTemplate(
                SCRUB_NOTICES[result.signal] || SCRUB_NOTICES.log,
                { name: result.scrubRuleName || "" },
              ),
            );
            setScrubbing(null);
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
