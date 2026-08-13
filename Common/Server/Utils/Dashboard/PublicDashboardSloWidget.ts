import {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

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
export interface PublicDashboardSloWidgetConfig {
  serviceLevelObjectiveId: ObjectID;
  sloMetric: SloWidgetMetric;
  displayType: SloWidgetDisplayType;
}

export default class PublicDashboardSloWidget {
  /** Read the config off a whole stored widget (`{ arguments: { … } }`). */
  public static readConfig(widget: unknown): PublicDashboardSloWidgetConfig {
    return PublicDashboardSloWidget.readConfigFromArguments(
      PublicDashboardSloWidget.readArguments(widget),
    );
  }

  /** Read the config off a widget's already-extracted `arguments` object. */
  public static readConfigFromArguments(
    argumentsObject: Record<string, unknown>,
  ): PublicDashboardSloWidgetConfig {
    return {
      serviceLevelObjectiveId:
        PublicDashboardSloWidget.readServiceLevelObjectiveId(argumentsObject),
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
      throw new BadDataException(
        "This dashboard widget has no Service Level Objective selected.",
      );
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
