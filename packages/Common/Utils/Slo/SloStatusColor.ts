import { Gray500, Green, Red, Yellow } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";

/**
 * The single source of truth for the SloStatus -> pill colour mapping.
 *
 * Healthy          -> Green
 * At Risk          -> Yellow
 * Budget Exhausted -> Red
 * Misconfigured    -> Gray  (nothing to measure — not a reliability signal)
 * Paused           -> Gray  (deliberately not being measured)
 * unknown/unset    -> Gray  (the worker has not evaluated the SLO yet, so
 *                            claiming any RAG colour would be a guess)
 *
 * Kept free of React so both the SLO pages and the dashboard SLO widget
 * can import it, and so it is unit-testable without a DOM.
 */
export type GetSloStatusColorFunction = (
  status: SloStatus | undefined | null,
) => Color;

export const getSloStatusColor: GetSloStatusColorFunction = (
  status: SloStatus | undefined | null,
): Color => {
  if (status === SloStatus.Healthy) {
    return Green;
  }

  if (status === SloStatus.AtRisk) {
    return Yellow;
  }

  if (status === SloStatus.BudgetExhausted) {
    return Red;
  }

  return Gray500;
};

/**
 * Text for the status pill. An SLO the worker has not touched yet has a
 * null `sloStatus`; render that as "Unknown" rather than defaulting to
 * "Healthy", which would assert a reliability claim we cannot back.
 */
export type GetSloStatusTextFunction = (
  status: SloStatus | undefined | null,
) => string;

export const getSloStatusText: GetSloStatusTextFunction = (
  status: SloStatus | undefined | null,
): string => {
  return status || "Unknown";
};
