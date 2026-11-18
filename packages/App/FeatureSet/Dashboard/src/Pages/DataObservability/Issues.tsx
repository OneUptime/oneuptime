import PageComponentProps from "../PageComponentProps";
import AttentionItemList from "../../Components/DataObservability/AttentionItemList";
import DataObservabilityApi from "../../Components/DataObservability/DataObservabilityApi";
import {
  ANY_ALERT_FILTER,
  DATA_OBSERVABILITY_ISSUES_LIST_ID,
  hasIssuesFilter,
  ISSUE_ALERT_CHOICES,
  ISSUE_KIND_CHOICES,
  ISSUE_PLURAL_LABEL,
  ISSUE_SINGULAR_LABEL,
  IssueChoice,
  IssuesFilter,
  readIssuesFilter,
  toIssuesFilterState,
  toIssuesRequest,
} from "../../Components/DataObservability/IssuesCopy";
import { isStoreWaitingForFirstRead } from "../../Components/DataObservability/StoreStatusPill";
import { DataAttentionKind } from "Common/Types/DataObservability/DataObservabilityAttention";
import {
  DATA_OBSERVABILITY_NO_OWNER_FILTER,
  DataObservabilityIssueAlertFilter,
  DataObservabilityIssueOwner,
  DataObservabilityIssuesResponse,
  DataObservabilityStoreSummary,
  DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE,
} from "Common/Types/DataObservability/DataObservabilityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import Pagination from "Common/UI/Components/Pagination/Pagination";
import TableSkeleton from "Common/UI/Components/Skeleton/TableSkeleton";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import {
  getFilteredEmptyStateProps,
  getLoadErrorStateProps,
} from "Common/UI/Components/Table/TableEmptyStateBuilders";
import { getTableHeaderButtons } from "Common/UI/Components/Table/TableHeaderControls";
import API from "Common/UI/Utils/API/API";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * EVERYTHING THAT NEEDS SOMEONE, FILTERED (#6549).
 *
 * The Overview's Needs Attention shows the most urgent; this lists every
 * one, worst first, a page at a time, each drawn as the Overview draws it
 * (AttentionItemList). Filtered on the server (DataObservabilityIssues) by
 * what kind of thing is wrong, which database, who owns it - or No owner -
 * and whether anyone was told, the filters kept in the address so Back and a
 * shared link open the same list. It opens on everything, and empty says
 * what was looked at and found well, as the Overview does.
 */

export const ISSUES_PAGE_TEST_ID: string = "data-observability-issues";
export const ISSUES_FILTERS_TEST_ID: string =
  "data-observability-issues-filters";

const PICKER_CLASS_NAME: string = "sm:min-w-[11rem] sm:flex-1 xl:max-w-[16rem]";

const DataObservabilityIssuesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [filter, setFilter] = useState<IssuesFilter>(() => {
    return readIssuesFilter(
      TableFilterUrlState.read(DATA_OBSERVABILITY_ISSUES_LIST_ID, "filter"),
    );
  });
  const [page, setPage] = useState<number>(1);
  const [itemsOnPage, setItemsOnPage] = useState<number>(
    DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE,
  );
  const [answer, setAnswer] = useState<DataObservabilityIssuesResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [readCount, setReadCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);

      try {
        const result: DataObservabilityIssuesResponse =
          await DataObservabilityApi.getIssues(
            toIssuesRequest({ filter, page, itemsOnPage }),
          );

        if (isCurrent) {
          setAnswer(result);
          setError("");
        }
      } catch (err) {
        if (isCurrent) {
          setError(API.getFriendlyMessage(err));
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
  }, [JSON.stringify(filter), page, itemsOnPage, readCount]);

  const applyFilter: (next: IssuesFilter) => void = (
    next: IssuesFilter,
  ): void => {
    setFilter(next);
    setPage(1);
    TableFilterUrlState.write(
      DATA_OBSERVABILITY_ISSUES_LIST_ID,
      "filter",
      toIssuesFilterState(next),
    );
  };

  const readAgain: () => void = (): void => {
    setReadCount((count: number): number => {
      return count + 1;
    });
  };

  const stores: Array<DataObservabilityStoreSummary> = answer?.stores || [];
  const owners: Array<DataObservabilityIssueOwner> = answer?.owners || [];

  const kindOptions: Array<DropdownOption> = ISSUE_KIND_CHOICES.map(
    (choice: IssueChoice): DropdownOption => {
      return { value: choice.value, label: choice.label };
    },
  );
  const storeOptions: Array<DropdownOption> = stores.map(
    (store: DataObservabilityStoreSummary): DropdownOption => {
      return {
        value: store.dataStoreId,
        label: store.name,
        isUserContent: true,
      };
    },
  );
  const ownerOptions: Array<DropdownOption> = [
    { value: DATA_OBSERVABILITY_NO_OWNER_FILTER, label: "No owner" },
    ...owners.map((owner: DataObservabilityIssueOwner): DropdownOption => {
      return { value: owner.key, label: owner.name, isUserContent: true };
    }),
  ];

  const renderPicker: (data: {
    options: Array<DropdownOption>;
    picked: string | undefined;
    placeholder: string;
    ariaLabel: string;
    testId: string;
    onPick: (value: string | undefined) => void;
  }) => ReactElement = (data: {
    options: Array<DropdownOption>;
    picked: string | undefined;
    placeholder: string;
    ariaLabel: string;
    testId: string;
    onPick: (value: string | undefined) => void;
  }): ReactElement => {
    return (
      <div className={PICKER_CLASS_NAME}>
        <Dropdown
          options={data.options}
          value={data.options.find((option: DropdownOption): boolean => {
            return option.value === data.picked;
          })}
          placeholder={data.placeholder}
          ariaLabel={data.ariaLabel}
          dataTestId={data.testId}
          isClearable={true}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            data.onPick(value ? String(value) : undefined);
          }}
        />
      </div>
    );
  };

  const cardButtons: Array<CardButtonSchema> = [
    {
      title: "Refresh",
      buttonStyle: ButtonStyleType.ICON,
      icon: IconProp.Refresh,
      onClick: readAgain,
    },
  ];

  const renderList: () => ReactElement = (): ReactElement => {
    if (!answer) {
      return <></>;
    }

    if (answer.items.length === 0 && hasIssuesFilter(filter)) {
      return (
        <TableEmptyState
          {...getFilteredEmptyStateProps({
            title: "No issue matches these filters",
            description:
              "Try another kind, database or owner, or clear the filters to see everything that needs someone.",
            onClear: () => {
              applyFilter({});
            },
          })}
          icon={IconProp.Filter}
          dataTestId="data-observability-issues-empty-filtered"
        />
      );
    }

    if (answer.items.length === 0) {
      // As the Overview says it: what was looked at, and found well.
      return (
        <TableEmptyState
          kind={TableEmptyStateKind.AllClear}
          title="Nothing needs attention right now"
          description={
            stores.some(isStoreWaitingForFirstRead)
              ? "A database just connected is read for the first time within a few minutes, and its tables are watched from then on."
              : "Every database was read, no pipeline run failed, no check is failing, and every table is changing as often as it usually does."
          }
          dataTestId="data-observability-issues-empty"
        />
      );
    }

    return (
      <>
        <AttentionItemList items={answer.items} stores={stores} />
        <Pagination
          currentPageNumber={page}
          totalItemsCount={answer.count}
          itemsOnPage={itemsOnPage}
          itemsOnCurrentPage={answer.items.length}
          onNavigateToPage={(pageNumber: number, pageSize: number) => {
            setPage(pageNumber);
            setItemsOnPage(pageSize);
          }}
          isLoading={isLoading}
          isError={Boolean(error)}
          singularLabel={ISSUE_SINGULAR_LABEL}
          pluralLabel={ISSUE_PLURAL_LABEL}
          dataTestId="data-observability-issues-pagination"
        />
      </>
    );
  };

  return (
    <div data-testid={ISSUES_PAGE_TEST_ID}>
      <Card
        title="Issues"
        description="Everything that needs someone now, worst first: what failed, then what is late. Filter by kind, database, owner, or whether anyone was told."
        buttons={getTableHeaderButtons(cardButtons)}
        headerLayout="toolbar"
      >
        {!answer && isLoading ? <TableSkeleton /> : <></>}

        {!answer && !isLoading && error ? (
          <TableEmptyState
            {...getLoadErrorStateProps({
              pluralLabel: ISSUE_PLURAL_LABEL,
              error: error,
              onRetry: readAgain,
              translate: (text: string): string => {
                return translator.translateText(text) || text;
              },
              translator: translator,
            })}
            dataTestId="data-observability-issues-error"
          />
        ) : (
          <></>
        )}

        {answer ? (
          <div
            className={isLoading ? "opacity-60 transition-opacity" : ""}
            aria-busy={isLoading}
          >
            <div
              className="mb-4 flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center xl:justify-between"
              data-testid={ISSUES_FILTERS_TEST_ID}
            >
              <FilterButtons
                options={ISSUE_ALERT_CHOICES.map((choice: IssueChoice) => {
                  return { value: choice.value, label: choice.label };
                })}
                selectedValue={filter.alert || ANY_ALERT_FILTER}
                ariaLabel="Alert"
                dataTestId="data-observability-issues-alert"
                onSelect={(value: string) => {
                  applyFilter({
                    ...filter,
                    alert:
                      value === ANY_ALERT_FILTER
                        ? undefined
                        : (value as DataObservabilityIssueAlertFilter),
                  });
                }}
                className="flex-wrap xl:flex-shrink-0 xl:flex-nowrap"
              />
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap xl:flex-1 xl:flex-nowrap xl:justify-end">
                {renderPicker({
                  options: kindOptions,
                  picked: filter.kind,
                  placeholder: "All kinds",
                  ariaLabel: "Kind",
                  testId: "data-observability-issues-kind",
                  onPick: (value: string | undefined) => {
                    applyFilter({
                      ...filter,
                      kind: value as DataAttentionKind | undefined,
                    });
                  },
                })}
                {renderPicker({
                  options: storeOptions,
                  picked: filter.dataStoreId,
                  placeholder: "All databases",
                  ariaLabel: "Database",
                  testId: "data-observability-issues-database",
                  onPick: (value: string | undefined) => {
                    applyFilter({ ...filter, dataStoreId: value });
                  },
                })}
                {renderPicker({
                  options: ownerOptions,
                  picked: filter.owner,
                  placeholder: "Anyone",
                  ariaLabel: "Owner",
                  testId: "data-observability-issues-owner",
                  onPick: (value: string | undefined) => {
                    applyFilter({ ...filter, owner: value });
                  },
                })}
              </div>
            </div>

            {renderList()}
          </div>
        ) : (
          <></>
        )}
      </Card>
    </div>
  );
};

export default DataObservabilityIssuesPage;
