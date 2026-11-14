import {
  ComparisonCollectState,
  ComparisonTemplateTarget,
  ComparisonValues,
  ComparisonValuesKind,
  DeviceAnswerForOid,
  DeviceAnswerKind,
  DeviceWalk,
  MultiDeviceSnmpWalkDevice,
  SnmpWalkComparisonRow,
  SnmpWalkComparisonRowView,
  filterComparisonRows,
  formatComparisonNumber,
  getComparisonCollectState,
  getDeviceAnswerForOid,
  summarizeComparisonValues,
} from "./MultiDeviceSnmpWalkViewModel";
import { SnmpWalkRowValue } from "./SnmpWalkResults";
import {
  SNMP_WALK_ROWS_PER_PAGE,
  SnmpWalkRowLabels,
  getSnmpWalkRowLabels,
  toSnmpWalkRowView,
} from "./SnmpWalkViewModel";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Checkbox from "Common/UI/Components/Checkbox/Checkbox";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useClipboardCopy, {
  ClipboardCopy,
} from "Common/UI/Utils/UseClipboardCopy";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

/*
 * What many devices answered under one OID (issue #5548), one OID a row:
 * its name from the MIBs OneUptime knows, its type, how many of the devices
 * whose walk reached it answer it, and their values - one value when they
 * agree, the lowest and highest when numbers differ. "Answered by" opens the
 * row on each device's own answer, or on why there is none: the device
 * walked past the OID without it, or its walk stopped first.
 *
 * From a row, Collect adds the OID to every device that answers it and does
 * not collect it yet, and the row's menu adds it to an OID Collection
 * Template those devices are linked to instead.
 *
 * The layout follows the results' own width, as a device's walk does
 * (SnmpWalkResults): from 48rem a table whose rows are subgrids, below it a
 * small card per OID.
 */

/*
 * What collecting an OID on many devices came to, said in its row: how
 * many devices collect it now, and each device that refused, with why.
 */
export interface MultiDeviceSnmpWalkNotice {
  oid: string;
  kind: "success" | "warning" | "error";
  text: string;
  failures?: Array<{ deviceName: string; message: string }> | undefined;
}

export interface ComponentProps {
  rows: Array<SnmpWalkComparisonRow>;
  views: Map<string, SnmpWalkComparisonRowView>;
  // The compared walks, in the order the devices were picked.
  walks: Array<DeviceWalk>;
  devicesById: Map<string, MultiDeviceSnmpWalkDevice>;
  collectedOidsByDevice: Map<string, Set<string>>;
  // Hidden when the reader may not change devices.
  canCollect: boolean;
  // Hidden when the reader may not change OID Collection Templates.
  canCollectOnTemplate: boolean;
  // The OID being collected right now.
  collectingOid?: string | undefined;
  notice?: MultiDeviceSnmpWalkNotice | undefined;
  onCollect: (row: SnmpWalkComparisonRow, deviceIds: Array<string>) => void;
  onCollectOnTemplate: (
    row: SnmpWalkComparisonRow,
    target: ComparisonTemplateTarget,
  ) => void;
  // A device's own SNMP Walk page, which opens on this walk of it.
  getDeviceWalkRoute: (deviceId: string) => Route;
}

const RESULTS_CONTAINER_CLASS_NAME: string = "[container-type:inline-size]";

/*
 * The row's cells, placed for both layouts. Narrow: the name and the menu
 * share the first line, then "answered by", the value and the action, each
 * on a line of its own. Wide (the results 48rem or more): one subgrid row
 * of the table's six columns, the notice and the devices' answers lines of
 * their own under it.
 */
export const MULTI_SNMP_WALK_ROW_CLASS_NAME: string =
  "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 py-3 [@container(min-width:48rem)]:col-span-full [@container(min-width:48rem)]:grid-cols-subgrid [@container(min-width:48rem)]:gap-x-4 [@container(min-width:48rem)]:gap-y-1.5";
const NAME_CELL_CLASS_NAME: string = "col-start-1 row-start-1 min-w-0";
const TYPE_CELL_CLASS_NAME: string =
  "[@container(max-width:47.99rem)]:hidden [@container(min-width:48rem)]:col-start-2 [@container(min-width:48rem)]:row-start-1";
