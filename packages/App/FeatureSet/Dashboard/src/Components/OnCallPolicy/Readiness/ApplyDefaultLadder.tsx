import {
  APPLY_DEFAULT_LADDER_COPY,
  APPLY_DEFAULT_LADDER_RESULT_LABELS,
  APPLY_DEFAULT_LADDER_TITLE,
} from "./ApplyDefaultLadderWords";
import { StepChip } from "../../NotificationRule/PagingLadder/PagingLadderParts";
import { describeChannelsInSentence } from "../../NotificationRule/PagingLadder/PagingLadderWords";
import { ON_CALL_SECTION_LABEL_ON_WHITE_CLASS_NAME } from "../OnCallLabelClasses";
import { getDefaultLadderChannelChoices } from "../../NotificationRule/PagingLadder/ProjectPagingDefaultsWords";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import GenericObject from "Common/Types/GenericObject";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  PAGING_LADDER_ADMIN_PERMISSIONS,
  PAGING_LADDER_APPLY_DEFAULT_ROUTE,
  PagingLadderDefaultMemberResult,
  PagingLadderDefaultOutcome,
  PagingLadderDefaultStep,
  readPagingLadderDefault,
  readPagingLadderDefaultMemberResults,
  toPagingLadderStepOfChannel,
} from "Common/Types/NotificationRule/PagingLadderDefault";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import ObjectID from "Common/Types/ObjectID";
import {
  BULK_ITEM_CHANGED,
  BulkActionRunResult,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { MutableRefObject, ReactElement, useRef } from "react";

/*
 * APPLY THE PROJECT'S DEFAULT LADDER, FROM ON-CALL READINESS (#7450).
 *
 * An admin picks members in Readiness's list and gives each the project's
 * default ladder (Project.defaultPagingLadder, #7449), as far as the
 * methods they have verified go. The confirmation names every member and
 * shows the ladder; the run goes one member a request
 * (POST /paging-ladder/apply-default) through runBulkAction, so it shows
 * its progress and can be stopped. The server saves each through
 * applyLadder - its checks, an audit entry per row, one email to the
 * member - and answers what was applied, left out and kept: a member with
 * none of the default's ways is left as they were, with why, and one who
 * lacks some keeps their own steps in their place, said after the run.
 *
 * Offered only to those who may change anybody's rules
 * (PAGING_LADDER_ADMIN_PERMISSIONS), in a project that has a default; the
 * server asks again. Nothing here names a member's number or address.
 */

// Whether the signed-in person may apply the default to members.
export const canApplyDefaultLadder: () => boolean = (): boolean => {
  return PermissionGate.holdsAnyOf([...PAGING_LADDER_ADMIN_PERMISSIONS]);
};

// The project's default ladder; empty for none.
export const loadProjectDefaultLadder: () => Promise<
  Array<PagingLadderDefaultStep>
> = async (): Promise<Array<PagingLadderDefaultStep>> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return [];
  }

  const project: Project | null = await ModelAPI.getItem<Project>({
    modelType: Project,
    id: projectId,
    select: { defaultPagingLadder: true },
  });

  return readPagingLadderDefault(project?.defaultPagingLadder);
};

// One member: what the server did, or a throw in its words.
export const applyDefaultLadderToMember: (
  userId: string,
) => Promise<PagingLadderDefaultMemberResult> = async (
  userId: string,
): Promise<PagingLadderDefaultMemberResult> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        PAGING_LADDER_APPLY_DEFAULT_ROUTE,
      ),
      data: { userIds: [userId] },
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse || response.isFailure()) {
    throw new Error(API.getFriendlyMessage(response));
  }

  const results: Array<PagingLadderDefaultMemberResult> =
    readPagingLadderDefaultMemberResults(response.data);

  const result: PagingLadderDefaultMemberResult | undefined =
    results.find((candidate: PagingLadderDefaultMemberResult): boolean => {
      return candidate.userId === userId;
    }) || results[0];

  if (!result) {
    throw new Error(API.getFriendlyMessage(response));
  }

  return result;
};

