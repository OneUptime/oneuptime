import PageComponentProps from "../PageComponentProps";
import ExceptionSegmentedControl, {
  SegmentedControlOption,
} from "../../Components/Exceptions/ExceptionSegmentedControl";
import SecurityEventSeverityPill from "../../Components/SecurityEvents/SecurityEventSeverityPill";
import SecurityCaseApi, {
  EntityActivity,
  EntityFindingSummary,
} from "../../Components/SecurityCase/SecurityCaseApi";
import {
  SecurityEntityChip,
  getCorrelateRouteForEntity,
} from "../../Components/SecurityCase/SecurityEntityChips";
import { describeSetupCallFailure } from "../../Components/SecurityOverview/SecuritySetupModel";
import {
  DEFAULT_ENTITY_WINDOW_IN_DAYS,
  ENTITIES_EMPTY_DESCRIPTION,
  ENTITIES_EMPTY_TITLE,
  ENTITY_WINDOW_LABEL,
  OPEN_IN_CORRELATE,
  RISKIEST_ENTITIES_DESCRIPTION,
  getEntityWindowOptionValue,
  readEntityWindowOption,
} from "../../Components/SecurityEvents/SecurityEntitiesCopy";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { ocsfSeverityFromId } from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  SecurityEntity,
  inferSecurityEntityType,
} from "Common/Types/SecurityCase/SecurityEntity";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Button from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Input from "Common/UI/Components/Input/Input";
import { isRowOpeningClick } from "Common/UI/Components/Table/RowClick";
import Table from "Common/UI/Components/Table/Table";
import { useIsTableCard } from "Common/UI/Components/Table/TableCellContext";
import { TableEmptyStateKind } from "Common/UI/Components/Table/TableEmptyState";
import Columns from "Common/UI/Components/Table/Types/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// The windows Riskiest Entities ranks over, in days.
export const ENTITY_WINDOWS_IN_DAYS: Array<number> = [1, 7, 30];

export const RISKIEST_ENTITIES_TABLE_ID: string = "security-riskiest-entities";

function toEntity(value: string): SecurityEntity {
  return { type: inferSecurityEntityType(value), value };
}

function openInCorrelate(value: string): void {
  Navigation.navigate(getCorrelateRouteForEntity(value));
}

/*
 * The entity of a row, and on a phone's card what the table's other
 * columns hold, in a line under it: its worst severity, its findings and
 * rules, and when it was last seen. A card of four labelled fields per
 * entity made ten entities five screens long.
 */
