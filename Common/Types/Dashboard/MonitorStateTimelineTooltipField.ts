/*
 * The rows an operator can put in the hover card of a Monitor List widget's
 * State Timeline. The header (monitor name + status colour) is always there;
 * these are the detail rows underneath it, and the widget stores the selected
 * subset verbatim in its `timelineTooltipFields` argument.
 *
 * The values are persisted in a saved dashboard, so they are part of the
 * stored config format: renaming one silently drops that row from every
 * dashboard already configured with it.
 */
enum MonitorStateTimelineTooltipField {
  /** Name of the status the hovered segment represents. */
  Status = "status",
  /** When the hovered segment began (clipped to the visible window). */
  StartedAt = "startedAt",
  /** When the hovered segment ended (clipped to the visible window, or now). */
  EndedAt = "endedAt",
  /** How long the hovered segment lasted. */
  Duration = "duration",
  /** Uptime for this monitor across the whole visible window. */
  UptimePercent = "uptimePercent",
  /*
   * The status the monitor is in at the END of the visible window — which is
   * "now" only while the range ends now. The stored value keeps its original
   * name; the title below is what a viewer reads.
   */
  CurrentStatus = "currentStatus",
  /** When the monitor last changed status inside the visible window. */
  LastStatusChange = "lastStatusChange",
  /** The monitor's type (Ping, Website, SNMP, …). */
  MonitorType = "monitorType",
}

export default MonitorStateTimelineTooltipField;

/*
 * What a widget shows when the operator has never touched the setting. An
 * EMPTY selection is honoured as "no detail rows" rather than falling back to
 * this — clearing the field is a choice, and silently re-adding rows would
 * make the control look broken.
 */
export const DEFAULT_MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS: ReadonlyArray<MonitorStateTimelineTooltipField> =
  [
    MonitorStateTimelineTooltipField.Status,
    MonitorStateTimelineTooltipField.StartedAt,
    MonitorStateTimelineTooltipField.EndedAt,
    MonitorStateTimelineTooltipField.Duration,
  ];

export interface MonitorStateTimelineTooltipFieldProps {
  field: MonitorStateTimelineTooltipField;
  title: string;
}

/*
 * Declared as an ordered list rather than derived from the enum so the
 * settings dropdown and the rendered tooltip agree on ORDER: the rows appear
 * in this order regardless of the order the operator ticked them, which keeps
 * one widget's hover card readable next to another's.
 */
export const MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS: ReadonlyArray<MonitorStateTimelineTooltipFieldProps> =
  [
    { field: MonitorStateTimelineTooltipField.Status, title: "Status" },
    { field: MonitorStateTimelineTooltipField.StartedAt, title: "Started" },
    { field: MonitorStateTimelineTooltipField.EndedAt, title: "Ended" },
    { field: MonitorStateTimelineTooltipField.Duration, title: "Duration" },
    {
      field: MonitorStateTimelineTooltipField.UptimePercent,
      title: "Uptime in range",
    },
    {
      field: MonitorStateTimelineTooltipField.CurrentStatus,
      title: "Status at range end",
    },
    {
      field: MonitorStateTimelineTooltipField.LastStatusChange,
      title: "Last status change",
    },
    {
      field: MonitorStateTimelineTooltipField.MonitorType,
      title: "Monitor type",
    },
  ];

export class MonitorStateTimelineTooltipFieldUtil {
  /**
   * The fields a widget should render, given whatever is stored in its
   * arguments. Unknown values (a dashboard saved by a newer version, or a
   * hand-edited config) are dropped rather than rendered as blank rows, and
   * the result is always in the canonical display order with no duplicates.
   */
  public static resolveFields(
    storedFields: Array<string> | undefined,
  ): Array<MonitorStateTimelineTooltipField> {
    if (storedFields === undefined) {
      return [...DEFAULT_MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS];
    }

    /*
     * Widget arguments are stored as untyped JSONB, so the declared
     * Array<string> is a promise the database never enforced. Anything that is
     * not an array is treated as "never configured" rather than fed to
     * `new Set`, which throws on a non-iterable — and this runs inside a
     * render memo, so the throw would blank the tile.
     */
    if (!Array.isArray(storedFields)) {
      return [...DEFAULT_MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS];
    }

    const selected: Set<string> = new Set<string>(storedFields);

    return MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS.filter(
      (props: MonitorStateTimelineTooltipFieldProps) => {
        return selected.has(props.field);
      },
    ).map((props: MonitorStateTimelineTooltipFieldProps) => {
      return props.field;
    });
  }

  /** The human label for one field. */
  public static getTitle(field: MonitorStateTimelineTooltipField): string {
    return (
      MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS.find(
        (props: MonitorStateTimelineTooltipFieldProps) => {
          return props.field === field;
        },
      )?.title || field
    );
  }
}
