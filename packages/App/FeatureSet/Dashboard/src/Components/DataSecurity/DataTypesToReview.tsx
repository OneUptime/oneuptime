import DataSecurityApi from "./DataSecurityApi";
import { SensitivityPill } from "./DataSecurityPills";
import {
  countInSentence,
  DataTypesToReviewCopy,
  getPartlyCountedSentence,
  getProofSentence,
  shareInSentence,
} from "./DataTypesToReviewCopy";
import DataSecurityAiProposal from "Common/Models/DatabaseModels/DataSecurityAiProposal";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  getDataSecurityAiPlanFingerprint,
} from "Common/Types/DataSecurity/DataSecurityAi";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DataTypeDraft,
  DataTypeDraftVariant,
  DataTypeGroupField,
  DataTypeProof,
  DataTypeProofField,
  DataTypeProposalPlan,
  getOfferedDraft,
  readDataTypeProposalPlan,
} from "Common/Utils/DataSecurity/DataTypeProposal";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { LABEL_WITH_COLON } from "Common/UI/Utils/LabelWithColon";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * DATA TYPES TO REVIEW (#10371): the data types OneUptime AI found in the
 * fields the project's scans could not place, each proven on its stores'
 * next scans before anyone is asked - at the top of Settings > Data Types
 * and on Data Security > AI, while any waits.
 *
 * Each reads as the proposal it is: "OneUptime AI found a data type your
 * stores keep: Insurance policy number, in 11 fields of 6 stores." - then
 * what the scans counted, "Matches 98% of the values in these 11 fields,
 * and 0.1% of values elsewhere in the same stores." - its sensitivity,
 * category and pattern, and its fields, folded.
 *
 * Add Data Type opens the data type form filled in with the draft
 * (onAdd); the type saved there closes the proposal. Not a Data Type asks
 * once, then turns the proposal down: its group is never proposed again.
 * Every press goes through Data Security's own routes, which decide it
 * with the person's own permissions and say why when they will not.
 */

export const DATA_TYPES_TO_REVIEW_TEST_ID: string =
  "data-security-data-types-to-review";

// The most proposals drawn at once: the ones in the most fields first.
const MAX_SHOWN: number = 20;

export interface DataTypeToReview {
  id: ObjectID;
  plan: DataTypeProposalPlan;
  // The plan the person is shown: approving names it (#10364).
  planFingerprint: string;
}

// A proposal row as the card reads it, or null for one it cannot draw.
export function readDataTypeToReview(
  proposal: DataSecurityAiProposal,
): DataTypeToReview | null {
  const plan: DataTypeProposalPlan | null = readDataTypeProposalPlan(
    proposal.plan,
  );

  if (!proposal._id || !plan?.proof) {
    return null;
  }

  return {
    id: new ObjectID(proposal._id.toString()),
    plan,
    planFingerprint: getDataSecurityAiPlanFingerprint({
      kind: DataSecurityAiProposalKind.AddDataType,
      plan: proposal.plan as JSONObject,
    }),
  };
}

// The waiting proposals, the ones in the most fields first.
export async function readDataTypesToReview(): Promise<
  Array<DataTypeToReview>
> {
  const result: { data: Array<DataSecurityAiProposal> } =
    await ModelAPI.getList<DataSecurityAiProposal>({
      modelType: DataSecurityAiProposal,
      query: {
        kind: DataSecurityAiProposalKind.AddDataType,
        status: DataSecurityAiProposalStatus.Proposed,
      },
      select: { _id: true, plan: true },
      sort: { riskScore: SortOrder.Descending },
      skip: 0,
      limit: MAX_SHOWN,
    });

  return result.data
    .map(readDataTypeToReview)
    .filter((entry: DataTypeToReview | null): entry is DataTypeToReview => {
      return entry !== null;
    });
}

export interface ComponentProps {
  // Opens the data type form filled in with the proposal's draft.
  onAdd: (proposal: DataTypeToReview) => void;
  // Told once a proposal was turned down: the page's other lists read again.
  onChanged?: (() => void) | undefined;
  // Read again whenever it changes: a type saved from the form closed one.
  refreshToggle?: string | undefined;
}

// One field of the group, with what the scans counted in it.
const FieldLine: FunctionComponent<{
  field: DataTypeGroupField;
  counted: DataTypeProofField | undefined;
}> = (props: {
  field: DataTypeGroupField;
  counted: DataTypeProofField | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <li className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <IsolatedText
          text={props.field.storeName}
          className="text-sm text-gray-900"
        />
        <code className="block font-mono text-xs text-gray-600 [overflow-wrap:anywhere]">
          {props.field.location}
        </code>
      </div>
      <span className="flex-shrink-0 text-sm text-gray-700 sm:text-end">
        {props.counted && props.counted.values > 0
          ? translator.translateTemplate(DataTypesToReviewCopy.fieldShare, {
              share: shareInSentence(
                props.counted.matched / props.counted.values,
              ),
            })
          : translator.translateText(DataTypesToReviewCopy.notScanned)}
      </span>
    </li>
  );
};

// One proposal: what it is, what was counted, and its two buttons.
const DataTypeRow: FunctionComponent<{
  proposal: DataTypeToReview;
  onAdd: () => void;
  onNotADataType: () => void;
}> = (props: {
  proposal: DataTypeToReview;
  onAdd: () => void;
  onNotADataType: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const plan: DataTypeProposalPlan = props.proposal.plan;
  const proof: DataTypeProof = plan.proof!;
  const draft: DataTypeDraft = getOfferedDraft(plan);
  const fieldsId: string = `data-type-fields-${props.proposal.id.toString()}`;
  const partly: string = getPartlyCountedSentence(translator, proof);

  return (
    <div
      className="px-5 py-4 md:px-6"
      data-testid={`data-type-to-review-${props.proposal.id.toString()}`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          <Icon
            icon={IconProp.Sparkles}
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-violet-500"
          />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-sm text-gray-900">
              <TranslatedSentence
                template={DataTypesToReviewCopy.found}
                slots={{
                  name: (
                    <strong className="font-semibold">
                      <IsolatedText text={draft.name} />
                    </strong>
                  ),
                }}
                values={{
                  fields: countInSentence(
                    DataTypesToReviewCopy.fields,
                    plan.fieldCount,
                  ),
                  stores: countInSentence(
                    DataTypesToReviewCopy.stores,
                    plan.storeCount,
                  ),
                }}
              />
            </p>
            <p
              className="text-sm text-gray-600"
              data-testid="data-type-to-review-proof"
            >
              {getProofSentence(translator, proof)}
            </p>
            {partly ? (
              <p className="text-xs text-gray-500">{partly}</p>
            ) : (
              <></>
            )}
            {proof.variant === DataTypeDraftVariant.Narrowed ? (
              <p className="text-xs text-gray-500">
                {translator.translateText(DataTypesToReviewCopy.narrowed)}
              </p>
            ) : (
              <></>
            )}
            {proof.alsoIn.length > 0 ? (
              <p className="text-xs text-gray-500">
                {translator.translatePlural(
                  DataTypesToReviewCopy.alsoIn,
                  proof.alsoIn.length,
                )}
              </p>
            ) : (
              <></>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
              <SensitivityPill sensitivity={draft.sensitivity} />
              <span className="text-xs text-gray-500">
                {translator.translateText(draft.category) || draft.category}
              </span>
            </div>
            <div>
              <Button
                title={
                  isOpen
                    ? DataTypesToReviewCopy.hideFields
                    : DataTypesToReviewCopy.showFields
                }
                buttonStyle={ButtonStyleType.LINK}
                buttonSize={ButtonSize.Small}
                icon={isOpen ? IconProp.ChevronUp : IconProp.ChevronDown}
                ariaExpanded={isOpen}
                ariaControls={fieldsId}
                onClick={() => {
                  setIsOpen(!isOpen);
                }}
                dataTestId="data-type-to-review-toggle"
              />
            </div>
            {isOpen ? (
              <div id={fieldsId} className="space-y-2">
                <p className="text-xs text-gray-600">
                  {translator.translateTemplate(LABEL_WITH_COLON, {
                    label:
                      translator.translateText(DataTypesToReviewCopy.pattern) ||
                      DataTypesToReviewCopy.pattern,
                  })}{" "}
                  <code className="font-mono text-xs text-gray-900 [overflow-wrap:anywhere]">
                    {draft.pattern}
                  </code>
                </p>
                <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 px-3">
                  {plan.fields.map(
                    (field: DataTypeGroupField): ReactElement => {
                      return (
                        <FieldLine
                          key={`${field.dataStoreId}|${field.location}`}
                          field={field}
                          counted={proof.fields.find(
                            (entry: DataTypeProofField): boolean => {
                              return (
                                entry.dataStoreId === field.dataStoreId &&
                                entry.location === field.location
                              );
                            },
                          )}
                        />
                      );
                    },
                  )}
                </ul>
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-wrap gap-2 ps-8 lg:ps-0">
          <Button
            title={DataTypesToReviewCopy.add}
            icon={IconProp.Add}
            buttonStyle={ButtonStyleType.NORMAL}
            onClick={props.onAdd}
            dataTestId="data-type-to-review-add"
          />
          <Button
            title={DataTypesToReviewCopy.notADataType}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={props.onNotADataType}
            dataTestId="data-type-to-review-not-a-data-type"
          />
        </div>
      </div>
    </div>
  );
};

const DataTypesToReview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const ruledListClassName: string = useCardRuledListClassName();
  const [proposals, setProposals] = useState<Array<DataTypeToReview>>([]);
  const [provingCount, setProvingCount] = useState<number>(0);
  const [declining, setDeclining] = useState<DataTypeToReview | null>(null);
  const [isDeclining, setIsDeclining] = useState<boolean>(false);
  const [declineError, setDeclineError] = useState<string>("");

  const read: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const [waiting, proving]: [Array<DataTypeToReview>, number] =
        await Promise.all([
          readDataTypesToReview(),
          ModelAPI.count<DataSecurityAiProposal>({
            modelType: DataSecurityAiProposal,
            query: {
              kind: DataSecurityAiProposalKind.AddDataType,
              status: DataSecurityAiProposalStatus.Proving,
            },
          }),
        ]);

      setProposals(waiting);
      setProvingCount(proving);
    } catch {
      // A reader who may not read proposals has nothing to review here.
      setProposals([]);
      setProvingCount(0);
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read, props.refreshToggle]);

  const decline: () => Promise<void> = async (): Promise<void> => {
    if (!declining || isDeclining) {
      return;
    }

    setIsDeclining(true);
    setDeclineError("");

    try {
      await DataSecurityApi.dismissAiProposal({
        proposalId: declining.id,
        reason:
          translator.translateText(DataTypesToReviewCopy.notADataTypeReason) ||
          DataTypesToReviewCopy.notADataTypeReason,
      });
      Toast.success(
        translator.translateTemplate(DataTypesToReviewCopy.notProposedAgain, {
          name: getOfferedDraft(declining.plan).name,
        }),
      );
      setDeclining(null);
      GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
      props.onChanged?.();
      await read();
    } catch (error) {
      setDeclineError(API.getFriendlyMessage(error));
    }

    setIsDeclining(false);
  };

  if (proposals.length === 0) {
    return <></>;
  }

  return (
    <>
      <Card
        title={DataTypesToReviewCopy.cardTitle}
        description={DataTypesToReviewCopy.cardDescription}
      >
        <div data-testid={DATA_TYPES_TO_REVIEW_TEST_ID}>
          <div className={ruledListClassName}>
            {proposals.map((proposal: DataTypeToReview): ReactElement => {
              return (
                <DataTypeRow
                  key={proposal.id.toString()}
                  proposal={proposal}
                  onAdd={() => {
                    props.onAdd(proposal);
                  }}
                  onNotADataType={() => {
                    setDeclineError("");
                    setDeclining(proposal);
                  }}
                />
              );
            })}
          </div>
          {provingCount > 0 ? (
            <p
              className="px-5 pt-3 text-xs text-gray-500 md:px-6"
              data-testid="data-types-to-review-proving"
            >
              {translator.translatePlural(
                DataTypesToReviewCopy.proving,
                provingCount,
              )}
            </p>
          ) : (
            <></>
          )}
        </div>
      </Card>

      {declining ? (
        <ConfirmModal
          title={DataTypesToReviewCopy.notADataTypeTitle}
          description={
            <p>
              {translator.translateTemplate(
                DataTypesToReviewCopy.notADataTypeDescription,
                { name: getOfferedDraft(declining.plan).name },
              )}
            </p>
          }
          submitButtonText={DataTypesToReviewCopy.notADataType}
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isDeclining}
          error={declineError || undefined}
          onClose={() => {
            setDeclining(null);
          }}
          onSubmit={() => {
            void decline();
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default DataTypesToReview;
