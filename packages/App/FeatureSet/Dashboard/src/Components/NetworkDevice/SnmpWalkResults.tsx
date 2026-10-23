import {
  SNMP_WALK_ROWS_PER_PAGE,
  SNMP_WALK_VALUE_PREVIEW_LENGTH,
  SnmpWalkRowLabels,
  SnmpWalkRowView,
  filterSnmpWalkRows,
  getSnmpWalkRowLabels,
} from "./SnmpWalkViewModel";
import { SnmpWalkRow } from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import useClipboardCopy, {
  ClipboardCopy,
} from "Common/UI/Utils/UseClipboardCopy";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * What a walk of a device read (issue #5184), one OID a row: its name from
 * the MIBs OneUptime knows (a vendor template's name for it first), its
 * type, its value - and what can be done with it: collect it on every poll,
 * then alert on it.
 *
 * Rows rather than a table, each its own grid with fixed column widths so
 * the columns line up: from md, OID | type | value | monitoring; on a phone,
 * the name with its actions beside it, and the type and value under it - a
 * small card per OID instead of a table scrolling sideways. A walk can hold
 * thousands of OIDs, so SNMP_WALK_ROWS_PER_PAGE are drawn at a time.
 */

/*
 * The columns, shared by the header and every row so they line up. The
 * monitoring column is wide enough for "Collected", "Alert on it" and the
 * ⋯ menu on one line in English, and wraps rather than widens in a longer
 * language.
 */
const ROW_GRID: string =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 md:grid-cols-[minmax(0,5fr)_7rem_minmax(0,5fr)_12.5rem] md:gap-x-4";

export interface SnmpWalkRowActions {
  // The OIDs the device already collects, normalized.
  collectedOids: Set<string>;
  // Hidden when the reader may not change the device, or nothing polls it.
  canCollect: boolean;
  // The device's OID Collection Template, when it has one.
  templateName?: string | undefined;
  canCollectOnTemplate: boolean;
  // The OID being collected right now.
  collectingOid?: string | undefined;
  onCollect: (row: SnmpWalkRow) => void;
  onCollectOnTemplate: (row: SnmpWalkRow) => void;
  // Where "Alert on it" goes for a collected OID; undefined hides it.
  getAlertRoute?: ((row: SnmpWalkRow) => Route) | undefined;
}

export interface ComponentProps {
  rows: Array<SnmpWalkRow>;
  views: Array<SnmpWalkRowView>;
  actions: SnmpWalkRowActions;
}

interface RowProps {
  row: SnmpWalkRow;
  view: SnmpWalkRowView;
  actions: SnmpWalkRowActions;
  translator: Translator;
}

interface PartProps {
  view: SnmpWalkRowView;
  translator: Translator;
}

const SnmpWalkRowName: FunctionComponent<PartProps> = (
  props: PartProps,
): ReactElement => {
  const labels: SnmpWalkRowLabels = getSnmpWalkRowLabels(
    props.view,
    props.translator,
  );

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={`font-medium text-gray-900 [overflow-wrap:anywhere] ${
            labels.isTitleTheOid ? "font-mono text-xs" : "text-sm"
          }`}
          data-testid="snmp-walk-row-name"
        >
          {labels.title}
        </span>
        {labels.titleModule ? (
          <span className="text-xs text-gray-400">{labels.titleModule}</span>
        ) : (
          <></>
        )}
      </div>
      {labels.mibName ? (
        <div
          className="mt-0.5 text-xs text-gray-500 [overflow-wrap:anywhere]"
          data-testid="snmp-walk-row-mib-name"
        >
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
          data-testid="snmp-walk-row-oid"
        >
          {props.view.oid}
        </div>
      )}
      {labels.source ? (
        <div
          className="mt-0.5 text-xs text-gray-500"
          data-testid="snmp-walk-row-source"
        >
          {labels.source}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

interface TypeProps {
  view: SnmpWalkRowView;
  testId: string;
}

const SnmpWalkRowType: FunctionComponent<TypeProps> = (
  props: TypeProps,
): ReactElement => {
  return (
    <span
      className="inline-flex shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700"
      data-testid={props.testId}
    >
      {props.view.typeLabel}
    </span>
  );
};

const SnmpWalkRowValue: FunctionComponent<PartProps> = (
  props: PartProps,
): ReactElement => {
  const view: SnmpWalkRowView = props.view;
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  if (view.isNull) {
    return (
      <span className="text-sm text-gray-400" data-testid="snmp-walk-row-value">
        —
      </span>
    );
  }

  if (view.valueText === "") {
    return (
      <span
        className="text-sm italic text-gray-400"
        data-testid="snmp-walk-row-value"
      >
        {props.translator.translateText("Empty")}
      </span>
    );
  }

  const isLong: boolean =
    view.valueText.length > SNMP_WALK_VALUE_PREVIEW_LENGTH;
  const shownText: string =
    isLong && !isExpanded
      ? `${view.valueText.substring(0, SNMP_WALK_VALUE_PREVIEW_LENGTH)}…`
      : `${view.valueText}${view.isCut ? "…" : ""}`;

  return (
    <div className="min-w-0">
      <span
        className={`whitespace-pre-wrap text-gray-900 [overflow-wrap:anywhere] ${
          view.isMonospace ? "font-mono text-xs" : "text-sm"
        }`}
        data-testid="snmp-walk-row-value"
      >
        {shownText}
      </span>
      {view.durationText ? (
        <span
          className="ml-2 whitespace-nowrap text-xs text-gray-500"
          data-testid="snmp-walk-row-duration"
        >
          {view.durationText}
        </span>
      ) : (
        <></>
      )}
      {isLong ? (
        <button
          type="button"
          className="ml-2 text-xs font-medium text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:underline"
          data-testid="snmp-walk-row-value-toggle"
          aria-expanded={isExpanded}
          onClick={() => {
            setIsExpanded(!isExpanded);
          }}
        >
          {isExpanded
            ? props.translator.translateText("Show less")
            : props.translator.translateText("Show all")}
        </button>
      ) : (
        <></>
      )}
      {view.isCut && (isExpanded || !isLong) ? (
        <span className="mt-0.5 block text-xs text-gray-500">
          {props.translator.translateText(
            "The device's value is longer: the walk keeps its first 1,024 characters.",
          )}
        </span>
      ) : (
        <></>
      )}
    </div>
  );
};

const SnmpWalkResultRow: FunctionComponent<RowProps> = (
  props: RowProps,
): ReactElement => {
  const { row, view, actions, translator } = props;
  const clipboard: ClipboardCopy = useClipboardCopy({ copiedForMs: 1500 });
  const isCollected: boolean = actions.collectedOids.has(view.oid);
  const isCollecting: boolean = actions.collectingOid === view.oid;
  const alertRoute: Route | undefined = isCollected
    ? actions.getAlertRoute?.(row)
    : undefined;

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
        clipboard.copy(view.oid).catch(() => {
          // useClipboardCopy says itself when the browser refused.
        });
      }}
    />,
  ];

  if (actions.canCollectOnTemplate && actions.templateName && !isCollected) {
    menuItems.push(
      <MoreMenuItem
        key="collect-on-template"
        icon={IconProp.Template}
        text={translator.translateTemplate(
          "Collect on every device using {{template}}",
          { template: actions.templateName },
        )}
        isDisabled={Boolean(actions.collectingOid)}
        onClick={() => {
          actions.onCollectOnTemplate(row);
        }}
      />,
    );
  }

  return (
    <li
      className={`${ROW_GRID} py-3 md:items-start`}
      data-testid="snmp-walk-row"
      data-oid={view.oid}
    >
      <div className="col-start-1 row-start-1 min-w-0">
        <SnmpWalkRowName view={view} translator={translator} />
      </div>
      <div className="max-md:hidden md:col-start-2 md:row-start-1">
        <SnmpWalkRowType view={view} testId="snmp-walk-row-type" />
      </div>
      <div className="col-span-2 row-start-2 flex min-w-0 items-start gap-2 md:col-span-1 md:col-start-3 md:row-start-1">
        {/*
         * On a phone the type sits before the value, on one line, instead
         * of taking a line of its own; from md it has its column.
         */}
        <div className="md:hidden">
          <SnmpWalkRowType view={view} testId="snmp-walk-row-type-phone" />
        </div>
        <SnmpWalkRowValue view={view} translator={translator} />
      </div>
      {/*
       * The ⋯ menu keeps its corner; what is beside it wraps under itself
       * rather than pushing the menu onto a line of its own.
       */}
      <div className="col-start-2 row-start-1 flex items-start justify-end gap-2 md:col-start-4">
        <div className="flex min-h-[1.75rem] flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {isCollected ? (
            <span
              className="inline-flex items-center gap-1 text-xs font-medium text-green-700"
              data-testid="snmp-walk-row-collected"
            >
              <Icon icon={IconProp.Check} className="h-3.5 w-3.5" />
              {translator.translateText("Collected")}
            </span>
          ) : actions.canCollect ? (
            <Button
              title="Collect"
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.NORMAL}
              dataTestId="snmp-walk-row-collect"
              className="!ml-0"
              isLoading={isCollecting}
              disabled={Boolean(actions.collectingOid) && !isCollecting}
              tooltip="Collect this OID on every poll, so it is charted and can be alerted on."
              onClick={() => {
                actions.onCollect(row);
              }}
            />
          ) : (
            <></>
          )}
          {alertRoute ? (
            <Link
              to={alertRoute}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
              dataTestId="snmp-walk-row-alert"
            >
              {translator.translateText("Alert on it")}
            </Link>
          ) : (
            <></>
          )}
        </div>
        <MoreMenu
          text=""
          ariaLabel={translator.translateTemplate("More actions for {{oid}}", {
            oid: view.oid,
          })}
          menuIcon={IconProp.EllipsisHorizontal}
          isMenuPortaled={true}
          dataTestId="snmp-walk-row-more"
        >
          {menuItems}
        </MoreMenu>
      </div>
    </li>
  );
};