const ANSWERED_CELL_CLASS_NAME: string =
  "col-span-2 row-start-2 min-w-0 [@container(min-width:48rem)]:col-span-1 [@container(min-width:48rem)]:col-start-3 [@container(min-width:48rem)]:row-start-1";
const VALUE_CELL_CLASS_NAME: string =
  "col-span-2 row-start-3 flex min-w-0 items-start gap-2 [@container(min-width:48rem)]:col-span-1 [@container(min-width:48rem)]:col-start-4 [@container(min-width:48rem)]:row-start-1";
const PHONE_TYPE_CLASS_NAME: string = "[@container(min-width:48rem)]:hidden";
const ACTION_CELL_CLASS_NAME: string =
  "col-span-2 row-start-4 flex [@container(min-width:48rem)]:col-span-1 [@container(min-width:48rem)]:col-start-5 [@container(min-width:48rem)]:row-start-1 [@container(min-width:48rem)]:justify-end";
const MENU_CELL_CLASS_NAME: string =
  "col-start-2 row-start-1 -my-1 [@container(min-width:48rem)]:col-start-6";
const FULL_LINE_CLASS_NAME: string =
  "col-span-2 [@container(min-width:48rem)]:col-span-full";

export const MULTI_SNMP_WALK_TABLE_CLASS_NAME: string =
  "mt-3 [@container(min-width:48rem)]:grid [@container(min-width:48rem)]:grid-cols-[minmax(0,4fr)_minmax(6.5rem,auto)_minmax(7rem,auto)_minmax(0,3fr)_auto_auto] [@container(min-width:48rem)]:gap-x-4";

interface TypeProps {
  labels: Array<string>;
  testId: string;
}

const ComparisonRowType: FunctionComponent<TypeProps> = (
  props: TypeProps,
): ReactElement => {
  return (
    <span className="inline-flex flex-wrap gap-1" data-testid={props.testId}>
      {props.labels.map((label: string): ReactElement => {
        return (
          <span
            key={label}
            className="inline-flex shrink-0 whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700"
          >
            {label}
          </span>
        );
      })}
    </span>
  );
};

interface ValuesProps {
  values: ComparisonValues | undefined;
  translator: Translator;
}

/*
 * The devices' values in a few words: the value when they agree, the
 * lowest and highest of numbers that differ, how many values otherwise.
 * Each device's own value is a click away, under "Answered by".
 */
const ComparisonRowValues: FunctionComponent<ValuesProps> = (
  props: ValuesProps,
): ReactElement => {
  const { values, translator } = props;

  if (!values) {
    return <></>;
  }

  if (values.kind === ComparisonValuesKind.Same) {
    return (
      <SnmpWalkRowValue
        view={toSnmpWalkRowView(values.row, translator)}
        translator={translator}
      />
    );
  }

  if (values.kind === ComparisonValuesKind.Range) {
    return (
      <span
        className="text-sm text-gray-900 [overflow-wrap:anywhere]"
        data-testid="multi-snmp-walk-row-range"
      >
        {translator.translateTemplate("{{low}} to {{high}}", {
          low: formatComparisonNumber(values.low, translator),
          high: formatComparisonNumber(values.high, translator),
        })}
      </span>
    );
  }

  return (
    <span
      className="text-sm italic text-gray-500"
      data-testid="multi-snmp-walk-row-different"
    >
      {translator.translatePlural(
        {
          one: "{{count}} different value",
          other: "{{count}} different values",
        },
        values.count,
      )}
    </span>
  );
};

interface RowProps {
  row: SnmpWalkComparisonRow;
  view: SnmpWalkComparisonRowView;
  walks: Array<DeviceWalk>;
  devicesById: Map<string, MultiDeviceSnmpWalkDevice>;
  collect: ComparisonCollectState;
  canCollect: boolean;
  canCollectOnTemplate: boolean;
  collectingOid?: string | undefined;
  notice?: MultiDeviceSnmpWalkNotice | undefined;
  onCollect: (row: SnmpWalkComparisonRow, deviceIds: Array<string>) => void;
  onCollectOnTemplate: (
    row: SnmpWalkComparisonRow,
    target: ComparisonTemplateTarget,
  ) => void;
  getDeviceWalkRoute: (deviceId: string) => Route;
  translator: Translator;
}