const EntityCell: FunctionComponent<{
  entity: EntityFindingSummary;
}> = (props: { entity: EntityFindingSummary }): ReactElement => {
  const translator: Translator = useTranslator();
  const isCard: boolean = useIsTableCard();

  return (
    <div className="min-w-0 space-y-1">
      <SecurityEntityChip entity={toEntity(props.entity.value)} />
      {isCard ? (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500"
          data-testid="security-entity-card-facts"
        >
          <SecurityEventSeverityPill
            severityName={ocsfSeverityFromId(props.entity.maxSeverityId)}
          />
          <span className="font-semibold text-gray-900">
            {translator.translatePlural(
              { one: "{{count}} finding", other: "{{count}} findings" },
              props.entity.findingCount,
            )}
          </span>
          <span>
            {translator.translatePlural(
              { one: "{{count}} rule", other: "{{count}} rules" },
              props.entity.ruleCount,
            )}
          </span>
          {props.entity.lastSeen ? (
            <span>
              {translator.translateTemplate("Last seen {{when}}", {
                when: OneUptimeDate.fromNow(props.entity.lastSeen),
              })}
            </span>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * Security Events > Entities: the users, hosts, addresses and files the
 * project's findings name most - where to look first, before any case is
 * opened - over the last day, week or month; each opens in Correlate. And
 * a lookup for any value, to see how busy it has been across every
 * security event.
 *
 * The ranking is the shared table (a phone's card per entity, its counts
 * under the value), each row one click from Correlate, as the Overview's
 * Riskiest Entities are. It used to be a table of its own that scrolled
 * sideways on a phone, its rows leading nowhere, under the lookup.
 */
const SecurityEntitiesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [days, setDays] = useState<number>(DEFAULT_ENTITY_WINDOW_IN_DAYS);
  const [entities, setEntities] = useState<Array<EntityFindingSummary>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);
  const [lookupValue, setLookupValue] = useState<string>("");
  const [lookup, setLookup] = useState<EntityActivity | null>(null);
  const [lookupError, setLookupError] = useState<string>("");
  const [isLookingUp, setIsLookingUp] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);

      try {
        const result: Array<EntityFindingSummary> =
          await SecurityCaseApi.getTopEntities({ days, limit: 100 });

        if (isCurrent) {
          setEntities(result);
          setError("");
        }
      } catch (err) {
        // In the product's words: a role's or a plan's sentence, never a gateway's.
        if (isCurrent) {
          setError(describeSetupCallFailure(err));
        }
      }

      if (isCurrent) {
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [days, readCount]);

  const runLookup: () => Promise<void> = async (): Promise<void> => {
    const value: string = lookupValue.trim();

    if (!value) {
      return;
    }

    setIsLookingUp(true);
    setLookupError("");

    try {
      const rows: Array<EntityActivity> =
        await SecurityCaseApi.getEntityActivity({
          values: [value],
          hours: 24 * 30,
        });

      setLookup(
        rows[0] || {
          value,
          eventCount: 0,
          findingCount: 0,
          maxSeverityId: 0,
          firstSeen: null,
          lastSeen: null,
        },
      );
    } catch (err) {
      setLookupError(describeSetupCallFailure(err));
    }

    setIsLookingUp(false);
  };

  const windowOptions: Array<SegmentedControlOption<string>> =
    ENTITY_WINDOWS_IN_DAYS.map(
      (windowInDays: number): SegmentedControlOption<string> => {
        return {
          value: getEntityWindowOptionValue(windowInDays),
          label: translator.translatePlural(
            { one: "{{count}} day", other: "{{count}} days" },
            windowInDays,
          ),
        };
      },
    );

  const columns: Columns<EntityFindingSummary> = [
    {
      title: "Entity",
      type: FieldType.Element,
      key: "value",
      disableSort: true,
      hideTitleOnMobile: true,
      getElement: (entity: EntityFindingSummary): ReactElement => {
        return <EntityCell entity={entity} />;
      },
    },
    {
      title: "Findings",
      type: FieldType.Element,
      key: "findingCount",
      disableSort: true,
      hideOnMobile: true,
      getElement: (entity: EntityFindingSummary): ReactElement => {
        return (
          <span className="font-semibold tabular-nums text-gray-900">
            {translator.formatNumber(entity.findingCount)}
          </span>
        );
      },
    },
    {
      title: "Rules",
      type: FieldType.Element,
      key: "ruleCount",
      disableSort: true,
      hideOnMobile: true,
      getElement: (entity: EntityFindingSummary): ReactElement => {
        return (
          <span className="tabular-nums text-gray-700">
            {translator.formatNumber(entity.ruleCount)}
          </span>
        );
      },
    },
    {
      title: "Worst Severity",
      type: FieldType.Element,
      key: "maxSeverityId",
      disableSort: true,
      hideOnMobile: true,
      getElement: (entity: EntityFindingSummary): ReactElement => {
        return (
          <SecurityEventSeverityPill
            severityName={ocsfSeverityFromId(entity.maxSeverityId)}
          />
        );
      },
    },
    {
      title: "Last Seen",
      type: FieldType.Element,
      key: "lastSeen",
      disableSort: true,
      hideOnMobile: true,
      getElement: (entity: EntityFindingSummary): ReactElement => {
        return entity.lastSeen ? (
          <span
            className="text-gray-600"
            title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              entity.lastSeen,
            )}
          >
            {OneUptimeDate.fromNow(entity.lastSeen)}
          </span>
        ) : (
          <span className="text-gray-400">-</span>
        );
      },
    },
    // Where a row's Open in Correlate is drawn.
    {
      title: "Actions",
      type: FieldType.Actions,
      key: null,
    },
  ];

  return (
    <div className="space-y-6">
      <Card
        title="Riskiest Entities"
        description={RISKIEST_ENTITIES_DESCRIPTION}
        headerLayout="stacked"
        rightElement={
          <ExceptionSegmentedControl<string>
            label={ENTITY_WINDOW_LABEL}
            options={windowOptions}
            value={getEntityWindowOptionValue(days)}
            testId="security-entities-window"
            onChange={(value: string) => {
              setDays(readEntityWindowOption(value, ENTITY_WINDOWS_IN_DAYS));
            }}
          />
        }
      >
        <Table<EntityFindingSummary>
          id={RISKIEST_ENTITIES_TABLE_ID}
          data={isLoading ? [] : entities}
          columns={columns}
          singularLabel="Entity"
          pluralLabel="Entities"
          isLoading={isLoading}
          error={error}
          onRefreshClick={() => {
            setReadCount((count: number): number => {
              return count + 1;
            });
          }}
          emptyStateProps={{
            kind: TableEmptyStateKind.Empty,
            icon: IconProp.Fingerprint,
            title: ENTITIES_EMPTY_TITLE,
            description: ENTITIES_EMPTY_DESCRIPTION,
            isCompact: true,
            dataTestId: "security-entities-empty",
          }}
          disablePagination={true}
          currentPageNumber={1}
          totalItemsCount={entities.length}
          itemsOnPage={Math.max(entities.length, 10)}
          onNavigateToPage={() => {
            // The ranking is one page: the most named first.
          }}
          // Ranked by the findings that name each, as the server sends them.
          sortBy={null}
          sortOrder={SortOrder.Descending}
          onSortChanged={() => {
            // No column sorts: the order is the ranking.
          }}
          actionButtons={[
            {
              title: OPEN_IN_CORRELATE,
              icon: IconProp.Share,
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: (
                entity: EntityFindingSummary,
                onCompleteAction: () => void,
              ) => {
                openInCorrelate(entity.value);
                onCompleteAction();
              },
            },
          ]}
          getRowProps={(
            entity: EntityFindingSummary,
          ): React.HTMLAttributes<HTMLElement> => {
            const rowProps: React.HTMLAttributes<HTMLElement> & {
              "data-testid": string;
              "data-row-opens-record": string;
            } = {
              "data-testid": `security-entity-row-${entity.value}`,
              "data-row-opens-record": "true",
              onClick: (event: React.MouseEvent<HTMLElement>): void => {
                if (!isRowOpeningClick(event)) {
                  return;
                }

                openInCorrelate(entity.value);
              },
            };

            return rowProps;
          }}
        />
      </Card>

      <Card
        title="Look Up an Entity"
        description="Any user, host, IP address, domain or file hash: how often it appears in your security events over the last 30 days, and in how many findings."
      >
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <Input
                placeholder="e.g. alice@example.com, web-01 or 203.0.113.7"
                value={lookupValue}
                dataTestId="security-entity-lookup-input"
                onChange={(value: string) => {
                  setLookupValue(value);
                }}
                onEnterPress={() => {
                  void runLookup();
                }}
              />
            </div>
            <Button
              title="Look Up"
              icon={IconProp.MagnifyingGlass}
              buttonStyle={ButtonStyleType.PRIMARY}
              isLoading={isLookingUp}
              disabled={!lookupValue.trim()}
              onClick={() => {
                void runLookup();
              }}
            />
          </div>
          {lookupError ? <ErrorMessage message={lookupError} /> : <></>}
          {lookup ? (
            <div
              className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
              data-testid="security-entity-lookup-result"
            >
              <SecurityEntityChip entity={toEntity(lookup.value)} />
              <span className="text-sm text-gray-700">
                {translator.translatePlural(
                  { one: "{{count}} event", other: "{{count}} events" },
                  lookup.eventCount,
                )}
              </span>
              <span className="text-sm text-gray-700">
                {translator.translatePlural(
                  { one: "{{count}} finding", other: "{{count}} findings" },
                  lookup.findingCount,
                )}
              </span>
              {lookup.lastSeen ? (
                <span className="text-sm text-gray-500">
                  {translator.translateTemplate("Last seen {{when}}", {
                    when: OneUptimeDate.fromNow(lookup.lastSeen),
                  })}
                </span>
              ) : (
                <span className="text-sm text-gray-500">
                  {translator.translateText("Not seen in the last 30 days.")}
                </span>
              )}
              <Button
                title="Open in Correlate"
                icon={IconProp.Share}
                buttonStyle={ButtonStyleType.NORMAL}
                onClick={() => {
                  openInCorrelate(lookup.value);
                }}
              />
            </div>
          ) : (
            <></>
          )}
        </div>
      </Card>
    </div>
  );
};

export default SecurityEntitiesPage;
