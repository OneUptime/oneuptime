import {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardVariable from "../../../Types/Dashboard/DashboardVariable";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  resolveSloWidgetSource,
  SloWidgetSource,
  SloWidgetSourceState,
} from "../../../Utils/Dashboard/SloWidgetSource";

/*
 * The stored configuration of ONE SLO widget, read back from the dashboard's
 * JSON column.
 *
 * Two unauthenticated routes are driven by this config — the resource-list
 * read that returns the SLO's current numbers, and the SloHistory aggregation
 * that returns its series — so both must agree on exactly which SLO and which
 * series the widget's author published. Parsing it once here is what keeps
 * them from drifting apart.
 *
 * Everything here comes out of a JSONB column that an older (or hand-edited)
 * client may have written, so nothing is trusted to be well typed.
 */

/*
 * How the widget names its objective.
 *
 * - Pinned: the author stored one SLO id. The id IS the authorization
 *   decision — it comes only from stored config, never from the request, so
 *   the read can never be pointed at another SLO in the project.
 *
 * - Selected: the author bound the widget to a dashboard variable and the
 *   viewer picked an SLO NAME in the toolbar. Binding a widget to a variable
 *   is the author's explicit opt-in to publishing ANY active SLO's headline
 *   numbers (and, for a chart, its history) by name — the same exposure the
 *   SLO List widget and the `oneuptime.slo.*` metric charts already have. The
 *   variable itself still comes from stored config (its id, type and key);
 *   only its selected VALUE comes from the viewer, and it is only ever used as
 *   an exact-match name within the dashboard's own project.
 */
export enum PublicDashboardSloWidgetTargetKind {
  Pinned = "Pinned",
  Selected = "Selected",
}

export type PublicDashboardSloWidgetTarget =
  | {
      kind: PublicDashboardSloWidgetTargetKind.Pinned;
      serviceLevelObjectiveId: ObjectID;
    }
  | {
      kind: PublicDashboardSloWidgetTargetKind.Selected;
      serviceLevelObjectiveName: string;
    };

export interface PublicDashboardSloWidgetConfig {
  target: PublicDashboardSloWidgetTarget;
  sloMetric: SloWidgetMetric;
  displayType: SloWidgetDisplayType;
}

/*
 * Same bounds PublicDashboardResourceListPolicy applies to stored variable
 * ids and selected values, so an oversized binding is refused here rather
 * than turned into a query parameter.
 */
const MAX_VARIABLE_ID_LENGTH: number = 256;
const MAX_SLO_NAME_LENGTH: number = 1024;

export const PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE: string =
  "This dashboard widget has no Service Level Objective selected.";

export const PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE: string =
  "Choose a Service Level Objective in this dashboard's toolbar.";

export const PUBLIC_SLO_WIDGET_MULTIPLE_SELECTION_MESSAGE: string =
  "Choose a single Service Level Objective in this dashboard's toolbar.";

export const PUBLIC_SLO_WIDGET_VARIABLE_MISSING_MESSAGE: string =
  "This dashboard widget follows a variable this dashboard does not have.";

export default class PublicDashboardSloWidget {
  /*
   * Read the config off a whole stored widget (`{ arguments: { … } }`).
   *
   * `variables` are the dashboard's STORED variables with the viewer's
   * selections already validated and applied
   * (PublicDashboardResourceListPolicy.resolveDashboardVariableSelections).
   * A pinned widget never reads them; a variable-bound widget without them
   * fails closed.
   */
  public static readConfig(
    widget: unknown,
    variables?: Array<DashboardVariable> | undefined,
  ): PublicDashboardSloWidgetConfig {
    return PublicDashboardSloWidget.readConfigFromArguments(
      PublicDashboardSloWidget.readArguments(widget),
      variables,
    );
  }

  /** Read the config off a widget's already-extracted `arguments` object. */
  public static readConfigFromArguments(
    argumentsObject: Record<string, unknown>,
    variables?: Array<DashboardVariable> | undefined,
  ): PublicDashboardSloWidgetConfig {
    return {
      target: PublicDashboardSloWidget.readTarget(argumentsObject, variables),
      sloMetric: PublicDashboardSloWidget.readSloMetric(argumentsObject),
      displayType: PublicDashboardSloWidget.readDisplayType(argumentsObject),
    };
  }

  private static readArguments(widget: unknown): Record<string, unknown> {
    if (!widget || typeof widget !== "object" || Array.isArray(widget)) {
      throw new BadDataException("Dashboard widget must be an object.");
    }

    const argumentsObject: unknown = (widget as Record<string, unknown>)[
      "arguments"
    ];

    if (
      !argumentsObject ||
      typeof argumentsObject !== "object" ||
      Array.isArray(argumentsObject)
    ) {
      throw new BadDataException(
        "Dashboard widget arguments must be an object.",
      );
    }

    return argumentsObject as Record<string, unknown>;
  }

