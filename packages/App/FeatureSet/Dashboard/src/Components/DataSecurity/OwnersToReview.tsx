import DataSecurityApi from "./DataSecurityApi";
import {
  DATA_SECURITY_AI_TABLE_IDS,
  DataSecurityAiPageCopy,
  OwnersToReviewCopy,
} from "./DataSecurityAiCopy";
import {
  DATA_SECURITY_AI_PROPOSAL_DIALOG_SELECT,
  DataSecurityAiProposalActions,
  useDataSecurityAiProposalActions,
} from "./DataSecurityAiProposalActions";
import {
  OwnerProposalOwner,
  OwnerProposalView,
  canChangeOwnersFirst,
  getOwnerConfidenceChip,
  getOwnerProposalRoute,
  readOwnerProposalView,
  rulesFirst,
  toOwnerChanges,
  toOwnersFormValues,
} from "./OwnersToReviewData";
import DataSecurityAiProposal from "Common/Models/DatabaseModels/DataSecurityAiProposal";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DATA_SECURITY_AI_OWNER_PROPOSAL_KINDS,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  getDataSecurityAiPlanFingerprint,
  isDataSecurityAiProposalWaiting,
} from "Common/Types/DataSecurity/DataSecurityAi";
import { DataStoreOwnerKind } from "Common/Types/DataSecurity/DataStoreOwnerProposal";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import { BulkActionOnClickProps } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import getOwnersFormField from "Common/UI/Components/PeoplePicker/OwnersFormField";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "Common/UI/Components/SideMenu/CountModelSideMenuItem";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * OWNERS TO REVIEW (#10374): the owners OneUptime AI proposes for stores
 * that have none, and the owner rules that keep stores like them owned -
 * on Data Security → AI and on Data Stores, while any wait.
 *
 *   - It says how many: "OneUptime AI proposes owners for 42 stores." and
 *     the rules beside them, and is not drawn while none waits.
 *   - Rules first, then the sensitive stores, riskiest first: one rule's
 *     approval owns every store it matches, and the next one found.
 *   - Each store's row says who, how sure OneUptime AI is and why, and
 *     where the evidence disagrees; an owner who cannot open the store says
 *     so. Each rule's row says whom it adds and to how many stores.
 *   - Approve all, or some: select them, then Approve, which runs one at a
 *     time, rules first, and can be stopped. Or open one: Approve shows the
 *     whole proposal first; Change and Approve picks other owners for a
 *     store; Dismiss proposal asks why.
 *
 * Every press goes through Data Security's own routes, which decide it with
 * the person's own permissions and say why when they will not.
 */

export interface ComponentProps {
  // Told once a proposal was acted on: the page's other lists read again.
  onChanged?: (() => void) | undefined;
}

interface WaitingCounts {
  stores: number;
  rules: number;
}

async function countWaiting(kind: DataSecurityAiProposalKind): Promise<number> {
  return await ModelAPI.count<DataSecurityAiProposal>({
    modelType: DataSecurityAiProposal,
    query: { status: DataSecurityAiProposalStatus.Proposed, kind },
  });
}

const OwnersToReview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [counts, setCounts] = useState<WaitingCounts | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>("");
  const [changing, setChanging] = useState<DataSecurityAiProposal | null>(null);
  const [changeError, setChangeError] = useState<string>("");
  const [isChanging, setIsChanging] = useState<boolean>(false);

  const readCounts: () => Promise<void> = useCallback(async () => {
    try {
      const [stores, rules]: [number, number] = await Promise.all([
        countWaiting(DataSecurityAiProposalKind.SetStoreOwners),
        countWaiting(DataSecurityAiProposalKind.CreateOwnerRule),
      ]);

      setCounts({ stores, rules });
    } catch {
      // A reader who may not read proposals has nothing to review here.
      setCounts({ stores: 0, rules: 0 });
    }
  }, []);

  useEffect(() => {
    void readCounts();
  }, [readCounts]);

  const onChanged: () => void = (): void => {
    setRefreshToggle(ObjectID.generate().toString());
    void readCounts();
    GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
    props.onChanged?.();
  };

  const actions: DataSecurityAiProposalActions =
    useDataSecurityAiProposalActions(onChanged);

  if (!counts || counts.stores + counts.rules === 0) {
    return <></>;
  }

  const description: ReactElement = (
    <span data-testid="owners-to-review-counts">
      {counts.stores > 0
        ? translator.translatePlural(OwnersToReviewCopy.stores, counts.stores)
        : ""}
      {counts.stores > 0 && counts.rules > 0 ? " " : ""}
      {counts.rules > 0
        ? translator.translatePlural(OwnersToReviewCopy.rules, counts.rules)
        : ""}
    </span>
  );

  const approveOne: (
    proposal: DataSecurityAiProposal,
  ) => Promise<BulkItemOutcome | void> = async (
    proposal: DataSecurityAiProposal,
  ): Promise<BulkItemOutcome | void> => {
    try {
      await DataSecurityApi.approveAiProposal({
        proposalId: new ObjectID(proposal._id!.toString()),
        expectedPlanFingerprint: getDataSecurityAiPlanFingerprint({
          kind: proposal.kind,
          plan: proposal.plan,
        }),
      });

      return BULK_ITEM_CHANGED;
    } catch (error) {
      // Settled meanwhile - a rule approved just before owned its store.
      const now: DataSecurityAiProposal | null = await ModelAPI.getItem({
        modelType: DataSecurityAiProposal,
        id: new ObjectID(proposal._id!.toString()),
        select: { status: true },
      }).catch(() => {
        return null;
      });

      if (now && !isDataSecurityAiProposalWaiting(now.status)) {
        return bulkItemUnchanged(
          translator.translateText(OwnersToReviewCopy.noLongerWaiting) ||
            OwnersToReviewCopy.noLongerWaiting,
        );
      }

      throw error;
    }
  };

  const ownersCell: (item: DataSecurityAiProposal) => ReactElement = (
    item: DataSecurityAiProposal,
  ): ReactElement => {
    const view: OwnerProposalView | null = readOwnerProposalView(item);

    if (!view || view.owners.length === 0) {
      return <TableEmptyValue />;
    }

    return (
      <div className="flex flex-wrap gap-1">
        {view.owners.map((owner: OwnerProposalOwner): ReactElement => {
          return (
            <span key={`${owner.kind}:${owner.id}`} className="inline-flex">
              <Pill
                text={owner.name}
                isUserContent={true}
                icon={
                  owner.kind === DataStoreOwnerKind.Team
                    ? IconProp.Team
                    : IconProp.User
                }
                tone={owner.canOpenStore ? PillTone.Neutral : PillTone.Warning}
                tooltip={
                  owner.canOpenStore ? undefined : OwnersToReviewCopy.cannotOpen
                }
              />
            </span>
          );
        })}
      </div>
    );
  };

  const proposalCell: (item: DataSecurityAiProposal) => ReactElement = (
    item: DataSecurityAiProposal,
  ): ReactElement => {
    const view: OwnerProposalView | null = readOwnerProposalView(item);

    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-900">
          <IsolatedText text={item.title || ""} />
        </p>
        {view?.kind === "rule" ? (
          <p className="text-sm text-gray-600">
            {translator.translatePlural(
              OwnersToReviewCopy.ruleWouldSet,
              view.matchingStores,
            )}
            {view.alreadyOwned > 0 ? " " : ""}
            {view.alreadyOwned > 0
              ? translator.translatePlural(
                  OwnersToReviewCopy.ruleAlreadyOwned,
                  view.alreadyOwned,
                )
              : ""}
          </p>
        ) : (
          <></>
        )}
        {view?.kind === "store" && view.reason ? (
          <p className="text-sm text-gray-600">
            <IsolatedText text={view.reason} />
          </p>
        ) : (
          <></>
        )}
        {view?.kind === "store" && view.disagreement ? (
          <p className="text-sm text-gray-600">
            <span className="font-medium">
              {translator.translateText(OwnersToReviewCopy.evidenceDisagrees)}
            </span>{" "}
            <IsolatedText text={view.disagreement} />
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <>
      <ModelTable<DataSecurityAiProposal>
        modelType={DataSecurityAiProposal}
        id={DATA_SECURITY_AI_TABLE_IDS.owners}
        userPreferencesKey={DATA_SECURITY_AI_TABLE_IDS.owners}
        name="Data Security AI: Owners to review"
        query={{
          status: DataSecurityAiProposalStatus.Proposed,
          kind: new Includes([...DATA_SECURITY_AI_OWNER_PROPOSAL_KINDS]),
        }}
        refreshToggle={refreshToggle}
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        onViewPage={(item: DataSecurityAiProposal): Promise<Route> => {
          return Promise.resolve(getOwnerProposalRoute(item));
        }}
        showRefreshButton={true}
        filters={[]}
        sortBy="riskScore"
        sortOrder={SortOrder.Descending}
        cardProps={{
          title: OwnersToReviewCopy.title,
          description: description,
        }}
        noItemsMessage={DataSecurityAiPageCopy.waitingEmpty}
        selectMoreFields={{
          ...DATA_SECURITY_AI_PROPOSAL_DIALOG_SELECT,
          dataStoreId: true,
        }}
        bulkActions={{
          buttons: [
            {
              title: DataSecurityAiPageCopy.approve,
              icon: IconProp.Check,
              buttonStyleType: ButtonStyleType.NORMAL,
              confirmTitle: (items: Array<DataSecurityAiProposal>): string => {
                return translator.translatePlural(
                  OwnersToReviewCopy.bulkApproveTitle,
                  items.length,
                );
              },
              confirmMessage: (): string => {
                return (
                  translator.translateText(
                    OwnersToReviewCopy.bulkApproveMessage,
                  ) || OwnersToReviewCopy.bulkApproveMessage
                );
              },
              confirmButtonStyleType: ButtonStyleType.PRIMARY,
              onClick: async (
                actionProps: BulkActionOnClickProps<DataSecurityAiProposal>,
              ): Promise<void> => {
                try {
                  await runBulkAction<DataSecurityAiProposal>({
                    actionProps: {
                      ...actionProps,
                      items: rulesFirst(actionProps.items),
                    },
                    // One at a time: a rule approved first settles its stores.
                    concurrency: 1,
                    step: approveOne,
                  });
                } finally {
                  onChanged();
                }
              },
            },
          ],
        }}
        actionButtons={[
          {
            title: DataSecurityAiPageCopy.approve,
            icon: IconProp.Check,
            buttonStyleType: ButtonStyleType.NORMAL,
            placement: ActionButtonPlacement.Primary,
            onClick: (
              item: DataSecurityAiProposal,
              onCompleteAction: VoidFunction,
            ) => {
              actions.approve(item);
              onCompleteAction();
            },
          },
          {
            title: OwnersToReviewCopy.changeAndApprove,
            icon: IconProp.Edit,
            buttonStyleType: ButtonStyleType.NORMAL,
            isVisible: (item: DataSecurityAiProposal): boolean => {
              return canChangeOwnersFirst(item);
            },
            onClick: (
              item: DataSecurityAiProposal,
              onCompleteAction: VoidFunction,
            ) => {
              setChangeError("");
              setChanging(item);
              onCompleteAction();
            },
          },
          {
            title: DataSecurityAiPageCopy.dismiss,
            icon: IconProp.Close,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: (
              item: DataSecurityAiProposal,
              onCompleteAction: VoidFunction,
            ) => {
              actions.dismiss(item);
              onCompleteAction();
            },
          },
        ]}
        columns={[
          {
            field: { title: true },
            title: OwnersToReviewCopy.proposal,
            type: FieldType.Element,
            disableSort: true,
            wrapContent: true,
            wrapMaxWidthClassName: "max-w-md",
            getExportValue: (item: DataSecurityAiProposal): string => {
              return item.title || "";
            },
            getElement: proposalCell,
          },
          {
            field: { plan: true },
            title: OwnersToReviewCopy.owners,
            type: FieldType.Element,
            disableSort: true,
            getElement: ownersCell,
          },
          {
            field: { riskScore: true },
            title: OwnersToReviewCopy.howSure,
            type: FieldType.Element,
            disableSort: true,
            hideOnMobile: true,
            getElement: (item: DataSecurityAiProposal): ReactElement => {
              const view: OwnerProposalView | null =
                readOwnerProposalView(item);

              if (view?.kind !== "store") {
                return <TableEmptyValue />;
              }

              const chip: { text: string; tone: PillTone } =
                getOwnerConfidenceChip(view.confidence);

              return <Pill text={chip.text} tone={chip.tone} />;
            },
          },
        ]}
      />

      {changing?._id ? (
        <BasicFormModal<JSONObject>
          title={OwnersToReviewCopy.changeTitle}
          description={OwnersToReviewCopy.changeDescription}
          submitButtonText={DataSecurityAiPageCopy.approve}
          isSubmitting={isChanging}
          error={changeError || undefined}
          onClose={() => {
            setChanging(null);
            setChangeError("");
          }}
          formProps={{
            name: "Change the owners, then approve",
            initialValues: toOwnersFormValues(
              readOwnerProposalView(changing)?.owners || [],
            ),
            fields: [
              getOwnersFormField<JSONObject>({
                title: OwnersToReviewCopy.ownersField,
                required: true,
              }),
            ],
          }}
          onSubmit={async (values: FormValues<JSONObject>) => {
            setIsChanging(true);
            setChangeError("");

            try {
              await DataSecurityApi.approveAiProposal({
                proposalId: new ObjectID(changing._id!.toString()),
                expectedPlanFingerprint: getDataSecurityAiPlanFingerprint({
                  kind: changing.kind,
                  plan: changing.plan,
                }),
                changes: toOwnerChanges(values as JSONObject),
              });
              setChanging(null);
              onChanged();
            } catch (error) {
              setChangeError(API.getFriendlyMessage(error));
            }

            setIsChanging(false);
          }}
        />
      ) : (
        <></>
      )}

      {actions.dialogs}
    </>
  );
};

export default OwnersToReview;
