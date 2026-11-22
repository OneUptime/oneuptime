import {
  DECLARED_CODE_REASON_WORDS,
  getStartingRepositoryId,
} from "../AutoRemediation/DeclaredCodeChangeWords";
import DataSecurityApi from "./DataSecurityApi";
import {
  CLOUD_PART_DONE,
  CLOUD_PART_FAILED,
  CLOUD_PART_NOTE,
  CLOUD_PART_SENTENCE,
  CLOUD_PART_TITLE,
  FIX_DIALOG_DESCRIPTION,
  FIX_IT_ANYWAY,
  FIX_PLAN_NOT_LOADED,
  FIX_THE_CAUSE,
  INCLUDE_PART,
  INFRASTRUCTURE_CODE,
  LEFT_OUT_REASONS,
  LEFT_OUT_SENTENCE,
  LEFT_OUT_TITLE,
  MORE_STORES,
  NOTHING_TO_FIX_HERE,
  PULL_REQUEST_CODE_FOUND,
  PULL_REQUEST_ON_ITS_WAY,
  PULL_REQUEST_PART_SENTENCE,
  PULL_REQUEST_PART_TITLE,
  PULL_REQUEST_PICK_REPOSITORY,
  PULL_REQUEST_REPOSITORY,
  PULL_REQUEST_STARTED,
  getGroupHeadline,
  getOfferedParts,
} from "./IssueGroupsCopy";
import { DataSecurityIssueGroupJSON } from "Common/Types/DataSecurity/DataSecurityIssueGroup";
import {
  DataSecurityIssueGroupFixPart,
  DataSecurityIssueGroupFixPlanJSON,
  DataSecurityIssueGroupFixResultJSON,
  DataSecurityIssueGroupFixStoreJSON,
  DataSecurityIssueGroupLeftOutJSON,
  DataSecurityIssueGroupLeftOutReason,
  countIssueGroupFixStores,
} from "Common/Types/DataSecurity/DataSecurityIssueGroupFix";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DeclaredCodeChangeState,
  DeclaredCodeOwnerCandidateJSON,
} from "Common/Utils/AiRemediation/DeclaredCodeChange";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import API from "Common/UI/Utils/API/API";
import { Translator, formatList } from "Common/UI/Utils/TranslateTemplate";
import Toast from "Common/UI/Utils/Toast";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * FIX THE CAUSE: ONE FIX FOR A GROUP OF ISSUES ONE MISTAKE MADE (#10370).
 *
 * What the one press changes, what it leaves out, and why, before it is
 * pressed - read now for the reader (DataSecurityIssueGroupFix.plan):
 *
 *   - One Pull Request, for the stores declared as code: to the module or
 *     file that declares them, in the repository the reader confirms -
 *     the one the grouping found first;
 *   - One Approval, for the stores made in the console: the response action
 *     that fixes the check, on each of them through its cloud connection;
 *   - Left Out: each store neither part changes, with why - Public By
 *     Design, or what OneUptime AI's analysis says the fix would break,
 *     which the reader may tick in.
 *
 * A part the reader may not make says why, and is not made. With both
 * parts offered, each can be left out. The press is refused when the group
 * changed since it was shown.
 */

export const ISSUE_GROUP_FIX_TEST_ID: string = "data-security-issue-group-fix";

// The most stores a part names before it counts the rest.
const MAX_STORES_NAMED: number = 6;

const ON_ITS_WAY: ReadonlyArray<string> = [
  DeclaredCodeChangeState.Writing,
  DeclaredCodeChangeState.Opened,
  DeclaredCodeChangeState.WaitingForYou,
];

export interface ComponentProps {
  group: DataSecurityIssueGroupJSON;
  onClose: () => void;
  // The fix was asked for, or made: the list reads its groups again.
  onFixed: () => void;
}

type PlanState =
  | { kind: "loading" }
  | { kind: "failed"; error: string }
  | { kind: "read"; plan: DataSecurityIssueGroupFixPlanJSON };

// A part's stores, by name: the first few, then how many more.
const StoreNames: FunctionComponent<{
  stores: ReadonlyArray<DataSecurityIssueGroupFixStoreJSON>;
}> = (props: {
  stores: ReadonlyArray<DataSecurityIssueGroupFixStoreJSON>;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const named: Array<DataSecurityIssueGroupFixStoreJSON> = props.stores.slice(
    0,
    MAX_STORES_NAMED,
  );
  const more: number = props.stores.length - named.length;

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {named.map((store: DataSecurityIssueGroupFixStoreJSON): ReactElement => {
        return (
          <li
            key={store.dataStoreId}
            className="max-w-full rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700 [overflow-wrap:anywhere]"
          >
            <IsolatedText text={store.name || store.dataStoreId} />
          </li>
        );
      })}
      {more > 0 ? (
        <li className="px-1 py-0.5 text-xs text-gray-500">
          {translator.translatePlural(MORE_STORES, more)}
        </li>
      ) : (
        <></>
      )}
    </ul>
  );
};

// A part's heading, with its Include box when the fix has both parts.
const PartHeading: FunctionComponent<{
  title: string;
  icon: IconProp;
  isChoosable: boolean;
  isIncluded: boolean;
  onChange: (isIncluded: boolean) => void;
  testId: string;
}> = (props: {
  title: string;
  icon: IconProp;
  isChoosable: boolean;
  isIncluded: boolean;
  onChange: (isIncluded: boolean) => void;
  testId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Icon icon={props.icon} className="h-4 w-4 text-gray-400" />
        <span>{translator.translateText(props.title)}</span>
      </h4>
      {props.isChoosable ? (
        <CheckboxElement
          title={INCLUDE_PART}
          value={props.isIncluded}
          dataTestId={props.testId}
          onChange={(value: boolean) => {
            props.onChange(value);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

// Why a part cannot be made by this reader, in their words.
const PartRefusal: FunctionComponent<{ message: string }> = (props: {
  message: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <p className="mt-2 flex items-start gap-2 text-sm text-gray-600">
      <Icon
        icon={IconProp.Lock}
        className="mt-0.5 h-4 w-4 flex-none text-gray-400"
      />
      <span>{translator.translateText(props.message) || props.message}</span>
    </p>
  );
};

const IssueGroupFixModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<PlanState>({ kind: "loading" });
  const [parts, setParts] = useState<Array<DataSecurityIssueGroupFixPart>>([]);
  const [repositoryId, setRepositoryId] = useState<string>("");
  const [ticked, setTicked] = useState<Array<string>>([]);
  const [isFixing, setIsFixing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      try {
        const plan: DataSecurityIssueGroupFixPlanJSON =
          await DataSecurityApi.getIssueGroupFixPlan(props.group.groupId);

        if (!isCurrent) {
          return;
        }

        const candidates: Array<DeclaredCodeOwnerCandidateJSON> =
          plan.pullRequest?.candidates || [];
        const found: string =
          plan.pullRequest?.location?.repositoryId?.toLowerCase() || "";
        const foundCandidate: DeclaredCodeOwnerCandidateJSON | undefined =
          candidates.find((candidate: DeclaredCodeOwnerCandidateJSON) => {
            return (
              candidate.canAsk && candidate.repositoryId.toLowerCase() === found
            );
          });

        setParts(getOfferedParts(plan));
        setRepositoryId(
          foundCandidate?.repositoryId ||
            getStartingRepositoryId(candidates) ||
            "",
        );
        setState({ kind: "read", plan });
      } catch (err) {
        if (isCurrent) {
          setState({ kind: "failed", error: API.getFriendlyMessage(err) });
        }
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [props.group.groupId]);

  const plan: DataSecurityIssueGroupFixPlanJSON | null =
    state.kind === "read" ? state.plan : null;
  const offered: Array<DataSecurityIssueGroupFixPart> = plan
    ? getOfferedParts(plan)
    : [];
  const isChoosable: boolean = offered.length > 1;
  const pullRequest: DataSecurityIssueGroupFixPlanJSON["pullRequest"] =
    plan?.pullRequest && plan.pullRequest.stores.length > 0
      ? plan.pullRequest
      : undefined;
  const cloud: DataSecurityIssueGroupFixPlanJSON["cloud"] =
    plan?.cloud && plan.cloud.stores.length > 0 ? plan.cloud : undefined;
  const isPullRequestOnItsWay: boolean = Boolean(
    pullRequest?.existing && ON_ITS_WAY.includes(pullRequest.existing.state),
  );
  const askableCandidates: Array<DeclaredCodeOwnerCandidateJSON> = (
    pullRequest?.candidates || []
  ).filter((candidate: DeclaredCodeOwnerCandidateJSON): boolean => {
    return candidate.canAsk;
  });
  const chosen: DeclaredCodeOwnerCandidateJSON | undefined =
    askableCandidates.find((candidate: DeclaredCodeOwnerCandidateJSON) => {
      return candidate.repositoryId === repositoryId;
    });
  const isPullRequestIncluded: boolean = parts.includes(
    DataSecurityIssueGroupFixPart.PullRequest,
  );
  const isCloudIncluded: boolean = parts.includes(
    DataSecurityIssueGroupFixPart.Cloud,
  );
  const canPress: boolean =
    Boolean(plan) &&
    parts.length > 0 &&
    (!isPullRequestIncluded || isPullRequestOnItsWay || Boolean(chosen)) &&
    (plan
      ? countIssueGroupFixStores(
          {
            pullRequest: isPullRequestIncluded ? plan.pullRequest : undefined,
            cloud: isCloudIncluded ? plan.cloud : undefined,
            leftOut: plan.leftOut,
          },
          ticked,
        ) > 0
      : false);

  const setPart: (
    part: DataSecurityIssueGroupFixPart,
    isIncluded: boolean,
  ) => void = (
    part: DataSecurityIssueGroupFixPart,
    isIncluded: boolean,
  ): void => {
    setParts((current: Array<DataSecurityIssueGroupFixPart>) => {
      const others: Array<DataSecurityIssueGroupFixPart> = current.filter(
        (item: DataSecurityIssueGroupFixPart): boolean => {
          return item !== part;
        },
      );

      return isIncluded ? [...others, part] : others;
    });
  };

  const fix: () => Promise<void> = async (): Promise<void> => {
    if (!plan || !canPress) {
      return;
    }

    setIsFixing(true);
    setError("");

    try {
      const result: DataSecurityIssueGroupFixResultJSON =
        await DataSecurityApi.fixIssueGroup({
          groupId: props.group.groupId,
          parts,
          planFingerprint: plan.planFingerprint,
          codeRepositoryId:
            isPullRequestIncluded && !isPullRequestOnItsWay
              ? chosen?.repositoryId
              : undefined,
          includeDataStoreIds: isCloudIncluded ? ticked : [],
        });
      const problems: Array<string> = [];
      let didSomething: boolean = false;

      if (result.pullRequest) {
        if (result.pullRequest.aiRunId) {
          didSomething = true;
          Toast.success(
            translator.translateText(
              result.pullRequest.wasAlreadyAsked
                ? PULL_REQUEST_ON_ITS_WAY
                : PULL_REQUEST_STARTED,
            ) || PULL_REQUEST_STARTED,
          );
        } else {
          problems.push(
            translator.translateText(result.pullRequest.message) ||
              result.pullRequest.message,
          );
        }
      }

      if (result.cloud) {
        if (result.cloud.refusal) {
          problems.push(
            translator.translateText(result.cloud.refusal) ||
              result.cloud.refusal,
          );
        } else {
          const done: number = result.cloud.changed + result.cloud.unchanged;

          if (done > 0) {
            didSomething = true;
            Toast.success(
              translator.translatePlural(CLOUD_PART_DONE, done, {
                action:
                  translator.translateText(result.cloud.action) ||
                  result.cloud.action,
              }),
            );
          }

          if (result.cloud.failed.length > 0) {
            Toast.error(
              translator.translatePlural(
                CLOUD_PART_FAILED,
                result.cloud.failed.length,
                { reason: result.cloud.failed[0]!.message },
              ),
            );
          }
        }
      }

      if (didSomething) {
        props.onFixed();
      }

      if (problems.length > 0) {
        setError(problems.join(" "));
      } else if (didSomething) {
        props.onClose();
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsFixing(false);
  };

  const leftOut: Array<DataSecurityIssueGroupLeftOutJSON> = plan
    ? plan.leftOut
    : [];

  return (
    <Modal
      title={FIX_THE_CAUSE}
      description={<span>{getGroupHeadline(props.group, translator)}</span>}
      submitButtonText={FIX_THE_CAUSE}
      onSubmit={() => {
        void fix();
      }}
      onClose={props.onClose}
      isLoading={isFixing}
      disableSubmitButton={!canPress}
      error={error || undefined}
      modalWidth={ModalWidth.Medium}
    >
      <div className="space-y-5" data-testid={ISSUE_GROUP_FIX_TEST_ID}>
        {state.kind === "loading" ? <DetailListSkeleton /> : <></>}

        {state.kind === "failed" ? (
          <p className="text-sm text-red-700">
            {translator.translateText(FIX_PLAN_NOT_LOADED)} {state.error}
          </p>
        ) : (
          <></>
        )}

        {plan ? (
          <p className="text-sm text-gray-600">
            {translator.translateText(FIX_DIALOG_DESCRIPTION)}
          </p>
        ) : (
          <></>
        )}

        {pullRequest ? (
          <section
            className="border-t border-gray-200 pt-4"
            data-testid={`${ISSUE_GROUP_FIX_TEST_ID}-pull-request`}
          >
            <PartHeading
              title={PULL_REQUEST_PART_TITLE}
              icon={IconProp.Code}
              isChoosable={isChoosable && !pullRequest.refusal}
              isIncluded={isPullRequestIncluded}
              onChange={(value: boolean) => {
                setPart(DataSecurityIssueGroupFixPart.PullRequest, value);
              }}
              testId={`${ISSUE_GROUP_FIX_TEST_ID}-pull-request-included`}
            />
            <p className="mt-1 text-sm text-gray-700">
              {translator.translatePlural(
                PULL_REQUEST_PART_SENTENCE,
                pullRequest.stores.length,
                {
                  code:
                    pullRequest.codeKind ||
                    translator.translateText(INFRASTRUCTURE_CODE) ||
                    INFRASTRUCTURE_CODE,
                },
              )}
            </p>
            {pullRequest.location && pullRequest.location.paths.length > 0 ? (
              <p className="mt-1 text-xs text-gray-500 [overflow-wrap:anywhere]">
                {translator.translateTemplate(
                  PULL_REQUEST_CODE_FOUND,
                  {
                    paths: formatList(pullRequest.location.paths, translator),
                  },
                  { setsValuesApart: true },
                )}
              </p>
            ) : (
              <></>
            )}
            <StoreNames stores={pullRequest.stores} />

            {pullRequest.refusal ? (
              <PartRefusal message={pullRequest.refusal} />
            ) : isPullRequestOnItsWay ? (
              <p className="mt-2 text-sm text-gray-600">
                {translator.translateText(PULL_REQUEST_ON_ITS_WAY)}
              </p>
            ) : isPullRequestIncluded ? (
              <div className="mt-3">
                <label
                  className="block text-xs font-medium text-gray-700"
                  htmlFor={`${ISSUE_GROUP_FIX_TEST_ID}-repository`}
                >
                  {translator.translateText(PULL_REQUEST_REPOSITORY)}
                </label>
                <div className="mt-1">
                  <Dropdown
                    inputId={`${ISSUE_GROUP_FIX_TEST_ID}-repository`}
                    dataTestId={`${ISSUE_GROUP_FIX_TEST_ID}-repository`}
                    placeholder={PULL_REQUEST_PICK_REPOSITORY}
                    options={askableCandidates.map(
                      (
                        candidate: DeclaredCodeOwnerCandidateJSON,
                      ): DropdownOption => {
                        return {
                          value: candidate.repositoryId,
                          label: candidate.fullName || candidate.name,
                          isUserContent: true,
                        };
                      },
                    )}
                    value={
                      chosen
                        ? {
                            value: chosen.repositoryId,
                            label: chosen.fullName || chosen.name,
                            isUserContent: true,
                          }
                        : undefined
                    }
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ) => {
                      setRepositoryId(
                        typeof value === "string" ? value : String(value || ""),
                      );
                    }}
                  />
                </div>
                {chosen ? (
                  <p className="mt-1 text-xs text-gray-500 [overflow-wrap:anywhere]">
                    {translator.translateTemplate(
                      DECLARED_CODE_REASON_WORDS[chosen.reason],
                      {
                        code:
                          pullRequest.codeKind ||
                          translator.translateText(INFRASTRUCTURE_CODE) ||
                          INFRASTRUCTURE_CODE,
                        path: chosen.matchedPaths[0] || "",
                      },
                      { setsValuesApart: true },
                    )}
                  </p>
                ) : (
                  <></>
                )}
              </div>
            ) : (
              <></>
            )}
          </section>
        ) : (
          <></>
        )}

        {cloud ? (
          <section
            className="border-t border-gray-200 pt-4"
            data-testid={`${ISSUE_GROUP_FIX_TEST_ID}-cloud`}
          >
            <PartHeading
              title={CLOUD_PART_TITLE}
              icon={IconProp.Cloud}
              isChoosable={isChoosable && !cloud.refusal}
              isIncluded={isCloudIncluded}
              onChange={(value: boolean) => {
                setPart(DataSecurityIssueGroupFixPart.Cloud, value);
              }}
              testId={`${ISSUE_GROUP_FIX_TEST_ID}-cloud-included`}
            />
            <p className="mt-1 text-sm text-gray-700">
              {translator.translatePlural(
                CLOUD_PART_SENTENCE,
                cloud.stores.length,
                {
                  action:
                    translator.translateText(cloud.action) || cloud.action,
                },
              )}
            </p>
            <StoreNames stores={cloud.stores} />
            {cloud.refusal ? (
              <PartRefusal message={cloud.refusal} />
            ) : (
              <p className="mt-2 text-xs text-gray-500">
                {translator.translateText(CLOUD_PART_NOTE)}
              </p>
            )}
          </section>
        ) : (
          <></>
        )}

        {leftOut.length > 0 ? (
          <section
            className="border-t border-gray-200 pt-4"
            data-testid={`${ISSUE_GROUP_FIX_TEST_ID}-left-out`}
          >
            <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <Icon icon={IconProp.Minus} className="h-4 w-4 text-gray-400" />
              <span>{translator.translateText(LEFT_OUT_TITLE)}</span>
            </h4>
            <p className="mt-1 text-sm text-gray-700">
              {translator.translatePlural(LEFT_OUT_SENTENCE, leftOut.length)}
            </p>
            <ul className="mt-2 divide-y divide-gray-100">
              {leftOut.map(
                (store: DataSecurityIssueGroupLeftOutJSON): ReactElement => {
                  const canTick: boolean =
                    store.canInclude && isCloudIncluded && !cloud?.refusal;

                  return (
                    <li
                      key={`${store.part}-${store.dataStoreId}`}
                      className="py-2"
                      data-reason={store.reason}
                    >
                      <p className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                        <IsolatedText text={store.name || store.dataStoreId} />
                      </p>
                      <p className="mt-0.5 text-xs text-gray-600">
                        {translator.translateTemplate(
                          LEFT_OUT_REASONS[store.reason],
                          store.reason ===
                            DataSecurityIssueGroupLeftOutReason.FixWouldBreak
                            ? {
                                who: formatList(store.breaks || [], translator),
                              }
                            : {},
                          { setsValuesApart: true },
                        )}
                      </p>
                      {canTick ? (
                        <div className="mt-1">
                          <CheckboxElement
                            title={FIX_IT_ANYWAY}
                            value={ticked.includes(store.dataStoreId)}
                            dataTestId={`${ISSUE_GROUP_FIX_TEST_ID}-tick-${store.dataStoreId}`}
                            onChange={(value: boolean) => {
                              setTicked((current: Array<string>) => {
                                const others: Array<string> = current.filter(
                                  (id: string): boolean => {
                                    return id !== store.dataStoreId;
                                  },
                                );

                                return value
                                  ? [...others, store.dataStoreId]
                                  : others;
                              });
                            }}
                          />
                        </div>
                      ) : (
                        <></>
                      )}
                    </li>
                  );
                },
              )}
            </ul>
          </section>
        ) : (
          <></>
        )}

        {plan &&
        offered.length === 0 &&
        !pullRequest?.refusal &&
        !cloud?.refusal ? (
          <p className="text-sm text-gray-600">
            {translator.translateText(NOTHING_TO_FIX_HERE)}
          </p>
        ) : (
          <></>
        )}
      </div>
    </Modal>
  );
};

export default IssueGroupFixModal;
