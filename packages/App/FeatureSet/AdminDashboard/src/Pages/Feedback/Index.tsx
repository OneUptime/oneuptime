import AdminModelAPI from "../../Utils/ModelAPI";
import PageMap from "../../Utils/PageMap";
import {
  deleteFeedbackAnswer,
  fetchFeedbackList,
  fetchFeedbackSummary,
} from "../../Utils/ProductFeedback";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Route from "Common/Types/API/Route";
import {
  AskAiSourceCount,
  getAskAiSourceTitle,
} from "Common/Types/AI/AskAiRatings";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  AskAiRatedDownAnswer,
  DOCS_FEEDBACK_REASON_TITLES,
  DocsPageFeedbackSummary,
  PRODUCT_FEEDBACK_KIND_TITLES,
  PRODUCT_FEEDBACK_KINDS,
  PRODUCT_FEEDBACK_LIST_PAGE_SIZE,
  PRODUCT_FEEDBACK_RETENTION_IN_DAYS,
  ProductFeedbackAdminSummary,
  ProductFeedbackKind,
  ProductFeedbackListItem,
  ProductFeedbackListPage,
  ProductFeedbackTopicSummary,
  getProductFeedbackTopicTitle,
  isDocsFeedbackReason,
} from "Common/Types/ProductFeedback/ProductFeedback";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import Page from "Common/UI/Components/Page/Page";
import Table from "Common/UI/Components/Table/Table";
import TableEmptyState, {
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import { BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey } from "Common/Types/Translator";
import { DELETE_IRREVERSIBLE_SENTENCE } from "Common/UI/Components/DeleteConfirmation/DeleteConfirmationMessage";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * FEEDBACK (/admin/feedback): WHAT PEOPLE TOLD THIS SERVER (issue #6832).
 *
 * Where every answer lands: "How easy was that?" at the end of a guided
 * setup, Give feedback in Help, "Was this clear?" under an explanation and
 * the first-week check-in. On a self-hosted server the master admins who
 * read this are the server's own, and nothing ever went to OneUptime. On
 * OneUptime Cloud they are the OneUptime team. Give feedback is a message
 * as well as an answer (#8893): it is also emailed, with who sent it, to
 * support@oneuptime.com on OneUptime Cloud and to the Admin Notification
 * Email, when one is set, on a self-hosted server. The row here still
 * names nobody.
 *
 *   - Ask people for feedback: the server's switch (GlobalConfig.
 *     disableProductFeedback). Off, nobody is asked and Help offers no Give
 *     feedback.
 *   - By question: the last 90 days, each setup's average score (hardest
 *     first), each explanation's thumbs, the check-in's answers.
 *   - What people said: every answer, newest first, by kind - with the page
 *     (a route with no ids) and the version, the only things an answer
 *     carries. No answer names a person or a project.
 *   - Ask AI answers: the thumbs Ask AI stored (#6828). The questions rated
 *     down are listed only here on a self-hosted server: on Cloud they are
 *     customers' questions about their own projects, so the team sees
 *     counts only - and, everywhere, what the answers rated down read: the
 *     products, the docs or nothing, never a word of them (#7365).
 *   - Docs pages, on a self-hosted server (#7209): the switch that keeps
 *     "Was this page helpful?" on this server (GlobalConfig.
 *     keepDocsFeedback, off by default), and the pages people answered for,
 *     the ones that failed them first, with what went wrong.
 *
 * An answer is kept PRODUCT_FEEDBACK_RETENTION_IN_DAYS, then the daily
 * purge deletes it, as What People Said says; a master admin may delete one
 * sooner, from its row (#7366).
 */

export const FEEDBACK_PAGE_TITLE: string = "Feedback";

const ALL_KINDS: string = "all";

const FeedbackPage: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const translator: Translator = useTranslator();

  const [summary, setSummary] = useState<ProductFeedbackAdminSummary | null>(
    null,
  );
  const [summaryError, setSummaryError] = useState<string>("");
  const [isSummaryLoading, setIsSummaryLoading] = useState<boolean>(true);

  const [kind, setKind] = useState<string>(ALL_KINDS);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [itemsOnPage, setItemsOnPage] = useState<number>(
    PRODUCT_FEEDBACK_LIST_PAGE_SIZE,
  );
  const [list, setList] = useState<ProductFeedbackListPage | null>(null);
  const [listError, setListError] = useState<string>("");
  const [isListLoading, setIsListLoading] = useState<boolean>(true);
  const [refreshCount, setRefreshCount] = useState<number>(0);
  // The docs switch's state, once it is read (self-hosted only, #7209).
  const [isKeepingDocsFeedback, setIsKeepingDocsFeedback] =
    useState<boolean>(false);

  useEffect(() => {
    setIsSummaryLoading(true);
    fetchFeedbackSummary()
      .then((answer: ProductFeedbackAdminSummary) => {
        setSummary(answer);
        setSummaryError("");
      })
      .catch((err: unknown) => {
        setSummaryError(API.getFriendlyMessage(err));
      })
      .finally(() => {
        setIsSummaryLoading(false);
      });
  }, [refreshCount]);

  useEffect(() => {
    setIsListLoading(true);
    fetchFeedbackList({
      kind: kind === ALL_KINDS ? null : (kind as ProductFeedbackKind),
      skip: (pageNumber - 1) * itemsOnPage,
      limit: itemsOnPage,
    })
      .then((answer: ProductFeedbackListPage) => {
        setList(answer);
        setListError("");
      })
      .catch((err: unknown) => {
        setListError(API.getFriendlyMessage(err));
      })
      .finally(() => {
        setIsListLoading(false);
      });
  }, [kind, pageNumber, itemsOnPage, refreshCount]);

  const kindTitle: (value: ProductFeedbackKind) => string = (
    value: ProductFeedbackKind,
  ): string => {
    const title: string = PRODUCT_FEEDBACK_KIND_TITLES[value] || value;
    return translator.translateText(title) || title;
  };

  const topicTitle: (data: {
    kind: ProductFeedbackKind;
    topic: string;
  }) => string = (data: {
    kind: ProductFeedbackKind;
    topic: string;
  }): string => {
    const title: string = getProductFeedbackTopicTitle(data);
    return translator.translateText(title) || title;
  };

  // What an answer is, in a few words: its topic and when it was given.
  const answerName: (row: ProductFeedbackListItem) => string = (
    row: ProductFeedbackListItem,
  ): string => {
    const about: string = topicTitle(row);

    return row.createdAt
      ? `${about} · ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(row.createdAt)}`
      : about;
  };

  const answerOf: (data: {
    score: number | null;
    isPositive: boolean | null;
    kind: ProductFeedbackKind;
    reason?: string | null | undefined;
  }) => string = (data: {
    score: number | null;
    isPositive: boolean | null;
    kind: ProductFeedbackKind;
    reason?: string | null | undefined;
  }): string => {
    if (data.score !== null) {
      return (
        translator.translateTemplate("{{score}} of 5", {
          score: translator.formatNumber(data.score),
        }) || ""
      );
    }

    if (data.isPositive === null) {
      return "";
    }

    if (data.kind === ProductFeedbackKind.CheckIn) {
      return (
        (data.isPositive
          ? translator.translateText("Yes")
          : translator.translateText("Not yet")) || ""
      );
    }

    // A docs page: helpful or not, and for a no, what went wrong (#7209).
    if (data.kind === ProductFeedbackKind.DocsPage) {
      if (data.isPositive) {
        return translator.translateText("Helpful") || "";
      }

      return isDocsFeedbackReason(data.reason)
        ? translator.translateTemplate("Not helpful: {{reason}}", {
            reason:
              translator.translateText(
                DOCS_FEEDBACK_REASON_TITLES[data.reason],
              ) || DOCS_FEEDBACK_REASON_TITLES[data.reason],
          }) || ""
        : translator.translateText("Not helpful") || "";
    }

    return (
      (data.isPositive
        ? translator.translateText("Clear")
        : translator.translateText("Not clear")) || ""
    );
  };

  /*
   * Each column names the row's field it draws (key), though every cell is
   * its own element: the shared table once drew nothing for a column with
   * no key, and both tables drew every answer as an empty row (#7457). A
   * cell with nothing to say is the table's quiet dash (TableEmptyValue),
   * never a hyphen of the page's own.
   */
  const summaryColumns: Array<Column<ProductFeedbackTopicSummary>> = [
    {
      id: "question",
      key: "topic",
      title: "Question",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: ProductFeedbackTopicSummary): ReactElement => {
        return (
          <div className="min-w-0">
            <p className="font-medium text-gray-900">{topicTitle(row)}</p>
            <p className="text-xs text-gray-500">{kindTitle(row.kind)}</p>
          </div>
        );
      },
    },
    {
      id: "answers",
      key: "answers",
      title: "Answers",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: ProductFeedbackTopicSummary): ReactElement => {
        return <span>{translator.formatNumber(row.answers)}</span>;
      },
    },
    {
      id: "result",
      key: "averageScore",
      title: "How It Went",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: ProductFeedbackTopicSummary): ReactElement => {
        if (row.averageScore !== null) {
          return (
            <span data-testid="admin-feedback-average">
              {translator.translateTemplate(
                "Average {{average}} of 5, {{hard}} found it hard",
                {
                  average: translator.formatNumber(row.averageScore),
                  hard: translator.formatNumber(row.hardAnswers),
                },
              )}
            </span>
          );
        }

        // Give feedback asks no score and no yes or no.
        if (row.kind === ProductFeedbackKind.General) {
          return <TableEmptyValue />;
        }

        return (
          <span>
            {translator.translateTemplate("{{yes}} yes, {{no}} no", {
              yes: translator.formatNumber(row.positiveAnswers),
              no: translator.formatNumber(row.negativeAnswers),
            })}
          </span>
        );
      },
    },
    {
      id: "written",
      key: "answersWithDetails",
      title: "With Words",
      type: FieldType.Element,
      disableSort: true,
      hideOnMobile: true,
      getElement: (row: ProductFeedbackTopicSummary): ReactElement => {
        return <span>{translator.formatNumber(row.answersWithDetails)}</span>;
      },
    },
  ];

  const listColumns: Array<Column<ProductFeedbackListItem>> = [
    {
      id: "when",
      key: "createdAt",
      title: "When",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: ProductFeedbackListItem): ReactElement => {
        if (!row.createdAt) {
          return <TableEmptyValue />;
        }

        return (
          <span className="whitespace-nowrap">
            {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              row.createdAt,
            )}
          </span>
        );
      },
    },
    {
      id: "about",
      key: "topic",
      title: "About",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: ProductFeedbackListItem): ReactElement => {
        return (
          <div className="min-w-0">
            <p className="text-gray-900">{topicTitle(row)}</p>
            <p className="text-xs text-gray-500">{kindTitle(row.kind)}</p>
          </div>
        );
      },
    },
    {
      id: "answer",
      key: "score",
      title: "Answer",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: ProductFeedbackListItem): ReactElement => {
        const answer: string = answerOf(row);

        // Give feedback is words only: no score, no yes or no.
        return answer ? <span>{answer}</span> : <TableEmptyValue />;
      },
    },
    {
      id: "details",
      key: "details",
      title: "What They Wrote",
      type: FieldType.Element,
      disableSort: true,
      wrapContent: true,
      getElement: (row: ProductFeedbackListItem): ReactElement => {
        return row.details ? (
          <p
            className="max-w-xl whitespace-pre-wrap break-words text-gray-900"
            data-testid="admin-feedback-details"
          >
            <bdi>{row.details}</bdi>
          </p>
        ) : (
          <TableEmptyValue />
        );
      },
    },
    {
      id: "page",
      key: "page",
      title: "Page",
      type: FieldType.Element,
      disableSort: true,
      hideOnMobile: true,
      getElement: (row: ProductFeedbackListItem): ReactElement => {
        if (!row.page) {
          return <TableEmptyValue />;
        }

        // A docs page opens on this server's docs, in the language it was read in.
        if (row.kind === ProductFeedbackKind.DocsPage) {
          return (
            <a
              href={row.page}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-xs text-indigo-600 hover:text-indigo-800"
              dir="ltr"
            >
              {row.page}
            </a>
          );
        }

        return (
          <code className="break-all text-xs text-gray-600" dir="ltr">
            {row.page}
          </code>
        );
      },
    },
    {
      id: "version",
      key: "version",
      title: "Version",
      type: FieldType.Element,
      disableSort: true,
      hideOnMobile: true,
      getElement: (row: ProductFeedbackListItem): ReactElement => {
        if (!row.version) {
          return <TableEmptyValue />;
        }

        return (
          <span className="text-xs text-gray-600" dir="ltr">
            {row.version}
          </span>
        );
      },
    },
    // Where the table draws each row's Delete (actionButtons, #7366).
    {
      title: "Actions",
      type: FieldType.Actions,
    },
  ];

  /*
   * "Was this page helpful?", by page (#7209): the page, opened on this
   * server's docs; how many said it helped and how many not; and what went
   * wrong, most said first.
   */
  const docsColumns: Array<Column<DocsPageFeedbackSummary>> = [
    {
      id: "page",
      key: "page",
      title: "Page",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: DocsPageFeedbackSummary): ReactElement => {
        return (
          <a
            href={`/docs/${row.page}`}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-sm font-medium text-indigo-600 hover:text-indigo-800"
            dir="ltr"
            data-testid="admin-feedback-docs-page"
          >
            {row.page}
          </a>
        );
      },
    },
    {
      id: "helpful",
      key: "helpful",
      title: "Helpful",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: DocsPageFeedbackSummary): ReactElement => {
        return <span>{translator.formatNumber(row.helpful)}</span>;
      },
    },
    {
      id: "notHelpful",
      key: "notHelpful",
      title: "Not Helpful",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: DocsPageFeedbackSummary): ReactElement => {
        return (
          <span data-testid="admin-feedback-docs-not-helpful">
            {translator.formatNumber(row.notHelpful)}
          </span>
        );
      },
    },
    {
      id: "reasons",
      key: "reasons",
      title: "What Went Wrong",
      type: FieldType.Element,
      disableSort: true,
      hideOnMobile: true,
      getElement: (row: DocsPageFeedbackSummary): ReactElement => {
        if (row.reasons.length === 0) {
          return <TableEmptyValue />;
        }

        return (
          <ul className="space-y-0.5" data-testid="admin-feedback-docs-reasons">
            {row.reasons.map(
              (reason: {
                reason: keyof typeof DOCS_FEEDBACK_REASON_TITLES;
                answers: number;
              }): ReactElement => {
                // The reason and how many said it, set apart by " · ".
                return (
                  <li
                    key={reason.reason}
                    className="flex flex-wrap gap-x-1.5 text-sm text-gray-700"
                  >
                    <span>
                      {translator.translateText(
                        DOCS_FEEDBACK_REASON_TITLES[reason.reason],
                      )}
                    </span>
                    <span className="text-gray-500" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-medium text-gray-900">
                      {translator.formatNumber(reason.answers)}
                    </span>
                  </li>
                );
              },
            )}
          </ul>
        );
      },
    },
  ];

  const kindOptions: Array<DropdownOption> = [
    {
      value: ALL_KINDS,
      label: translator.translateText("Every kind") || "Every kind",
    },
    ...PRODUCT_FEEDBACK_KINDS.map(
      (value: ProductFeedbackKind): DropdownOption => {
        return { value: value, label: kindTitle(value) };
      },
    ),
  ];

  const topics: Array<ProductFeedbackTopicSummary> = summary?.topics || [];
  const docsPages: Array<DocsPageFeedbackSummary> = summary?.docsPages || [];
  const ratedDown: Array<AskAiRatedDownAnswer> | null =
    summary?.askAi.ratedDown || null;
  const ratedDownDrewOn: Array<AskAiSourceCount> =
    summary?.askAi.ratedDownDrewOn || [];
  const retentionInDays: number =
    summary?.retentionInDays || PRODUCT_FEEDBACK_RETENTION_IN_DAYS;

  return (
    <Page
      title={FEEDBACK_PAGE_TITLE}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          isTitleTranslated: true,
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: FEEDBACK_PAGE_TITLE,
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.FEEDBACK] as Route,
          ),
        },
      ]}
    >
      <ModelSwitchCard<GlobalConfig>
        modelType={GlobalConfig}
        modelId={ObjectID.getZeroObjectID()}
        column="disableProductFeedback"
        isInverted={true}
        modelAPI={AdminModelAPI}
        cardTitle={translationKey("Ask People for Feedback")}
        cardDescription={
          /*
           * Give feedback is also emailed (#8893): on OneUptime Cloud to the
           * OneUptime team, on a self-hosted server to its Admin
           * Notification Email when one is set, never to OneUptime.
           */
          BILLING_ENABLED
            ? translationKey(
                "Answers are kept on this server and read here by its master admins. Give feedback is also emailed to support@oneuptime.com, and scores, never words, go to product analytics.",
              )
            : translationKey(
                "Answers are kept on this server and read here by its master admins. Give feedback is also emailed to the Admin Notification Email, when one is set. Nothing is sent to OneUptime.",
              )
        }
        title="Ask people how things went"
        getDescription={(isOn: boolean): string => {
          return isOn
            ? translationKey(
                "People are asked one short question now and then, at most once a week and never while something is down. Give feedback is in Help.",
              )
            : translationKey(
                "Nobody is asked, and Help offers no Give feedback.",
              );
        }}
        dataTestId="admin-feedback-switch"
      />

      <Card
        title="By Question"
        description={
          translator.translateTemplate(
            "What people answered in the last {{days}} days. A guided setup's score runs from 1 (very hard) to 5 (very easy); the hardest setups come first.",
            {
              days: translator.formatNumber(summary?.sinceDays || 90),
            },
          ) || ""
        }
      >
        {!isSummaryLoading && !summaryError && topics.length === 0 ? (
          <TableEmptyState
            kind={TableEmptyStateKind.Empty}
            icon={IconProp.ChatBubbleLeftRight}
            title="No answers yet"
            description="Answers appear here as people finish guided setups, rate explanations and send Give feedback."
            isCompact={true}
            dataTestId="admin-feedback-summary-empty"
          />
        ) : (
          <Table<ProductFeedbackTopicSummary>
            id="admin-feedback-summary"
            columnWidthsKey="admin-feedback-summary"
            data={topics}
            columns={summaryColumns}
            singularLabel="Question"
            pluralLabel="Questions"
            currentPageNumber={1}
            totalItemsCount={topics.length}
            itemsOnPage={Math.max(topics.length, 1)}
            disablePagination={true}
            error={summaryError}
            isLoading={isSummaryLoading}
            onNavigateToPage={() => {}}
            sortBy={null}
            sortOrder={SortOrder.Ascending}
            onSortChanged={() => {
              // The server's order: the hardest setups come first.
            }}
            onRefreshClick={() => {
              setRefreshCount(refreshCount + 1);
            }}
          />
        )}
      </Card>

      <Card
        title="What People Said"
        description={translator.translatePlural(
          {
            one: "Every answer, newest first. Answers are kept {{count}} day, then deleted. Each carries the page, as a route with no ids, and the OneUptime version, and names no person or project.",
            other:
              "Every answer, newest first. Answers are kept {{count}} days, then deleted. Each carries the page, as a route with no ids, and the OneUptime version, and names no person or project.",
          },
          retentionInDays,
        )}
        headerLayout="toolbar"
        rightElement={
          <div className="w-52">
            <Dropdown
              options={kindOptions}
              value={kindOptions.find((option: DropdownOption): boolean => {
                return option.value === kind;
              })}
              isClearable={false}
              ariaLabel="Kind"
              dataTestId="admin-feedback-kind"
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                setKind(typeof value === "string" ? value : ALL_KINDS);
                setPageNumber(1);
              }}
            />
          </div>
        }
      >
        <Table<ProductFeedbackListItem>
          id="admin-feedback-list"
          columnWidthsKey="admin-feedback-list"
          data={list?.items || []}
          columns={listColumns}
          singularLabel="Answer"
          pluralLabel="Answers"
          currentPageNumber={pageNumber}
          totalItemsCount={list?.count || 0}
          itemsOnPage={itemsOnPage}
          error={listError}
          isLoading={isListLoading}
          noItemsMessage="No answers yet."
          actionButtons={[
            {
              title: "Delete",
              icon: IconProp.Trash,
              buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
              getConfirmation: (row: ProductFeedbackListItem) => {
                return {
                  title: translator.translateText("Delete Answer") || "",
                  description: (
                    <div className="space-y-2">
                      <p>
                        {translator.translateTemplate(
                          "Are you sure you want to delete {{name}}?",
                          { name: answerName(row) },
                        )}{" "}
                        {translator.translateText(DELETE_IRREVERSIBLE_SENTENCE)}
                      </p>
                      {row.details ? (
                        <blockquote
                          className="whitespace-pre-wrap break-words border-s-2 border-gray-200 ps-3 text-sm text-gray-600"
                          data-testid="admin-feedback-delete-words"
                        >
                          <bdi>{row.details}</bdi>
                        </blockquote>
                      ) : (
                        <></>
                      )}
                    </div>
                  ),
                  submitButtonText: translator.translateText("Delete") || "",
                  submitButtonType: ButtonStyleType.DANGER,
                };
              },
              onClick: async (
                row: ProductFeedbackListItem,
                onCompleteAction: () => void,
                onError: (error: Error) => void,
              ): Promise<void> => {
                try {
                  await deleteFeedbackAnswer(row.id);
                  onCompleteAction();
                  // The list, and By Question's counts, read again.
                  setRefreshCount((count: number): number => {
                    return count + 1;
                  });
                } catch (err) {
                  onError(new Error(API.getFriendlyMessage(err)));
                }
              },
            },
          ]}
          onNavigateToPage={(newPage: number, newItemsOnPage: number) => {
            setPageNumber(newPage);
            setItemsOnPage(newItemsOnPage);
          }}
          sortBy={null}
          sortOrder={SortOrder.Descending}
          onSortChanged={() => {
            // Newest first: the only order the server lists answers in.
          }}
          onRefreshClick={() => {
            setRefreshCount(refreshCount + 1);
          }}
        />
      </Card>

      <Card
        title="Ask AI Answers"
        description={
          BILLING_ENABLED
            ? "How people rated Ask AI's answers in the last 90 days, and what the answers rated down read. The questions belong to each project, so none is shown."
            : "How people rated Ask AI's answers in the last 90 days, what the answers rated down read, and the questions behind them."
        }
      >
        <div
          className="grid grid-cols-2 gap-4 md:grid-cols-4"
          data-testid="admin-feedback-ask-ai"
        >
          <InfoCard
            title={translator.translateText("Helpful") || "Helpful"}
            value={translator.formatNumber(summary?.askAi.helpful || 0)}
            dataTestId="admin-feedback-ask-ai-helpful"
          />
          <InfoCard
            title={translator.translateText("Not helpful") || "Not helpful"}
            value={translator.formatNumber(summary?.askAi.notHelpful || 0)}
            dataTestId="admin-feedback-ask-ai-not-helpful"
          />
        </div>
        {ratedDownDrewOn.length > 0 ? (
          <div className="mt-5" data-testid="admin-feedback-ask-ai-drew-on">
            <p className="mb-1 text-xs font-medium text-gray-500">
              {translator.translateText("What the answers rated down read")}
            </p>
            <dl className="divide-y divide-gray-100">
              {ratedDownDrewOn.map((source: AskAiSourceCount): ReactElement => {
                const title: string = getAskAiSourceTitle(source.source);

                return (
                  <div
                    key={source.source}
                    className="flex items-center justify-between gap-3 py-1.5 text-sm"
                    data-testid="admin-feedback-ask-ai-source"
                  >
                    <dt className="min-w-0 text-gray-600">
                      {translator.translateText(title) || title}
                    </dt>
                    <dd className="font-medium text-gray-900">
                      {translator.formatNumber(source.answers)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ) : (
          <></>
        )}
        {ratedDown && ratedDown.length > 0 ? (
          <ul
            className="mt-5 divide-y divide-gray-100"
            data-testid="admin-feedback-ask-ai-rated-down"
          >
            {ratedDown.map(
              (answer: AskAiRatedDownAnswer, index: number): ReactElement => {
                return (
                  <li key={index} className="py-3">
                    <p className="whitespace-pre-wrap break-words text-sm text-gray-900">
                      <bdi>{answer.question}</bdi>
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        answer.ratedAt,
                      )}
                    </p>
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}
      </Card>

      {/*
       * "Was this page helpful?" on this server's docs (#7209): kept only
       * once switched on, and never sent anywhere else. On OneUptime Cloud
       * the docs send answers to product analytics, with consent, instead.
       */}
      {!BILLING_ENABLED ? (
        <ModelSwitchCard<GlobalConfig>
          modelType={GlobalConfig}
          modelId={ObjectID.getZeroObjectID()}
          column="keepDocsFeedback"
          modelAPI={AdminModelAPI}
          cardTitle={translationKey("Docs Feedback")}
          cardDescription={translationKey(
            "Whether this server's docs keep the answers to “Was this page helpful?” for its master admins: the page, yes or no, and what went wrong. Nothing is sent anywhere else.",
          )}
          title="Keep answers on this server"
          getDescription={(isOn: boolean): string => {
            return isOn
              ? translationKey(
                  "Each docs page says, under its question, that answers go to this server's admins.",
                )
              : translationKey(
                  "The docs keep nothing, and a no offers to tell OneUptime on GitHub.",
                );
          }}
          onChange={(isOn: boolean) => {
            setIsKeepingDocsFeedback(isOn);
          }}
          dataTestId="admin-feedback-docs-switch"
        />
      ) : (
        <></>
      )}

      {!BILLING_ENABLED && (isKeepingDocsFeedback || docsPages.length > 0) ? (
        <Card
          title="Docs Pages"
          description={
            translator.translateTemplate(
              "How people answered “Was this page helpful?” on this server's docs in the last {{days}} days: the pages that failed them first.",
              {
                days: translator.formatNumber(summary?.sinceDays || 90),
              },
            ) || ""
          }
        >
          {!isSummaryLoading && !summaryError && docsPages.length === 0 ? (
            <TableEmptyState
              kind={TableEmptyStateKind.Empty}
              icon={IconProp.Book}
              title="No answers yet"
              description="Pages appear here as people answer “Was this page helpful?” at the foot of a docs page."
              isCompact={true}
              dataTestId="admin-feedback-docs-empty"
            />
          ) : (
            <Table<DocsPageFeedbackSummary>
              id="admin-feedback-docs"
              columnWidthsKey="admin-feedback-docs"
              data={docsPages}
              columns={docsColumns}
              singularLabel="Page"
              pluralLabel="Pages"
              currentPageNumber={1}
              totalItemsCount={docsPages.length}
              itemsOnPage={Math.max(docsPages.length, 1)}
              disablePagination={true}
              error={summaryError}
              isLoading={isSummaryLoading}
              onNavigateToPage={() => {}}
              sortBy={null}
              sortOrder={SortOrder.Descending}
              onSortChanged={() => {
                // The server's order: the pages that failed people first.
              }}
              onRefreshClick={() => {
                setRefreshCount(refreshCount + 1);
              }}
            />
          )}
        </Card>
      ) : (
        <></>
      )}
    </Page>
  );
};

export default FeedbackPage;