// One member's answer, beside the name the list shows for them.
export interface AnsweredMember {
  name: string;
  result: PagingLadderDefaultMemberResult;
}

/*
 * After the run: each member it was applied to who lacks a way the default
 * uses, and what they keep meanwhile. Nobody else needs a line: the
 * progress dialog counts them, and names who was left as they were.
 */
export const getDefaultLadderLeftOutLines: (
  translator: Translator,
  answered: ReadonlyArray<AnsweredMember>,
) => Array<string> = (
  translator: Translator,
  answered: ReadonlyArray<AnsweredMember>,
): Array<string> => {
  return answered
    .filter((member: AnsweredMember): boolean => {
      return (
        member.result.outcome === PagingLadderDefaultOutcome.Applied &&
        member.result.leftOutChannels.length > 0
      );
    })
    .map((member: AnsweredMember): string => {
      const kept: Array<OnCallPageChannel> = member.result.keptChannels.filter(
        (channel: OnCallPageChannel): boolean => {
          return channel !== OnCallPageChannel.CustomChannel;
        },
      );

      return kept.length > 0
        ? translator.translateTemplate(
            APPLY_DEFAULT_LADDER_COPY.leftOutKeepingOwn,
            {
              name: member.name,
              channels: describeChannelsInSentence(
                member.result.leftOutChannels,
              ),
              kept: describeChannelsInSentence(kept),
            },
          )
        : translator.translateTemplate(APPLY_DEFAULT_LADDER_COPY.leftOut, {
            name: member.name,
            channels: describeChannelsInSentence(member.result.leftOutChannels),
          });
    });
};

// One member's result, as the run's outcome for them.
export const getDefaultLadderItemOutcome: (
  translator: Translator,
  result: PagingLadderDefaultMemberResult,
) => BulkItemOutcome = (
  translator: Translator,
  result: PagingLadderDefaultMemberResult,
): BulkItemOutcome => {
  if (result.outcome === PagingLadderDefaultOutcome.Failed) {
    throw new Error(result.message);
  }

  if (result.outcome === PagingLadderDefaultOutcome.Skipped) {
    return bulkItemUnchanged(
      translator.translateText(APPLY_DEFAULT_LADDER_COPY.skipped) ||
        APPLY_DEFAULT_LADDER_COPY.skipped,
    );
  }

  if (result.changedRuleCount === 0) {
    return bulkItemUnchanged(
      translator.translateText(APPLY_DEFAULT_LADDER_COPY.alreadyOnIt) ||
        APPLY_DEFAULT_LADDER_COPY.alreadyOnIt,
    );
  }

  return BULK_ITEM_CHANGED;
};

export interface ApplyDefaultLadderOptions<T extends GenericObject> {
  translator: Translator;
  // The project's default ladder: the action is offered only with one.
  defaultSteps: ReadonlyArray<PagingLadderDefaultStep>;
  getUserId: (item: T) => string;
  getName: (item: T) => string;
  // Each member applied to, skipped or failed, once the run is over.
  onFinished?: (() => void) | undefined;
  // For tests: one member's request.
  applyToMember?:
    | ((userId: string) => Promise<PagingLadderDefaultMemberResult>)
    | undefined;
}

