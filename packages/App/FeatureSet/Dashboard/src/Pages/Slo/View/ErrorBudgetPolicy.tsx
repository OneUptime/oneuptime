import PageComponentProps from "../../PageComponentProps";
import {
  ERROR_BUDGET_POLICY_TIER_FORM_FIELDS,
  describePolicyTierOutputOptions,
  describePolicyTierOutputs,
} from "../Utils/ErrorBudgetPolicyTierForm";
import SloNoticeBanner from "../../../Components/Slo/SloNoticeBanner";
import {
  POLICY_TIER_BUDGET_LEFT_TEMPLATE,
  POLICY_TIER_ENTERED_TEMPLATE,
  describePolicyTierDeployments,
} from "../../../Components/Slo/SloPolicyTier";
import SloRecommendedPolicyTiersModal, {
  USE_RECOMMENDED_POLICY_TITLE,
} from "../../../Components/Slo/SloRecommendedPolicyTiersModal";
import useSloRecommendedPolicyTiers, {
  UseSloRecommendedPolicyTiersResult,
} from "../../../Components/Slo/useSloRecommendedPolicyTiers";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "Common/Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Gray500, Green, Red } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import { TableEmptyStateAction } from "Common/UI/Components/Table/TableEmptyState";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  areSloDeploymentsAllowedInTier,
  formatSloPolicyTierThreshold,
  isSameSloPolicyTier,
} from "Common/Utils/Slo/SloErrorBudgetPolicy";
import {
  SLO_AT_RISK_RECOVERY_MARGIN_PERCENTAGE,
  SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE,
} from "Common/Utils/Slo/SloEvaluation";
import { getSloPolicyTierColor } from "Common/Utils/Slo/SloStatusColor";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { drawsItsOwnLines } from "Common/UI/Components/Table/ColumnLineText";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";

export const ERROR_BUDGET_POLICY_TABLE_ID: string =
  "slo-error-budget-policy-table";

export const USE_RECOMMENDED_POLICY_BUTTON_TEST_ID: string =
  "slo-use-recommended-policy";

export const CURRENT_POLICY_TIER_TEST_ID: string = "slo-current-policy-tier";

export const POLICY_TIER_DEPLOYMENTS_TEST_ID: string =
  "slo-policy-tier-deployments";

// The tier the SLO is in, as the worker wrote it on the SLO.
interface CurrentTier {
  id: ObjectID | null;
  enteredAt: Date | null;
}

/*
 * An SLO's error budget policy: its tiers, from the one the budget reaches
 * first (the highest threshold) down to the tier of an exhausted budget,
 * each with what the team agreed to do there, whether it freezes
 * deployments and what it raises when the SLO enters it. The tier the SLO
 * is in now is marked on its row.
 *
 * An SLO with no policy yet is offered the recommended one in the table's
 * empty state: "Use the recommended policy" lists exactly the tiers it adds,
 * none of which pages anyone, and adds them once confirmed. Someone who may
 * not create tiers sees it locked, with why, like the table's own Create.
 */
