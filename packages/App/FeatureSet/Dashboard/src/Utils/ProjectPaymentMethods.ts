import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import { useSyncExternalStore } from "react";

/*
 * WHETHER THE OPEN PROJECT HAS A PAYMENT METHOD, KNOWN WITHOUT ASKING THE
 * PAYMENT PROVIDER (#11053).
 *
 * The payment provider knows for sure (BillingService.hasPaymentMethods), at
 * the cost of a request to Stripe per kind of payment method, so no page asks
 * it as it is drawn. The Dashboard counts the project's payment methods as
 * OneUptime keeps them instead - BillingPaymentMethod rows, one count in
 * OneUptime's own database, which every member may make:
 *
 * - once a project is open (App.tsx), in the background, as it always has
 *   for the header's Add Card Details;
 * - and again on Project Settings > Billing and Invoices > Billing, each
 *   time that page lists them, which reads them from the payment provider
 *   first (BillingPaymentMethodService): a card added or removed there is
 *   known at once on every other page, the header's Add Card Details too.
 *
 * Add to Balance reads it (Components/ProjectBalance): a project known to
 * have none is told so before any amount is asked for. Until a count
 * arrives the answer is Unknown, and nothing changes for it - the amount is
 * asked for, as it always was, and the server still checks for a payment
 * method before it charges anything.
 */

export enum ProjectPaymentMethodsState {
  // Not counted yet: the count is on its way, or OneUptime does not bill.
  Unknown = "Unknown",
  // Counted: the project has none.
  None = "None",
  // Counted: the project has at least one.
  Some = "Some",
}

type ProjectIdInput = ObjectID | string | null | undefined;

const toKey: (projectId: ProjectIdInput) => string = (
  projectId: ProjectIdInput,
): string => {
  return projectId?.toString() || "";
};

export default class ProjectPaymentMethods {
  private static counts: Map<string, number> = new Map();
  private static listeners: Set<() => void> = new Set();

  public static subscribe(listener: () => void): () => void {
    ProjectPaymentMethods.listeners.add(listener);

    return (): void => {
      ProjectPaymentMethods.listeners.delete(listener);
    };
  }

  // How many payment methods a project has, as just counted.
  public static setCount(data: {
    projectId: ProjectIdInput;
    count: number;
  }): void {
    const key: string = toKey(data.projectId);

    if (!key || !Number.isInteger(data.count) || data.count < 0) {
      return;
    }

    if (ProjectPaymentMethods.counts.get(key) === data.count) {
      return;
    }

    ProjectPaymentMethods.counts.set(key, data.count);
    ProjectPaymentMethods.emit();
  }

  // How many it has, once counted.
  public static getCount(projectId: ProjectIdInput): number | undefined {
    return ProjectPaymentMethods.counts.get(toKey(projectId));
  }

  public static getState(
    projectId: ProjectIdInput,
  ): ProjectPaymentMethodsState {
    const count: number | undefined = ProjectPaymentMethods.getCount(projectId);

    if (count === undefined) {
      return ProjectPaymentMethodsState.Unknown;
    }

    return count > 0
      ? ProjectPaymentMethodsState.Some
      : ProjectPaymentMethodsState.None;
  }

  // Forgets every count.
  public static reset(): void {
    ProjectPaymentMethods.counts = new Map();
    ProjectPaymentMethods.emit();
  }

  private static emit(): void {
    for (const listener of Array.from(ProjectPaymentMethods.listeners)) {
      listener();
    }
  }
}

const toProjectKey: (projectId?: ProjectIdInput) => string = (
  projectId?: ProjectIdInput,
): string => {
  return toKey(
    projectId === undefined ? ProjectUtil.getCurrentProjectId() : projectId,
  );
};

/*
 * What is known of the open project's payment methods (or of `projectId`'s),
 * drawn again whenever a count arrives. Reading asks the server nothing.
 */
export const useProjectPaymentMethods: (
  projectId?: ProjectIdInput,
) => ProjectPaymentMethodsState = (
  projectId?: ProjectIdInput,
): ProjectPaymentMethodsState => {
  const key: string = toProjectKey(projectId);

  const read: () => ProjectPaymentMethodsState =
    (): ProjectPaymentMethodsState => {
      return ProjectPaymentMethods.getState(key);
    };

  return useSyncExternalStore(ProjectPaymentMethods.subscribe, read, read);
};

// How many payment methods the project has, once counted: the header's nag.
export const useProjectPaymentMethodCount: (
  projectId?: ProjectIdInput,
) => number | undefined = (projectId?: ProjectIdInput): number | undefined => {
  const key: string = toProjectKey(projectId);

  const read: () => number | undefined = (): number | undefined => {
    return ProjectPaymentMethods.getCount(key);
  };

  return useSyncExternalStore(ProjectPaymentMethods.subscribe, read, read);
};