/*
 * "Answered by 11 of 12 devices": the devices whose walk reached the OID,
 * so a walk that stopped before it is not counted as a device without it.
 */
function describeAnsweredBy(
  row: SnmpWalkComparisonRow,
  translator: Translator,
): string {
  return translator.translatePlural(
    {
      one: "{{answered}} of {{count}} device",
      other: "{{answered}} of {{count}} devices",
    },
    row.reachedCount,
    { answered: translator.formatNumber(row.answers.length) },
  );
}

const ComparisonResultRow: FunctionComponent<RowProps> = (
  props: RowProps,
): ReactElement => {
  const { row, view, collect, translator } = props;
  const clipboard: ClipboardCopy = useClipboardCopy({ copiedForMs: 1500 });
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const answersId: string = useId();
  const labels: SnmpWalkRowLabels = getSnmpWalkRowLabels(view, translator);
  const values: ComparisonValues | undefined = useMemo(() => {
    return summarizeComparisonValues(row.answers);
  }, [row]);

  const isCollecting: boolean = props.collectingOid === row.oid;
  const collectedCount: number = collect.collectedDeviceIds.length;
  const answeredCount: number = row.answers.length;
  const isCollectedEverywhere: boolean =
    collectedCount > 0 && collectedCount === answeredCount;
  const canCollect: boolean =
    props.canCollect && collect.collectableDeviceIds.length > 0;
  const notReachedCount: number = props.walks.length - row.reachedCount;

  const menuItems: Array<ReactElement> = [
    <MoreMenuItem
      key="copy"
      icon={IconProp.Copy}
      text={
        clipboard.isCopied
          ? translator.translateText("Copied!")!
          : clipboard.isFailed
            ? translator.translateText("Copy failed")!
            : translator.translateText("Copy OID")!
      }
      onClick={() => {
        clipboard.copy(row.oid).catch(() => {
          // useClipboardCopy says itself when the browser refused.
        });
      }}
    />,
  ];

  if (props.canCollectOnTemplate) {
    for (const target of collect.templates) {
      menuItems.push(
        <MoreMenuItem
          key={`collect-on-template-${target.templateId}`}
          icon={IconProp.Layers}
          text={translator.translateTemplate(
            "Collect on every device using {{template}}",
            { template: target.templateName },
          )}
          isDisabled={Boolean(props.collectingOid)}
          onClick={() => {
            props.onCollectOnTemplate(row, target);
          }}
        />,
      );
    }
  }

  const isNoticeHere: boolean = Boolean(
    props.notice && props.notice.oid === row.oid,
  );

  return (
    <li
      className={MULTI_SNMP_WALK_ROW_CLASS_NAME}
      data-testid="multi-snmp-walk-row"
      data-oid={row.oid}
    >
      <div className={NAME_CELL_CLASS_NAME}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={`font-medium text-gray-900 [overflow-wrap:anywhere] ${
              labels.isTitleTheOid ? "font-mono text-xs" : "text-sm"
            }`}
            data-testid="multi-snmp-walk-row-name"
          >
            {labels.title}
          </span>
          {labels.titleModule ? (
            <span className="text-xs text-gray-400">{labels.titleModule}</span>
          ) : (
            <></>
          )}
          {collectedCount > 0 ? (
            <span
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700"
              data-testid="multi-snmp-walk-row-collected"
            >
              <Icon icon={IconProp.Check} className="h-3 w-3" />
              {isCollectedEverywhere
                ? translator.translateText("Collected")
                : translator.translateTemplate(
                    "Collected on {{collected}} of {{total}}",
                    {
                      collected: translator.formatNumber(collectedCount),
                      total: translator.formatNumber(answeredCount),
                    },
                  )}
            </span>
          ) : (
            <></>
          )}
        </div>
        {labels.mibName ? (
          <div className="mt-0.5 text-xs text-gray-500 [overflow-wrap:anywhere]">
            {labels.mibName}
          </div>
        ) : (
          <></>
        )}
        {labels.isTitleTheOid ? (
          <></>
        ) : (
          <div
            className="mt-0.5 font-mono text-xs text-gray-500 [overflow-wrap:anywhere]"
            data-testid="multi-snmp-walk-row-oid"
          >
            {row.oid}
          </div>
        )}
        {labels.source ? (
          <div className="mt-0.5 text-xs text-gray-500">{labels.source}</div>
        ) : (
          <></>
        )}
      </div>
      <div className={TYPE_CELL_CLASS_NAME}>
        <ComparisonRowType
          labels={view.typeLabels}
          testId="multi-snmp-walk-row-type"
        />
      </div>
      <div className={ANSWERED_CELL_CLASS_NAME}>
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            answeredCount < row.reachedCount
              ? "text-amber-700 hover:text-amber-800"
              : "text-gray-900 hover:text-indigo-700"
          }`}
          aria-expanded={isExpanded}
          aria-controls={answersId}
          data-testid="multi-snmp-walk-row-answered"
          onClick={() => {
            setIsExpanded(!isExpanded);
          }}
        >
          <span className="[overflow-wrap:anywhere]">
            {describeAnsweredBy(row, translator)}
          </span>
          <Icon
            icon={isExpanded ? IconProp.ChevronUp : IconProp.ChevronDown}
            className="h-4 w-4 shrink-0 text-gray-500"
          />
        </button>
        {notReachedCount > 0 ? (
          <div
            className="mt-0.5 text-xs text-gray-500"
            data-testid="multi-snmp-walk-row-not-reached"
          >
            {translator.translatePlural(
              {
                one: "{{count}} walk stopped before it",
                other: "{{count}} walks stopped before it",
              },
              notReachedCount,
            )}
          </div>
        ) : (
          <></>
        )}
      </div>
      <div className={VALUE_CELL_CLASS_NAME}>
        <div className={PHONE_TYPE_CLASS_NAME}>
          <ComparisonRowType
            labels={view.typeLabels}
            testId="multi-snmp-walk-row-type-phone"
          />
        </div>
        <ComparisonRowValues values={values} translator={translator} />
      </div>
      {canCollect ? (
        <div className={ACTION_CELL_CLASS_NAME}>
          <Button
            title={translator.translatePlural(
              {
                one: "Collect on {{count}} device",
                other: "Collect on {{count}} devices",
              },
              collect.collectableDeviceIds.length,
            )}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.NORMAL}
            dataTestId="multi-snmp-walk-row-collect"
            className="!ml-0 !w-auto whitespace-nowrap !text-sm"
            isLoading={isCollecting}
            disabled={Boolean(props.collectingOid) && !isCollecting}
            tooltip="Collect this OID on every poll of the devices that answer it, so it is charted and can be alerted on."
            onClick={() => {
              props.onCollect(row, collect.collectableDeviceIds);
            }}
          />
        </div>
      ) : (
        <></>
      )}
      <div className={MENU_CELL_CLASS_NAME}>
        <MoreMenu
          text=""
          ariaLabel={translator.translateTemplate("More actions for {{oid}}", {
            oid: row.oid,
          })}
          isAriaLabelTranslated={true}
          menuIcon={IconProp.EllipsisHorizontal}
          isMenuPortaled={true}
          dataTestId="multi-snmp-walk-row-more"
        >
          {menuItems}
        </MoreMenu>
      </div>
      {isNoticeHere && props.notice ? (
        <div
          className={`${FULL_LINE_CLASS_NAME} flex items-start gap-1.5 text-xs ${
            props.notice.kind === "error" ? "text-red-700" : "text-gray-600"
          }`}
          data-testid="multi-snmp-walk-collect-notice"
          role={props.notice.kind === "success" ? "status" : "alert"}
        >
          <Icon
            icon={
              props.notice.kind === "success"
                ? IconProp.CheckCircle
                : IconProp.Alert
            }
            className={`mt-px h-4 w-4 shrink-0 ${
              props.notice.kind === "success"
                ? "text-green-600"
                : props.notice.kind === "warning"
                  ? "text-amber-600"
                  : "text-red-600"
            }`}
          />
          <div className="min-w-0">
            <p className="[overflow-wrap:anywhere]">{props.notice.text}</p>
            {props.notice.failures && props.notice.failures.length > 0 ? (
              <ul
                className="mt-1 space-y-0.5"
                data-testid="multi-snmp-walk-collect-failures"
              >
                {props.notice.failures.map(
                  (
                    failure: { deviceName: string; message: string },
                    index: number,
                  ): ReactElement => {
                    return (
                      <li key={index} className="[overflow-wrap:anywhere]">
                        <span className="font-medium text-gray-900">
                          {failure.deviceName}
                        </span>
                        {": "}
                        {failure.message}
                      </li>
                    );
                  },
                )}
              </ul>
            ) : (
              <></>
            )}
          </div>
        </div>
      ) : (
        <></>
      )}
      {isExpanded ? (
        <ul
          id={answersId}
          className={`${FULL_LINE_CLASS_NAME} divide-y divide-gray-100 rounded-md border border-gray-200 bg-gray-50 px-3`}
          data-testid="multi-snmp-walk-row-answers"
        >
          {props.walks.map((walk: DeviceWalk): ReactElement => {
            const device: MultiDeviceSnmpWalkDevice | undefined =
              props.devicesById.get(walk.deviceId);
            const answer: DeviceAnswerForOid = getDeviceAnswerForOid({
              walk: walk,
              row: row,
            });
            const isCollectedHere: boolean =
              collect.collectedDeviceIds.includes(walk.deviceId);

            return (
              <li
                key={walk.deviceId}
                className="flex flex-col gap-1 py-2 sm:flex-row sm:items-start sm:gap-4"
                data-testid="multi-snmp-walk-row-answer"
                data-device-id={walk.deviceId}
                data-answer={answer.kind}
              >
                <div className="min-w-0 sm:w-56 sm:shrink-0">
                  <Link
                    to={props.getDeviceWalkRoute(walk.deviceId)}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-800 [overflow-wrap:anywhere]"
                  >
                    {device?.name || walk.deviceId}
                  </Link>
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
                  {answer.kind === DeviceAnswerKind.Answered ? (
                    <SnmpWalkRowValue
                      view={toSnmpWalkRowView(answer.row, translator)}
                      translator={translator}
                    />
                  ) : answer.kind === DeviceAnswerKind.Missing ? (
                    <span className="text-sm text-amber-700">
                      {translator.translateText("Not answered")}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-500">
                      {translator.translateText(
                        "The walk stopped before this OID",
                      )}
                    </span>
                  )}
                  {isCollectedHere ? (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      <Icon icon={IconProp.Check} className="h-3 w-3" />
                      {translator.translateText("Collected")}
                    </span>
                  ) : (
                    <></>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <></>
      )}
    </li>
  );
};

const MultiDeviceSnmpWalkResults: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [query, setQuery] = useState<string>("");
  const [isOnlyMissingOnSome, setIsOnlyMissingOnSome] =
    useState<boolean>(false);
  const [shownCount, setShownCount] = useState<number>(SNMP_WALK_ROWS_PER_PAGE);

  const matching: Array<SnmpWalkComparisonRow> = useMemo(() => {
    return filterComparisonRows({
      rows: props.rows,
      views: props.views,
      query: query,
      onlyMissingOnSome: isOnlyMissingOnSome,
    });
  }, [props.rows, props.views, query, isOnlyMissingOnSome]);

  // A new filter starts from the top again.
  useEffect(() => {
    setShownCount(SNMP_WALK_ROWS_PER_PAGE);
  }, [query, isOnlyMissingOnSome]);

  const shown: Array<SnmpWalkComparisonRow> = matching.slice(0, shownCount);
  const isEveryMatchShown: boolean = matching.length <= shown.length;
  const isFiltered: boolean = Boolean(query.trim()) || isOnlyMissingOnSome;

  return (
    <div
      className={RESULTS_CONTAINER_CLASS_NAME}
      data-testid="multi-snmp-walk-results"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
        <div className="w-full max-w-md">
          <Input
            isSearchOrFilter={true}
            value={query}
            placeholder="Filter by OID, name or value"
            ariaLabel="Filter the walked OIDs"
            dataTestId="multi-snmp-walk-filter"
            onChange={(value: string) => {
              setQuery(value);
            }}
          />
        </div>
        <Checkbox
          title="Only OIDs some devices do not answer"
          value={isOnlyMissingOnSome}
          dataTestId="multi-snmp-walk-only-missing"
          onChange={(value: boolean) => {
            setIsOnlyMissingOnSome(value);
          }}
        />
      </div>

      {isFiltered ? (
        <p
          className="mt-2 text-xs text-gray-500"
          data-testid="multi-snmp-walk-filter-count"
        >
          {translator.translatePlural(
            {
              one: "{{count}} of {{total}} OIDs matches.",
              other: "{{count}} of {{total}} OIDs match.",
            },
            matching.length,
            { total: translator.formatNumber(props.rows.length) },
          )}
        </p>
      ) : (
        <></>
      )}

      {shown.length === 0 ? (
        <p
          className="py-6 text-center text-sm text-gray-500 [overflow-wrap:anywhere]"
          data-testid="multi-snmp-walk-no-match"
        >
          {query.trim()
            ? translator.translateTemplate('No OIDs match "{{query}}".', {
                query: query.trim(),
              })
            : translator.translateText(
                "Every device whose walk reached an OID answers it.",
              )}
        </p>
      ) : (
        <div
          className={MULTI_SNMP_WALK_TABLE_CLASS_NAME}
          data-testid="multi-snmp-walk-table"
        >
          <div
            className="border-b border-gray-200 pb-2 text-xs font-medium uppercase tracking-wide text-gray-500 [@container(max-width:47.99rem)]:hidden [@container(min-width:48rem)]:col-span-full [@container(min-width:48rem)]:grid [@container(min-width:48rem)]:grid-cols-subgrid [@container(min-width:48rem)]:gap-x-4"
            aria-hidden="true"
            data-testid="multi-snmp-walk-results-header"
          >
            <span>{translator.translateText("OID")}</span>
            <span>{translator.translateText("Type")}</span>
            <span>{translator.translateText("Answered by")}</span>
            <span>{translator.translateText("Value")}</span>
          </div>
          <ul
            className="divide-y divide-gray-100 [@container(min-width:48rem)]:col-span-full [@container(min-width:48rem)]:grid [@container(min-width:48rem)]:grid-cols-subgrid"
            data-testid="multi-snmp-walk-rows"
          >
            {shown.map((row: SnmpWalkComparisonRow): ReactElement => {
              return (
                <ComparisonResultRow
                  key={row.oid}
                  row={row}
                  view={props.views.get(row.oid)!}
                  walks={props.walks}
                  devicesById={props.devicesById}
                  collect={getComparisonCollectState({
                    row: row,
                    devicesById: props.devicesById,
                    collectedOidsByDevice: props.collectedOidsByDevice,
                  })}
                  canCollect={props.canCollect}
                  canCollectOnTemplate={props.canCollectOnTemplate}
                  collectingOid={props.collectingOid}
                  notice={props.notice}
                  onCollect={props.onCollect}
                  onCollectOnTemplate={props.onCollectOnTemplate}
                  getDeviceWalkRoute={props.getDeviceWalkRoute}
                  translator={translator}
                />
              );
            })}
          </ul>
        </div>
      )}

      {isEveryMatchShown ? (
        <></>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
          <span className="text-xs text-gray-500">
            {translator.translateTemplate("Showing {{shown}} of {{total}}", {
              shown: translator.formatNumber(shown.length),
              total: translator.formatNumber(matching.length),
            })}
          </span>
          <Button
            title={translator.translateTemplate("Show {{count}} more", {
              count: translator.formatNumber(
                Math.min(
                  SNMP_WALK_ROWS_PER_PAGE,
                  matching.length - shown.length,
                ),
              ),
            })}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.NORMAL}
            className="!ml-0 !w-auto !text-sm"
            dataTestId="multi-snmp-walk-show-more"
            onClick={() => {
              setShownCount((count: number) => {
                return count + SNMP_WALK_ROWS_PER_PAGE;
              });
            }}
          />
        </div>
      )}
    </div>
  );
};

export default MultiDeviceSnmpWalkResults;