const SnmpWalkResults: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [query, setQuery] = useState<string>("");
  const [shownCount, setShownCount] = useState<number>(SNMP_WALK_ROWS_PER_PAGE);

  const rowsByOid: Map<string, SnmpWalkRow> = useMemo(() => {
    return new Map(
      props.rows.map((row: SnmpWalkRow): [string, SnmpWalkRow] => {
        return [row.oid, row];
      }),
    );
  }, [props.rows]);

  const matching: Array<SnmpWalkRowView> = useMemo(() => {
    return filterSnmpWalkRows(props.views, query);
  }, [props.views, query]);

  // A new filter starts from the top again.
  useEffect(() => {
    setShownCount(SNMP_WALK_ROWS_PER_PAGE);
  }, [query]);

  const shown: Array<SnmpWalkRowView> = matching.slice(0, shownCount);

  return (
    <div data-testid="snmp-walk-results">
      <div className="max-w-md">
        <Input
          value={query}
          placeholder="Filter by OID, name or value"
          ariaLabel="Filter the walked OIDs"
          dataTestId="snmp-walk-filter"
          onChange={(value: string) => {
            setQuery(value);
          }}
        />
      </div>

      {query.trim() ? (
        <p
          className="mt-2 text-xs text-gray-500"
          data-testid="snmp-walk-filter-count"
        >
          {translator.translatePlural(
            {
              one: "{{count}} of {{total}} OIDs matches.",
              other: "{{count}} of {{total}} OIDs match.",
            },
            matching.length,
            { total: translator.formatNumber(props.views.length) },
          )}
        </p>
      ) : (
        <></>
      )}

      <div
        className={`${ROW_GRID} mt-3 border-b border-gray-200 pb-2 text-xs font-medium uppercase tracking-wide text-gray-500 max-md:hidden`}
        aria-hidden="true"
      >
        <span>{translator.translateText("OID")}</span>
        <span>{translator.translateText("Type")}</span>
        <span>{translator.translateText("Value")}</span>
        <span className="text-right">
          {translator.translateText("Monitoring")}
        </span>
      </div>

      {shown.length === 0 ? (
        <p
          className="py-6 text-center text-sm text-gray-500"
          data-testid="snmp-walk-no-match"
        >
          {translator.translateTemplate('No OIDs match "{{query}}".', {
            query: query.trim(),
          })}
        </p>
      ) : (
        <ul
          className="divide-y divide-gray-100 max-md:mt-2"
          data-testid="snmp-walk-rows"
        >
          {shown.map((view: SnmpWalkRowView): ReactElement => {
            return (
              <SnmpWalkResultRow
                key={view.oid}
                row={rowsByOid.get(view.oid)!}
                view={view}
                actions={props.actions}
                translator={translator}
              />
            );
          })}
        </ul>
      )}

      {matching.length > shown.length ? (
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
            className="!ml-0"
            dataTestId="snmp-walk-show-more"
            onClick={() => {
              setShownCount((count: number) => {
                return count + SNMP_WALK_ROWS_PER_PAGE;
              });
            }}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SnmpWalkResults;