const SloErrorBudgetPolicy: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const sloKey: string = modelId.toString();

  const [currentTier, setCurrentTier] = useState<CurrentTier | null>(null);

  /*
   * An archived SLO is not evaluated, so a policy never applies to it: the
   * starter is not offered there. Null until the SLO is read, so it never
   * flashes on an archived SLO's page first.
   */
  const [isArchived, setIsArchived] = useState<boolean | null>(null);

  const recommended: UseSloRecommendedPolicyTiersResult =
    useSloRecommendedPolicyTiers(modelId);
  const [isRecommendedModalOpen, setIsRecommendedModalOpen] =
    useState<boolean>(false);
  const [isAddingRecommended, setIsAddingRecommended] =
    useState<boolean>(false);
  const [addRecommendedError, setAddRecommendedError] = useState<string>("");
  const [tiersRefreshToggle, setTiersRefreshToggle] = useState<string>("");

  // Locked with the reason, like the table's own Create button.
  const createGate: PermissionGateResult = PermissionGate.check(
    new ServiceLevelObjectiveErrorBudgetPolicyTier(),
    ModelAction.Create,
  );

  // Only the latest read of the SLO is kept.
  const sloRequestRef: React.MutableRefObject<number> = useRef<number>(0);

  /*
   * The tier the SLO is in moves with its budget, not with the tiers, so it
   * is read whenever the table reads its rows: on open, on Refresh and after
   * every change to them.
   */
  const readSlo: () => Promise<void> = useCallback(async (): Promise<void> => {
    const request: number = sloRequestRef.current + 1;
    sloRequestRef.current = request;

    try {
      const slo: ServiceLevelObjective | null =
        await ModelAPI.getItem<ServiceLevelObjective>({
          modelType: ServiceLevelObjective,
          id: modelId,
          select: {
            isArchived: true,
            currentErrorBudgetPolicyTierId: true,
            currentErrorBudgetPolicyTierEnteredAt: true,
          },
        });

      if (sloRequestRef.current !== request || !slo) {
        return;
      }

      setIsArchived(slo.isArchived === true);
      setCurrentTier({
        id: slo.currentErrorBudgetPolicyTierId || null,
        enteredAt: slo.currentErrorBudgetPolicyTierEnteredAt
          ? OneUptimeDate.fromString(slo.currentErrorBudgetPolicyTierEnteredAt)
          : null,
      });
    } catch {
      // The notice banner and the table say what is wrong; the mark waits.
    }
  }, [sloKey]);

  /*
   * Another SLO's page: what the last one said no longer holds, and a read
   * of it still in flight is let go.
   */
  const shownSloKeyRef: React.MutableRefObject<string> = useRef<string>(sloKey);

  useEffect(() => {
    if (shownSloKeyRef.current !== sloKey) {
      shownSloKeyRef.current = sloKey;
      setCurrentTier(null);
      setIsArchived(null);
    }

    return () => {
      sloRequestRef.current += 1;
    };
  }, [sloKey]);

  const addRecommendedTiers: PromiseVoidFunction = async (): Promise<void> => {
    setIsAddingRecommended(true);
    setAddRecommendedError("");

    try {
      await recommended.addMissingTiers();
      setIsRecommendedModalOpen(false);
    } catch (err) {
      setAddRecommendedError(API.getFriendlyMessage(err));
    }

    setIsAddingRecommended(false);
    // The table reads its rows again, and with them what is still missing.
    setTiersRefreshToggle(OneUptimeDate.getCurrentDate().toISOString());
  };

  // Hidden only while the permission snapshot has not arrived (PermissionGate).
  const isStarterOffered: boolean =
    isArchived === false &&
    recommended.missingTiers.length > 0 &&
    (createGate.isAllowed || Boolean(createGate.disabledReason));

  const starterActions: Array<TableEmptyStateAction> = isStarterOffered
    ? [
        {
          title: USE_RECOMMENDED_POLICY_TITLE,
          icon: IconProp.LightBulb,
          disabled: !createGate.isAllowed,
          tooltip: createGate.disabledReason,
          dataTestId: USE_RECOMMENDED_POLICY_BUTTON_TEST_ID,
          onClick: (): void => {
            if (!createGate.isAllowed) {
              return;
            }

            setAddRecommendedError("");
            setIsRecommendedModalOpen(true);
          },
        },
      ]
    : [];

  type IsCurrentTierFunction = (
    tier: ServiceLevelObjectiveErrorBudgetPolicyTier,
  ) => boolean;

  const isCurrentTier: IsCurrentTierFunction = (
    tier: ServiceLevelObjectiveErrorBudgetPolicyTier,
  ): boolean => {
    return Boolean(
      currentTier?.id && isSameSloPolicyTier(tier._id, currentTier.id),
    );
  };

  return (
    <Fragment>
      <SloNoticeBanner sloId={modelId} />
      <ModelTable<ServiceLevelObjectiveErrorBudgetPolicyTier>
        modelType={ServiceLevelObjectiveErrorBudgetPolicyTier}
        // Enable or Disable in each row's ⋯ menu: the one that changes the row.
        rowSwitch={{ column: "isEnabled" }}
        id={ERROR_BUDGET_POLICY_TABLE_ID}
        name="SLO > Error Budget Policy"
        userPreferencesKey="slo-error-budget-policy-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        showRefreshButton={true}
        refreshToggle={tiersRefreshToggle}
        // The order the budget reaches them: half of it left, then a quarter, then none.
        sortBy="thresholdPercentage"
        sortOrder={SortOrder.Descending}
        onFetchSuccess={(
          tiers: Array<ServiceLevelObjectiveErrorBudgetPolicyTier>,
          totalCount: number,
        ) => {
          recommended.onTiersFetched(tiers, totalCount);
          readSlo().catch(() => {
            // Handled in readSlo.
          });
        }}
        query={{
          serviceLevelObjectiveId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: ServiceLevelObjectiveErrorBudgetPolicyTier,
        ): Promise<ServiceLevelObjectiveErrorBudgetPolicyTier> => {
          item.serviceLevelObjectiveId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Error Budget Policy",
          description: translator.translateTemplate(
            "What the team agreed to do as this SLO's error budget runs down. The SLO stays in the deepest tier its budget reached until the budget is {{margin}} points above its threshold ({{exhausted}}% for a 0% tier).",
            {
              margin: SLO_AT_RISK_RECOVERY_MARGIN_PERCENTAGE,
              exhausted: SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE,
            },
          ),
        }}
        emptyState={{
          title: "No error budget policy yet",
          description:
            "Write down what the team does as this SLO's error budget runs down. Start from the recommended policy, or add tiers of your own.",
          icon: IconProp.Scale,
          actions: starterActions,
        }}
        documentationLink={new Route("/docs/slo/error-budget-policy")}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
        createEditModalWidth={ModalWidth.Large}
        formFields={ERROR_BUDGET_POLICY_TIER_FORM_FIELDS}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            // A badge: its words read their own way (Pill), its dot the page's.
            getLineText: drawsItsOwnLines,
            getElement: (
              item: ServiceLevelObjectiveErrorBudgetPolicyTier,
            ): ReactElement => {
              const isCurrent: boolean = isCurrentTier(item);

              return (
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      <IsolatedText text={item.name || ""} />
                    </span>
                    {isCurrent ? (
                      <span data-testid={CURRENT_POLICY_TIER_TEST_ID}>
                        <Pill
                          color={getSloPolicyTierColor(item)}
                          text="Current tier"
                          size={PillSize.Small}
                        />
                      </span>
                    ) : (
                      <></>
                    )}
                  </div>
                  {isCurrent && currentTier?.enteredAt ? (
                    <div
                      className="mt-0.5 text-xs text-gray-500"
                      title={OneUptimeDate.getDateAsLocalFormattedString(
                        currentTier.enteredAt,
                      )}
                    >
                      {translator.translateTemplate(
                        POLICY_TIER_ENTERED_TEMPLATE,
                        {
                          time: OneUptimeDate.fromNow(currentTier.enteredAt),
                        },
                      )}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              );
            },
          },
          {
            field: {
              thresholdPercentage: true,
            },
            title: "Threshold",
            type: FieldType.Element,
            getElement: (
              item: ServiceLevelObjectiveErrorBudgetPolicyTier,
            ): ReactElement => {
              const threshold: string = formatSloPolicyTierThreshold(
                item.thresholdPercentage,
                translator,
              );

              if (!threshold) {
                return <span className="text-sm text-gray-400">—</span>;
              }

              return (
                <span className="text-sm tabular-nums text-gray-900">
                  {translator.translateTemplate(
                    POLICY_TIER_BUDGET_LEFT_TEMPLATE,
                    { threshold: threshold },
                  )}
                </span>
              );
            },
          },
          {
            field: {
              whatWeDo: true,
            },
            title: "What We Do",
            type: FieldType.Element,
            wrapContent: true,
            getElement: (
              item: ServiceLevelObjectiveErrorBudgetPolicyTier,
            ): ReactElement => {
              if (!item.whatWeDo) {
                return <span className="text-sm text-gray-400">—</span>;
              }

              // Kept to its first lines: the whole of it is in the tier's form.
              return (
                <div
                  className="line-clamp-3 max-w-md text-sm text-gray-700 [&_p]:my-0"
                  title={item.whatWeDo}
                >
                  <MarkdownViewer text={item.whatWeDo} />
                </div>
              );
            },
          },
          {
            field: {
              freezesDeployments: true,
            },
            title: "Deployments",
            type: FieldType.Element,
            getElement: (
              item: ServiceLevelObjectiveErrorBudgetPolicyTier,
            ): ReactElement => {
              /*
               * What CI/CD is told while the SLO is in the tier: a tier that
               * freezes deployments stands out in red, any other reads
               * Allowed, quietly.
               */
              const label: string = describePolicyTierDeployments(item);

              return (
                <span data-testid={POLICY_TIER_DEPLOYMENTS_TEST_ID}>
                  {areSloDeploymentsAllowedInTier(item) ? (
                    <span className="text-sm text-gray-500">
                      {translator.translateText(label)}
                    </span>
                  ) : (
                    <Pill color={Red} text={label} size={PillSize.Small} />
                  )}
                </span>
              );
            },
          },
          {
            field: {
              shouldCreateAlert: true,
            },
            title: "Raises",
            type: FieldType.Element,
            getElement: (
              item: ServiceLevelObjectiveErrorBudgetPolicyTier,
            ): ReactElement => {
              /*
               * What the tier raises when the SLO enters it, and the options
               * nothing else in the row would reveal - a record left open
               * until resolved by hand, or one most of the project cannot see.
               */
              const options: Array<string> =
                describePolicyTierOutputOptions(item);

              return (
                <div>
                  <div className="text-sm text-gray-900">
                    {translator.translateText(describePolicyTierOutputs(item))}
                  </div>
                  {options.map((option: string) => {
                    return (
                      <div key={option} className="text-xs text-gray-500">
                        {translator.translateText(option)}
                      </div>
                    );
                  })}
                </div>
              );
            },
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
            getElement: (
              item: ServiceLevelObjectiveErrorBudgetPolicyTier,
            ): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Gray500} text="Disabled" />;
            },
          },
        ]}
        /*
         * Read by getElement callbacks above but not owned by a column of
         * their own: without these the cells silently render their fallback.
         */
        selectMoreFields={{
          shouldCreateIncident: true,
          isAlertPrivate: true,
          autoResolveAlert: true,
          isIncidentPrivate: true,
          autoResolveIncident: true,
          addSloOwnersAsOwners: true,
        }}
      />
      {isRecommendedModalOpen ? (
        <SloRecommendedPolicyTiersModal
          tiers={recommended.missingTiers}
          isLoading={isAddingRecommended}
          error={addRecommendedError}
          onSubmit={() => {
            addRecommendedTiers().catch(() => {
              // addRecommendedTiers handles its own errors.
            });
          }}
          onClose={() => {
            setIsRecommendedModalOpen(false);
            setAddRecommendedError("");
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default SloErrorBudgetPolicy;
