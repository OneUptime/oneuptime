import BadDataException from "../../../Types/Exception/BadDataException";
import MeasurementOccurrence from "../../../Types/Measurement/MeasurementOccurrence";

/*
 * Validation shared by the incident, alert and scheduled maintenance
 * measurement services.
 *
 * Every rule here exists to stop a definition that would silently produce a
 * confidently wrong number -- a constant zero, or a duration that can never
 * complete with nothing anywhere saying so.
 */
export default class MeasurementDefinitionValidator {
  /*
   * The key becomes part of the metric name, which lands in ClickHouse, in
   * the dashboard chart picker and in the API. It is immutable after
   * creation, so it is worth rejecting a bad one loudly at the only moment
   * it can still be changed.
   */
  public static readonly KEY_PATTERN: RegExp = /^[a-z0-9][a-z0-9-]{0,49}$/;

  public static validateKey(key: string | undefined): void {
    if (!key) {
      throw new BadDataException(
        "A measurement needs a key. Use lowercase letters, numbers and hyphens, for example: time-to-detect",
      );
    }

    if (!MeasurementDefinitionValidator.KEY_PATTERN.test(key)) {
      throw new BadDataException(
        `"${key}" is not a valid measurement key. Keys start with a lowercase letter or number, contain only lowercase letters, numbers and hyphens, and are at most 50 characters. For example: time-to-detect`,
      );
    }
  }

  public static validateAnchorPair(data: {
    startAnchorType?: string | undefined;
    endAnchorType?: string | undefined;
    stateEnteredAnchor: string;
    stateRoleEnteredAnchor: string;
    /*
     * Maps each timestamp anchor type onto the column it actually reads.
     * Several anchors are aliases -- an alert's "Timeline Start" and
     * "Created At" are both createdAt -- so comparing the enum values alone
     * would wave through a definition that is a constant zero by
     * construction.
     */
    timestampAnchorSources?: Record<string, string> | undefined;
    startStateId?: string | undefined;
    endStateId?: string | undefined;
    startStateRole?: string | undefined;
    endStateRole?: string | undefined;
    startOccurrence?: string | undefined;
    endOccurrence?: string | undefined;
  }): void {
    if (!data.startAnchorType) {
      throw new BadDataException("A measurement needs a starting point.");
    }

    if (!data.endAnchorType) {
      throw new BadDataException("A measurement needs an ending point.");
    }

    if (
      data.startAnchorType === data.stateEnteredAnchor &&
      !data.startStateId
    ) {
      throw new BadDataException(
        "Pick the state this measurement starts from.",
      );
    }

    if (data.endAnchorType === data.stateEnteredAnchor && !data.endStateId) {
      throw new BadDataException("Pick the state this measurement ends at.");
    }

    if (
      data.startAnchorType === data.stateRoleEnteredAnchor &&
      !data.startStateRole
    ) {
      throw new BadDataException(
        "Pick the kind of state this measurement starts from.",
      );
    }

    if (
      data.endAnchorType === data.stateRoleEnteredAnchor &&
      !data.endStateRole
    ) {
      throw new BadDataException(
        "Pick the kind of state this measurement ends at.",
      );
    }

    MeasurementDefinitionValidator.rejectIdenticalAnchors(data);
  }

  /*
   * Two identical endpoints always measure zero. Shipping that produces a
   * chart that reads "we do this instantly" on every incident -- which is
   * strictly worse than having no chart, because it looks like an answer.
   */
  private static rejectIdenticalAnchors(data: {
    startAnchorType?: string | undefined;
    endAnchorType?: string | undefined;
    stateEnteredAnchor: string;
    stateRoleEnteredAnchor: string;
    timestampAnchorSources?: Record<string, string> | undefined;
    startStateId?: string | undefined;
    endStateId?: string | undefined;
    startStateRole?: string | undefined;
    endStateRole?: string | undefined;
    startOccurrence?: string | undefined;
    endOccurrence?: string | undefined;
  }): void {
    const startSource: string =
      MeasurementDefinitionValidator.resolveAnchorSource(
        data.startAnchorType,
        data.timestampAnchorSources,
      );
    const endSource: string =
      MeasurementDefinitionValidator.resolveAnchorSource(
        data.endAnchorType,
        data.timestampAnchorSources,
      );

    if (startSource !== endSource) {
      return;
    }

    const startOccurrence: string =
      data.startOccurrence || MeasurementOccurrence.First;
    const endOccurrence: string =
      data.endOccurrence || MeasurementOccurrence.First;

    if (data.startAnchorType === data.stateEnteredAnchor) {
      if (
        data.startStateId === data.endStateId &&
        startOccurrence === endOccurrence
      ) {
        throw new BadDataException(
          "This measurement starts and ends at the same point, so it would always be zero. Pick two different points.",
        );
      }

      return;
    }

    if (data.startAnchorType === data.stateRoleEnteredAnchor) {
      if (
        data.startStateRole === data.endStateRole &&
        startOccurrence === endOccurrence
      ) {
        throw new BadDataException(
          "This measurement starts and ends at the same point, so it would always be zero. Pick two different points.",
        );
      }

      return;
    }

    // Two identical timestamp anchors. Always zero, no exceptions.
    throw new BadDataException(
      "This measurement starts and ends at the same point, so it would always be zero. Pick two different points.",
    );
  }

  /*
   * The column an anchor reads, so two differently-named anchors that read
   * the same column are recognised as the same point in time.
   */
  private static resolveAnchorSource(
    anchorType: string | undefined,
    sources: Record<string, string> | undefined,
  ): string {
    if (!anchorType) {
      return "";
    }

    return sources?.[anchorType] || anchorType;
  }

  /*
   * States are entered in strictly increasing order, so an end state ordered
   * at or before the start state describes a duration that can never
   * complete. Without this the definition looks fine and every incident
   * reports "not applicable" forever.
   */
  public static validateStateOrder(data: {
    startStateName?: string | undefined;
    startStateOrder?: number | undefined;
    endStateName?: string | undefined;
    endStateOrder?: number | undefined;
  }): void {
    if (
      data.startStateOrder === undefined ||
      data.endStateOrder === undefined
    ) {
      return;
    }

    if (data.endStateOrder > data.startStateOrder) {
      return;
    }

    throw new BadDataException(
      `"${data.endStateName}" comes before "${data.startStateName}" in this project's state order, so this measurement could never complete. Swap the two, or pick a later ending state.`,
    );
  }
}