export function useApplyDefaultLadderBulkAction<T extends GenericObject>(
  options: ApplyDefaultLadderOptions<T>,
): BulkActionButtonSchema<T> | null {
  const translator: Translator = options.translator;

  // What the last run's requests answered, for its result.
  const answeredRef: MutableRefObject<Array<AnsweredMember>> = useRef<
    Array<AnsweredMember>
  >([]);

  if (options.defaultSteps.length === 0 || !canApplyDefaultLadder()) {
    return null;
  }

  const methods: ReturnType<typeof getDefaultLadderChannelChoices> =
    getDefaultLadderChannelChoices();

  const renderLeftOut: () => ReactElement | undefined = ():
    | ReactElement
    | undefined => {
    const lines: Array<string> = getDefaultLadderLeftOutLines(
      translator,
      answeredRef.current,
    );

    if (lines.length === 0) {
      return undefined;
    }

    return (
      <ul
        className="space-y-1 text-sm text-gray-700"
        data-testid="apply-default-ladder-left-out"
      >
        {lines.map((line: string, index: number) => {
          return <li key={index}>{line}</li>;
        })}
      </ul>
    );
  };

  return {
    title: APPLY_DEFAULT_LADDER_COPY.action,
    icon: IconProp.List,
    buttonStyleType: ButtonStyleType.NORMAL,
    confirmTitle: (items: Array<T>): string => {
      return translator.translatePlural(
        APPLY_DEFAULT_LADDER_TITLE,
        items.length,
        { count: translator.formatNumber(items.length) },
      );
    },
    confirmMessage: (): string => {
      return (
        translator.translateText(APPLY_DEFAULT_LADDER_COPY.question) ||
        APPLY_DEFAULT_LADDER_COPY.question
      );
    },
    confirmDetails: (items: Array<T>): ReactElement => {
      return (
        <div
          className="mt-3 flex flex-col gap-3"
          data-testid="apply-default-ladder-confirm"
        >
          <div>
            <p className={ON_CALL_SECTION_LABEL_ON_WHITE_CLASS_NAME}>
              {translator.translateText(
                APPLY_DEFAULT_LADDER_COPY.ladderHeading,
              )}
            </p>
            <div
              className="mt-1.5 flex flex-wrap items-center gap-1.5"
              data-testid="apply-default-ladder-steps"
            >
              {options.defaultSteps.map(
                (step: PagingLadderDefaultStep, index: number) => {
                  return (
                    <StepChip
                      key={`${step.channel}-${step.notifyAfterMinutes}-${index}`}
                      step={toPagingLadderStepOfChannel(step)}
                      methods={methods}
                    />
                  );
                },
              )}
            </div>
          </div>
          <div>
            <p className={ON_CALL_SECTION_LABEL_ON_WHITE_CLASS_NAME}>
              {translator.translateText(
                APPLY_DEFAULT_LADDER_COPY.membersHeading,
              )}
            </p>
            <ul
              className="mt-1.5 flex flex-col gap-1 text-sm text-gray-900"
              data-testid="apply-default-ladder-members"
            >
              {items.map((item: T) => {
                return (
                  <li key={options.getUserId(item)}>{options.getName(item)}</li>
                );
              })}
            </ul>
          </div>
        </div>
      );
    },
    confirmButtonStyleType: ButtonStyleType.PRIMARY,
    resultLabels: APPLY_DEFAULT_LADDER_RESULT_LABELS,
    resultDetails: renderLeftOut,
    onClick: async (actionProps: BulkActionOnClickProps<T>): Promise<void> => {
      answeredRef.current = [];

      const applyToMember: (
        userId: string,
      ) => Promise<PagingLadderDefaultMemberResult> =
        options.applyToMember || applyDefaultLadderToMember;

      const run: BulkActionRunResult<T> = await runBulkAction<T>({
        actionProps: actionProps,
        step: async (item: T): Promise<BulkItemOutcome> => {
          const result: PagingLadderDefaultMemberResult = await applyToMember(
            options.getUserId(item),
          );

          answeredRef.current = [
            ...answeredRef.current,
            { name: options.getName(item), result: result },
          ];

          return getDefaultLadderItemOutcome(translator, result);
        },
      });

      ProductEvents.send(ProductEventName.PagingLadderDefaultApplied, {
        member_count: actionProps.items.length,
        applied_count: run.changed.length,
        skipped_count: run.unchanged.length,
        failed_count: run.failed.length,
      });

      options.onFinished?.();
    },
  };
}