  private static readTarget(
    argumentsObject: Record<string, unknown>,
    variables: Array<DashboardVariable> | undefined,
  ): PublicDashboardSloWidgetTarget {
    const storedId: unknown = argumentsObject["serviceLevelObjectiveId"];

    /*
     * ANY stored id that is not plainly absent pins the widget and is then
     * validated strictly. A malformed id (a number, an array, a non-UUID)
     * must fail closed — it must never fall through to the variable binding,
     * which would widen a widget its author pinned to one SLO into one that
     * serves whichever SLO a viewer names.
     */
    const isIdAbsent: boolean =
      storedId === undefined ||
      storedId === null ||
      (typeof storedId === "string" && storedId.trim().length === 0);

    if (!isIdAbsent) {
      return {
        kind: PublicDashboardSloWidgetTargetKind.Pinned,
        serviceLevelObjectiveId:
          PublicDashboardSloWidget.readServiceLevelObjectiveId(argumentsObject),
      };
    }

    const storedVariableId: unknown =
      argumentsObject["serviceLevelObjectiveVariableId"];

    if (
      storedVariableId === undefined ||
      storedVariableId === null ||
      storedVariableId === ""
    ) {
      throw new BadDataException(PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE);
    }

    if (
      typeof storedVariableId !== "string" ||
      storedVariableId.length > MAX_VARIABLE_ID_LENGTH
    ) {
      throw new BadDataException(
        "Dashboard widget serviceLevelObjectiveVariableId is invalid.",
      );
    }

    // The same resolution the browser renders with (SloWidgetSource).
    const source: SloWidgetSource = resolveSloWidgetSource({
      serviceLevelObjectiveVariableId: storedVariableId,
      variables: variables,
    });

    switch (source.state) {
      case SloWidgetSourceState.FollowsSelection: {
        const sloName: string = source.sloName || "";

        if (sloName.length === 0 || sloName.length > MAX_SLO_NAME_LENGTH) {
          throw new BadDataException(PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE);
        }

        return {
          kind: PublicDashboardSloWidgetTargetKind.Selected,
          serviceLevelObjectiveName: sloName,
        };
      }
      case SloWidgetSourceState.NoSelection:
        throw new BadDataException(PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE);
      case SloWidgetSourceState.MultipleSelection:
        throw new BadDataException(
          PUBLIC_SLO_WIDGET_MULTIPLE_SELECTION_MESSAGE,
        );
      case SloWidgetSourceState.Unconfigured:
        // A whitespace-only binding is no binding.
        throw new BadDataException(PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE);
      default:
        throw new BadDataException(PUBLIC_SLO_WIDGET_VARIABLE_MISSING_MESSAGE);
    }
  }

  /*
   * The SLO the widget's author picked IS the authorization decision: the id
   * comes only from stored config, never from the request, so this endpoint
   * can never be pointed at another SLO in the project.
   */
  private static readServiceLevelObjectiveId(
    argumentsObject: Record<string, unknown>,
  ): ObjectID {
    const serviceLevelObjectiveId: unknown =
      argumentsObject["serviceLevelObjectiveId"];

    if (
      typeof serviceLevelObjectiveId !== "string" ||
      serviceLevelObjectiveId.trim().length === 0
    ) {
      throw new BadDataException(PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE);
    }

    const trimmed: string = serviceLevelObjectiveId.trim();

    ObjectID.validateUUID(trimmed);

    return new ObjectID(trimmed);
  }

  /*
   * Sli is the widget's own default, and these arguments come out of a JSONB
   * column that a dashboard created through the CRUD API — or hand-edited —
   * may simply have written without them, so an absent value is not an error.
   * An unrecognised value IS, rather than silently falling back: a stored
   * string that is not one of the three series should never be able to
   * quietly become "SLI" on a public page.
   */
  private static readSloMetric(
    argumentsObject: Record<string, unknown>,
  ): SloWidgetMetric {
    const sloMetric: unknown = argumentsObject["sloMetric"];

    if (sloMetric === undefined || sloMetric === null || sloMetric === "") {
      return SloWidgetMetric.Sli;
    }

    if (
      typeof sloMetric !== "string" ||
      !(Object.values(SloWidgetMetric) as Array<string>).includes(sloMetric)
    ) {
      throw new BadDataException("Dashboard widget sloMetric is invalid.");
    }

    return sloMetric as SloWidgetMetric;
  }

  private static readDisplayType(
    argumentsObject: Record<string, unknown>,
  ): SloWidgetDisplayType {
    const displayType: unknown = argumentsObject["displayType"];

    if (
      displayType === undefined ||
      displayType === null ||
      displayType === ""
    ) {
      return SloWidgetDisplayType.Tile;
    }

    if (
      typeof displayType !== "string" ||
      !(Object.values(SloWidgetDisplayType) as Array<string>).includes(
        displayType,
      )
    ) {
      throw new BadDataException("Dashboard widget displayType is invalid.");
    }

    return displayType as SloWidgetDisplayType;
  }
}
