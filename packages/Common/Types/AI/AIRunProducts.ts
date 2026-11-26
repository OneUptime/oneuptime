import AIRunType from "./AIRunType";
import ProductKey from "../Product/ProductKey";

/*
 * THE PRODUCTS AN AI RUN WORKS ON, WHILE ONE IS SWITCHED OFF ON THE SERVER
 * (#9489).
 *
 * OneUptime AI's own records - its runs, their events, its fixes - are of no
 * product (ProductRecordTables). What a run works on is: an investigation
 * posts its report to its incident or alert, a fix acts on the record it is
 * for, a code fix opens a pull request in Code's repositories, an AI Chat
 * conversation is AI Chat's, a runbook pick picks one of Runbooks'. While
 * the server has one of those products switched off, the run is not started
 * (AIRunService, the investigation queue) and a code fix is not handed to an
 * AI agent: a switched-off product's data does not change, not even by
 * OneUptime AI. What already ran stays, and is read as before.
 *
 * Read from the run's own fields, so the same rule answers before a run is
 * created and when a queued one is claimed. Pure.
 */

export interface AIRunSubject {
  runType?: AIRunType | undefined;
  triggeredByIncidentId?: unknown;
  triggeredByAlertId?: unknown;
  followUpForAlertId?: unknown;
  triggeredByTelemetryExceptionId?: unknown;
  triggeredByAiInsightId?: unknown;
  triggeredBySecurityCaseId?: unknown;
  triggeredByDataSecurityIssueId?: unknown;
  codeTaskId?: unknown;
  codeRepositoryId?: unknown;
}

const isSet: (value: unknown) => boolean = (value: unknown): boolean => {
  return value !== undefined && value !== null && value !== "";
};

// What each kind of run works on, whatever its record.
const PRODUCTS_OF_RUN_TYPE: Readonly<
  Record<AIRunType, ReadonlyArray<ProductKey>>
> = {
  // A conversation with OneUptime AI: Ask AI's, or the investigation box's.
  [AIRunType.Chat]: [ProductKey.AIChat],
  [AIRunType.Investigation]: [],
  // A pull request in one of Code's repositories.
  [AIRunType.CodeFix]: [ProductKey.Code],
  // The runbook that fits, picked from Runbooks'.
  [AIRunType.RemediationPlan]: [ProductKey.Runbooks],
  [AIRunType.RemediationExecution]: [],
  // A security case: Security Events, from the case it works.
  [AIRunType.SecurityCaseResponse]: [],
};

export const getProductsOfAIRun: (run: AIRunSubject) => Array<ProductKey> = (
  run: AIRunSubject,
): Array<ProductKey> => {
  const products: Array<ProductKey> = [
    ...(run.runType ? PRODUCTS_OF_RUN_TYPE[run.runType] || [] : []),
  ];

  const add: (product: ProductKey, when: boolean) => void = (
    product: ProductKey,
    when: boolean,
  ): void => {
    if (when && !products.includes(product)) {
      products.push(product);
    }
  };

  add(ProductKey.Incidents, isSet(run.triggeredByIncidentId));
  add(
    ProductKey.Alerts,
    isSet(run.triggeredByAlertId) || isSet(run.followUpForAlertId),
  );
  add(ProductKey.Exceptions, isSet(run.triggeredByTelemetryExceptionId));
  add(ProductKey.AIInsights, isSet(run.triggeredByAiInsightId));
  add(ProductKey.SecurityEvents, isSet(run.triggeredBySecurityCaseId));
  // A run about a Data Security issue (#10364): a fix asked for it, or OneUptime AI's own work on it.
  add(ProductKey.DataSecurity, isSet(run.triggeredByDataSecurityIssueId));
  add(ProductKey.Code, isSet(run.codeTaskId) || isSet(run.codeRepositoryId));

  return products;
};
