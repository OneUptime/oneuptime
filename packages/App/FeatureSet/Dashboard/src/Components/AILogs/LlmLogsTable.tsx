import React, { FunctionComponent, ReactElement, useState } from "react";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import LlmLog from "Common/Models/DatabaseModels/LlmLog";
import FieldType from "Common/UI/Components/Types/FieldType";
import Columns from "Common/UI/Components/ModelTable/Columns";
import Pill from "Common/UI/Components/Pill/Pill";
import Color from "Common/Types/Color";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import LlmLogStatus from "Common/Types/LlmLogStatus";
import ProjectUtil from "Common/UI/Utils/Project";
import Filter from "Common/UI/Components/ModelFilter/Filter";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Query from "Common/Types/BaseDatabase/Query";
import UserElement from "../User/User";
import User from "Common/Models/DatabaseModels/User";
import { BILLING_ENABLED } from "Common/UI/Config";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AiTokenCount, {
  AiTokenCountBreakdown,
} from "Common/Types/AI/AiTokenCount";
import { getLlmLogCacheFacts } from "./LlmLogTokens";

export interface LlmLogsTableProps {
  query?: Query<LlmLog>;
  singularName?: string;
}

const LlmLogsTable: FunctionComponent<LlmLogsTableProps> = (
  props: LlmLogsTableProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [modalText, setModalText] = useState<string>("");
  const [modalTitle, setModalTitle] = useState<string>("");

  const defaultColumns: Columns<LlmLog> = [
    {
      field: { llmProviderName: true },
      title: "Provider",
      type: FieldType.Text,
      noValueMessage: "-",
    },
    {
      field: { feature: true },
      title: "Feature",
      type: FieldType.Text,
      noValueMessage: "-",
    },
    {
      field: {
        user: {
          name: true,
          email: true,
          profilePictureId: true,
        },
      },
      title: "User",
      type: FieldType.Text,
      noValueMessage: "-",
      getElement: (item: LlmLog): ReactElement => {
        if (!item["user"]) {
          return <p>-</p>;
        }

        return <UserElement user={item["user"] as User} />;
      },
    },
    {
      field: { totalTokens: true },
      title: "Tokens Used",
      type: FieldType.Number,
      /*
       * The tokens as OneUptime counts them (AiTokenCount): what the
       * project's daily AI limits add up and the AI credits charge. A call
       * that used the provider's prompt cache says, under its count, how
       * many tokens it sent in all and how many of them the cache served or
       * took, so the count can be checked against the provider's own. Its
       * cached tokens count at its model's prices (getCacheWeights), so the
       * row's model is read with it.
       */
      // The (i) beside the title translates its text as it shows it.
      headerTooltip: translationKey(
        "As counted toward the project's daily AI limits: a token the provider read from its prompt cache, or wrote to it, counts for what the model charges for it next to a fresh token. On most current models a read counts as a tenth of a token.",
      ),
      // The line under the count wraps rather than widen the table.
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-xs",
      /*
       * The rows could only be sorted by the tokens as the provider counted
       * them (the column), which is not the count the cell shows: a call that
       * read most of its tokens from the cache would sort above one that
       * counts more.
       */
      disableSort: true,
      getElement: (item: LlmLog): ReactElement => {
        const tokens: AiTokenCountBreakdown = AiTokenCount.getBreakdown(item);
        const cacheFacts: Array<string> = getLlmLogCacheFacts(
          translator,
          tokens,
        );

        return (
          <div data-testid="llm-log-tokens">
            <p>{translator.formatNumber(tokens.countedTokens)}</p>
            {cacheFacts.length > 0 ? (
              /*
               * The facts with a dot between them, wrapping between facts
               * and never inside one. The line is pulled back by one gap in
               * a box that clips, so a fact that starts a line - the first,
               * or one a narrow column wrapped - has its dot clipped away
               * (as Code's meta lines do).
               */
              <div
                className="overflow-hidden"
                data-testid="llm-log-cache-tokens"
              >
                <p className="-ml-3 flex flex-wrap text-xs leading-5 text-gray-500">
                  {cacheFacts.map((fact: string, index: number) => {
                    return (
                      <span
                        key={index}
                        className="relative ml-3 whitespace-nowrap"
                      >
                        {index > 0 ? (
                          <span
                            aria-hidden="true"
                            className="absolute -left-2 text-gray-300"
                          >
                            ·
                          </span>
                        ) : (
                          <></>
                        )}
                        {fact}
                      </span>
                    );
                  })}
                </p>
              </div>
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
    // Only show cost column if billing is enabled
    ...(BILLING_ENABLED
      ? [
          {
            field: { costInUSDCents: true },
            title: "Cost (USD)",
            type: FieldType.Text,
            getElement: (item: LlmLog): ReactElement => {
              const cents: number = item["costInUSDCents"] as number;
              if (cents === undefined || cents === null) {
                return <p>-</p>;
              }
              const usd: number = cents / 100;
              return <p>${usd.toFixed(4)}</p>;
            },
          },
        ]
      : []),
    {
      field: { createdAt: true },
      title: "Time",
      type: FieldType.DateTime,
    },
    {
      field: { status: true },
      title: "Status",
      type: FieldType.Text,
      getElement: (item: LlmLog): ReactElement => {
        if (item["status"]) {
          let color: Color = Green;
          if (item["status"] === LlmLogStatus.Error) {
            color = Red;
          }
          if (
            item["status"] === LlmLogStatus.InsufficientBalance ||
            item["status"] === LlmLogStatus.BudgetExceeded
          ) {
            color = Yellow;
          }
          return (
            <Pill
              isMinimal={false}
              color={color}
              text={item["status"] as string}
            />
          );
        }
        return <></>;
      },
    },
  ];

  const defaultFilters: Array<Filter<LlmLog>> = [
    { field: { createdAt: true }, title: "Time", type: FieldType.Date },
    { field: { status: true }, title: "Status", type: FieldType.Text },
    { field: { llmType: true }, title: "Provider Type", type: FieldType.Text },
    { field: { feature: true }, title: "Feature", type: FieldType.Text },
  ];

  return (
    <>
      <ModelTable<LlmLog>
        modelType={LlmLog}
        id={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-llm-logs-table`
            : "llm-logs-table"
        }
        userPreferencesKey={
          props.singularName
            ? `${props.singularName.replace(/\s+/g, "-").toLowerCase()}-llm-logs-table`
            : "llm-logs-table"
        }
        name="AI Logs"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        showViewIdButton={true}
        isViewable={false}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
          ...(props.query || {}),
        }}
        selectMoreFields={{
          statusMessage: true,
          cachedInputTokens: true,
          cacheCreationTokens: true,
          // Whose prices its cached tokens count at (AiTokenCount).
          modelName: true,
        }}
        cardProps={{
          title: "AI Logs",
          description: props.singularName
            ? translator.translateTemplate(
                "AI usage logs for this {{itemName}}.",
                {
                  itemName: translatableTerm(props.singularName, {
                    inSentence: true,
                  }),
                },
              )
            : "AI usage logs for this project.",
        }}
        noItemsMessage={
          props.singularName
            ? translator.translateTemplate(
                "No AI logs for this {{itemName}}.",
                {
                  itemName: translatableTerm(props.singularName, {
                    inSentence: true,
                  }),
                },
              )
            : "No AI logs."
        }
        showRefreshButton={true}
        columns={defaultColumns}
        filters={defaultFilters}
        actionButtons={[
          {
            title: "View Error",
            buttonStyleType: ButtonStyleType.NORMAL,
            icon: IconProp.Error,
            isVisible: (item: LlmLog): boolean => {
              return (
                item["status"] === LlmLogStatus.Error ||
                item["status"] === LlmLogStatus.InsufficientBalance ||
                item["status"] === LlmLogStatus.BudgetExceeded
              );
            },
            onClick: async (item: LlmLog, onCompleteAction: VoidFunction) => {
              setModalText(
                (item["statusMessage"] as string) || "No error message",
              );
              setModalTitle("Status Message");
              setShowModal(true);
              onCompleteAction();
            },
          },
        ]}
      />

      {showModal && (
        <ConfirmModal
          title={modalTitle}
          description={modalText}
          onSubmit={() => {
            return setShowModal(false);
          }}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
        />
      )}
    </>
  );
};

export default LlmLogsTable;
