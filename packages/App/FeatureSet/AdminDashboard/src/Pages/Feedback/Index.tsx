import AdminModelAPI from "../../Utils/ModelAPI";
import PageMap from "../../Utils/PageMap";
import {
  fetchFeedbackList,
  fetchFeedbackSummary,
} from "../../Utils/ProductFeedback";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  AskAiRatedDownAnswer,
  PRODUCT_FEEDBACK_KIND_TITLES,
  PRODUCT_FEEDBACK_KINDS,
  PRODUCT_FEEDBACK_LIST_PAGE_SIZE,
  ProductFeedbackAdminSummary,
  ProductFeedbackKind,
  ProductFeedbackListItem,
  ProductFeedbackListPage,
  ProductFeedbackTopicSummary,
  getProductFeedbackTopicTitle,
} from "Common/Types/ProductFeedback/ProductFeedback";
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
import Column from "Common/UI/Components/Table/Types/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import { BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
 * read this are the server's own, and nothing ever left it. On OneUptime
 * Cloud they are the OneUptime team.
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
 *     counts only.
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

  const answerOf: (data: {
    score: number | null;
    isPositive: boolean | null;
    kind: ProductFeedbackKind;
  }) => string = (data: {
    score: number | null;
    isPositive: boolean | null;
    kind: ProductFeedbackKind;
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

    return (
      (data.isPositive
        ? translator.translateText("Clear")
        : translator.translateText("Not clear")) || ""
    );
  };

  const summaryColumns: Array<Column<ProductFeedbackTopicSummary>> = [
    {
      id: "question",
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
      title: "Answers",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: ProductFeedbackTopicSummary): ReactElement => {
        return <span>{translator.formatNumber(row.answers)}</span>;
      },
    },
    {
      id: "result",
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

        if (row.kind === ProductFeedbackKind.General) {
          return <span className="text-gray-500">-</span>;
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
      title: "When",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: ProductFeedbackListItem): ReactElement => {
        return (
          <span className="whitespace-nowrap">
            {row.createdAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  row.createdAt,
                )
              : "-"}
          </span>
        );
      },
    },
    {
      id: "about",
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
      title: "Answer",
      type: FieldType.Element,
      disableSort: true,
      getElement: (row: ProductFeedbackListItem): ReactElement => {
        return <span>{answerOf(row) || "-"}</span>;
      },
    },
    {
      id: "details",
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
          <span className="text-gray-400">-</span>
        );
      },
    },
    {
      id: "page",
      title: "Page",
      type: FieldType.Element,
      disableSort: true,
      hideOnMobile: true,
      getElement: (row: ProductFeedbackListItem): ReactElement => {
        return (
          <code className="break-all text-xs text-gray-600" dir="ltr">
            {row.page || "-"}
          </code>
        );
      },
    },
    {
      id: "version",
      title: "Version",
      type: FieldType.Element,
      disableSort: true,
      hideOnMobile: true,
      getElement: (row: ProductFeedbackListItem): ReactElement => {
        return (
          <span className="text-xs text-gray-600" dir="ltr">
            {row.version || "-"}
          </span>
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
  const ratedDown: Array<AskAiRatedDownAnswer> | null =
    summary?.askAi.ratedDown || null;

  return (
    <Page
      title={FEEDBACK_PAGE_TITLE}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
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
        cardTitle="Ask People for Feedback"
        cardDescription={
          BILLING_ENABLED
            ? "Answers are kept on this server and read here by its master admins. The score, never the words, also goes to product analytics."
            : "Answers are kept on this server and read here by its master admins. Nothing is sent anywhere else."
        }
        title="Ask people how things went"
        getDescription={(isOn: boolean): string => {
          return isOn
            ? "People are asked one short question now and then, at most once a week and never while something is down. Give feedback is in Help."
            : "Nobody is asked, and Help offers no Give feedback.";
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
        description="Every answer, newest first. Each carries the page it was given on, as a route with no ids, and the OneUptime version. No answer names a person or a project."
        headerLayout="toolbar"
        rightElement={
          <div className="w-52">
            <Dropdown
              options={kindOptions}
              value={kindOptions.find((option: DropdownOption): boolean => {
                return option.value === kind;
              })}
              isClearable={false}
              ariaLabel={translator.translateText("Kind") || "Kind"}
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
            ? "How people rated Ask AI's answers in the last 90 days. On OneUptime Cloud the questions belong to each project, so only the counts are shown."
            : "How people rated Ask AI's answers in the last 90 days, and the questions behind the answers rated down."
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
    </Page>
  );
};

export default FeedbackPage;
