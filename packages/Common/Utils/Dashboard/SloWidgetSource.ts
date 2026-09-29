import DashboardVariable, {
  DashboardVariableType,
} from "../../Types/Dashboard/DashboardVariable";
import DashboardVariableInterpolation, {
  ResolvedVariableValue,
} from "./VariableInterpolation";

/*
 * Which ServiceLevelObjective a dashboard SLO widget reports on, decided in
 * ONE place for both sides of the wire.
 *
 * An SLO widget can name its objective two ways:
 *
 * - PINNED: `serviceLevelObjectiveId` is stored on the widget. The author
 *   picked one SLO and the widget always shows it, whatever the toolbar says.
 *
 * - FOLLOWING a dashboard variable: `serviceLevelObjectiveVariableId` names a
 *   Telemetry Attribute variable (the SLO template binds one to the bare
 *   `sloName` key the `oneuptime.slo.*` metrics carry), and the widget shows
 *   whichever SLO the reader picks in the toolbar. That is what lets one
 *   toolbar selection drive the SLO tiles and history charts together with
 *   the metric charts beside them, instead of every widget needing its own
 *   edit-mode configuration.
 *
 * The renderer (DashboardSloComponent) and the unauthenticated public
 * dashboard policy (PublicDashboardSloWidget) both call resolveSloWidgetSource,
 * so a widget can never resolve to one SLO in the browser and a different one
 * on the server. React-free and import-light so plain node tests load it.
 */

export enum SloWidgetSourceState {
  // A stored serviceLevelObjectiveId. Always wins over a variable binding.
  Pinned = "Pinned",
  // The bound variable resolves to exactly one SLO name.
  FollowsSelection = "FollowsSelection",
  // Neither an id nor a variable binding — the widget's setup state.
  Unconfigured = "Unconfigured",
  /*
   * The binding names a variable this dashboard no longer has, or one that is
   * not a Telemetry Attribute variable (only those carry a value the public
   * dashboard route will accept from an anonymous viewer).
   */
  VariableMissing = "VariableMissing",
  // The bound variable is on "All": there is no one SLO to show.
  NoSelection = "NoSelection",
  // A multi-select variable with more than one pick: still no ONE SLO.
  MultipleSelection = "MultipleSelection",
}

export interface SloWidgetSource {
  state: SloWidgetSourceState;
  // Set only for Pinned: the stored id, trimmed.
  serviceLevelObjectiveId?: string | undefined;
  // Set only for FollowsSelection: the SLO NAME the variable resolved to.
  sloName?: string | undefined;
}

export interface ResolveSloWidgetSourceData {
  serviceLevelObjectiveId?: string | undefined | null;
  serviceLevelObjectiveVariableId?: string | undefined | null;
  variables?: Array<DashboardVariable> | undefined;
}

/*
 * How many rows a name lookup asks for. SLO names are not unique within a
 * project, so the lookup deliberately reads ONE more row than it can show: a
 * second match means the name is ambiguous and the widget says so, rather than
 * silently reporting whichever of two same-named objectives sorted first.
 */
export const SLO_WIDGET_NAME_MATCH_LIMIT: number = 2;

/*
 * Copy for the states in which a variable-bound widget has nothing to render.
 * Exported so the renderer and its tests share one spelling.
 */
export const SLO_WIDGET_NO_SELECTION_TEXT: string =
  "Choose an SLO in the toolbar to see it here.";

export const SLO_WIDGET_MULTIPLE_SELECTION_TEXT: string =
  "Choose a single SLO in the toolbar to see it here.";

export const SLO_WIDGET_VARIABLE_MISSING_TEXT: string =
  "The dashboard variable this widget follows was removed. Edit the widget to choose an SLO.";

export type GetSloWidgetNotFoundTextFunction = (sloName: string) => string;

export const getSloWidgetNotFoundText: GetSloWidgetNotFoundTextFunction = (
  sloName: string,
): string => {
  return `No active SLO is named “${sloName}”.`;
};

export type GetSloWidgetAmbiguousTextFunction = (sloName: string) => string;

export const getSloWidgetAmbiguousText: GetSloWidgetAmbiguousTextFunction = (
  sloName: string,
): string => {
  return `More than one SLO is named “${sloName}”. Rename one, or pin this widget to an SLO.`;
};

export type ResolveSloWidgetSourceFunction = (
  data: ResolveSloWidgetSourceData,
) => SloWidgetSource;

export const resolveSloWidgetSource: ResolveSloWidgetSourceFunction = (
  data: ResolveSloWidgetSourceData,
): SloWidgetSource => {
  const pinnedId: string = (data.serviceLevelObjectiveId || "").trim();

  /*
   * A pinned SLO wins. An author who went into the settings panel and picked
   * one objective meant THAT objective; a variable binding left over from the
   * template must not quietly override the choice.
   */
  if (pinnedId.length > 0) {
    return {
      state: SloWidgetSourceState.Pinned,
      serviceLevelObjectiveId: pinnedId,
    };
  }

  const variableId: string = (
    data.serviceLevelObjectiveVariableId || ""
  ).trim();

  if (variableId.length === 0) {
    return { state: SloWidgetSourceState.Unconfigured };
  }

  const matchingVariables: Array<DashboardVariable> = (
    data.variables || []
  ).filter((variable: DashboardVariable): boolean => {
    return variable.id === variableId;
  });

  const variable: DashboardVariable | undefined = matchingVariables[0];

  /*
   * Exactly one match, and of the one type whose selection the public
   * dashboard route resolves from stored config: anything else is a binding
   * that cannot be honoured the same way on both sides, so it is reported as
   * broken rather than half-working.
   */
  if (
    matchingVariables.length !== 1 ||
    !variable ||
    variable.type !== DashboardVariableType.TelemetryAttribute
  ) {
    return { state: SloWidgetSourceState.VariableMissing };
  }

  /*
   * The same resolution every metric widget uses, so "All" on the toolbar
   * means no SLO here exactly when it means no filter on the charts.
   */
  const resolved: ResolvedVariableValue | undefined =
    DashboardVariableInterpolation.resolveValue(variable);

  if (!resolved) {
    return { state: SloWidgetSourceState.NoSelection };
  }

  if (resolved.multi) {
    if (resolved.multi.length > 1) {
      return { state: SloWidgetSourceState.MultipleSelection };
    }

    const onlyPick: string | undefined = resolved.multi[0];

    if (!onlyPick) {
      return { state: SloWidgetSourceState.NoSelection };
    }

    return {
      state: SloWidgetSourceState.FollowsSelection,
      sloName: onlyPick,
    };
  }

  if (!resolved.scalar) {
    return { state: SloWidgetSourceState.NoSelection };
  }

  return {
    state: SloWidgetSourceState.FollowsSelection,
    sloName: resolved.scalar,
  };
};
