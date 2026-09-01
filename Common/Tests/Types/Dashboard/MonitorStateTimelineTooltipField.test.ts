import { describe, expect, test } from "@jest/globals";
import MonitorStateTimelineTooltipField, {
  DEFAULT_MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS,
  MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS,
  MonitorStateTimelineTooltipFieldProps,
  MonitorStateTimelineTooltipFieldUtil,
} from "../../../Types/Dashboard/MonitorStateTimelineTooltipField";

/*
 * These values are persisted inside a saved dashboard's widget arguments, so
 * this file is really pinning a stored config format: rename a value and every
 * dashboard already configured with it silently loses that tooltip row, with
 * nothing in the UI to say why.
 *
 * resolveFields is the boundary between "whatever is stored" and "what the
 * tooltip renders", so it has to be total: an unset value, an empty selection,
 * a value from a newer version, and a hand-edited config all have to land
 * somewhere sensible.
 */

const ALL_FIELD_VALUES: Array<MonitorStateTimelineTooltipField> = Object.values(
  MonitorStateTimelineTooltipField,
);

describe("MonitorStateTimelineTooltipField", () => {
  describe("the declared field list", () => {
    test("covers every member of the enum", () => {
      /*
       * A field in the enum but not in this list is unreachable: it can never
       * be picked in the settings form and resolveFields would drop it.
       */
      expect(
        MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS.map(
          (props: MonitorStateTimelineTooltipFieldProps) => {
            return props.field;
          },
        ).sort(),
      ).toEqual([...ALL_FIELD_VALUES].sort());
    });

    test("names every field exactly once", () => {
      const fields: Array<MonitorStateTimelineTooltipField> =
        MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS.map(
          (props: MonitorStateTimelineTooltipFieldProps) => {
            return props.field;
          },
        );

      expect(new Set<string>(fields).size).toBe(fields.length);
    });

    test("gives every field a distinct, non-empty title", () => {
      const titles: Array<string> = MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS.map(
        (props: MonitorStateTimelineTooltipFieldProps) => {
          return props.title;
        },
      );

      for (const title of titles) {
        expect(title.length).toBeGreaterThan(0);
      }
      expect(new Set<string>(titles).size).toBe(titles.length);
    });

    test("keeps the segment's own facts ahead of the whole-row ones", () => {
      /*
       * The hover card describes the bar under the cursor first, then widens
       * out to the monitor. Reversing that reads as if the row-level numbers
       * belong to the hovered segment.
       */
      const order: Array<MonitorStateTimelineTooltipField> =
        MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS.map(
          (props: MonitorStateTimelineTooltipFieldProps) => {
            return props.field;
          },
        );

      expect(
        order.indexOf(MonitorStateTimelineTooltipField.Duration),
      ).toBeLessThan(
        order.indexOf(MonitorStateTimelineTooltipField.UptimePercent),
      );
    });
  });

  describe("the default selection", () => {
    test("is a subset of the declared fields", () => {
      for (const field of DEFAULT_MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS) {
        expect(ALL_FIELD_VALUES).toContain(field);
      }
    });

    test("describes the hovered segment: what, when, and for how long", () => {
      expect([...DEFAULT_MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS]).toEqual([
        MonitorStateTimelineTooltipField.Status,
        MonitorStateTimelineTooltipField.StartedAt,
        MonitorStateTimelineTooltipField.EndedAt,
        MonitorStateTimelineTooltipField.Duration,
      ]);
    });
  });

  describe("resolveFields", () => {
    test("falls back to the defaults when nothing is stored", () => {
      /*
       * undefined means "never configured" — a freshly dropped widget — and it
       * must show something useful rather than an empty card.
       */
      expect(
        MonitorStateTimelineTooltipFieldUtil.resolveFields(undefined),
      ).toEqual([...DEFAULT_MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS]);
    });

    test("returns nothing when the operator cleared the selection", () => {
      /*
       * An empty array is a CHOICE, not an absence. Falling back to the
       * defaults here would make the control look broken: clear it, save, and
       * the rows come straight back.
       */
      expect(MonitorStateTimelineTooltipFieldUtil.resolveFields([])).toEqual(
        [],
      );
    });

    test("keeps exactly the stored fields", () => {
      expect(
        MonitorStateTimelineTooltipFieldUtil.resolveFields([
          MonitorStateTimelineTooltipField.UptimePercent,
          MonitorStateTimelineTooltipField.Status,
        ]),
      ).toEqual([
        MonitorStateTimelineTooltipField.Status,
        MonitorStateTimelineTooltipField.UptimePercent,
      ]);
    });

    test("renders in the canonical order, not the order they were ticked", () => {
      /*
       * Two widgets configured with the same rows in a different click order
       * must produce identical hover cards.
       */
      const clickedOneWay: Array<MonitorStateTimelineTooltipField> =
        MonitorStateTimelineTooltipFieldUtil.resolveFields([
          MonitorStateTimelineTooltipField.MonitorType,
          MonitorStateTimelineTooltipField.Duration,
          MonitorStateTimelineTooltipField.Status,
        ]);

      const clickedAnother: Array<MonitorStateTimelineTooltipField> =
        MonitorStateTimelineTooltipFieldUtil.resolveFields([
          MonitorStateTimelineTooltipField.Status,
          MonitorStateTimelineTooltipField.MonitorType,
          MonitorStateTimelineTooltipField.Duration,
        ]);

      expect(clickedOneWay).toEqual(clickedAnother);
      expect(clickedOneWay).toEqual([
        MonitorStateTimelineTooltipField.Status,
        MonitorStateTimelineTooltipField.Duration,
        MonitorStateTimelineTooltipField.MonitorType,
      ]);
    });

    test("drops a value it does not recognise", () => {
      /*
       * A dashboard saved by a newer version, or a hand-edited config, would
       * otherwise render a row with a blank label and a blank value.
       */
      expect(
        MonitorStateTimelineTooltipFieldUtil.resolveFields([
          "responseTime",
          MonitorStateTimelineTooltipField.Status,
        ]),
      ).toEqual([MonitorStateTimelineTooltipField.Status]);
    });

    test("returns nothing when every stored value is unrecognised", () => {
      expect(
        MonitorStateTimelineTooltipFieldUtil.resolveFields([
          "nope",
          "also-nope",
        ]),
      ).toEqual([]);
    });

    test("collapses a duplicated selection to one row", () => {
      expect(
        MonitorStateTimelineTooltipFieldUtil.resolveFields([
          MonitorStateTimelineTooltipField.Status,
          MonitorStateTimelineTooltipField.Status,
        ]),
      ).toEqual([MonitorStateTimelineTooltipField.Status]);
    });

    test("accepts every declared field", () => {
      expect(
        MonitorStateTimelineTooltipFieldUtil.resolveFields(ALL_FIELD_VALUES),
      ).toEqual(
        MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS.map(
          (props: MonitorStateTimelineTooltipFieldProps) => {
            return props.field;
          },
        ),
      );
    });

    test("does not hand back the shared default array", () => {
      /*
       * The caller renders and sometimes maps over this list; sharing the
       * module-level constant would let one widget's render corrupt the
       * default for every other widget on the board.
       */
      const first: Array<MonitorStateTimelineTooltipField> =
        MonitorStateTimelineTooltipFieldUtil.resolveFields(undefined);

      first.pop();

      expect(
        MonitorStateTimelineTooltipFieldUtil.resolveFields(undefined),
      ).toHaveLength(DEFAULT_MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS.length);
    });
  });

  describe("getTitle", () => {
    test("returns the declared title for every field", () => {
      for (const props of MONITOR_STATE_TIMELINE_TOOLTIP_FIELDS) {
        expect(MonitorStateTimelineTooltipFieldUtil.getTitle(props.field)).toBe(
          props.title,
        );
      }
    });

    test("falls back to the raw value for an unknown field", () => {
      /*
       * A blank label would render an anonymous row; the raw value at least
       * tells whoever is looking what got stored.
       */
      expect(
        MonitorStateTimelineTooltipFieldUtil.getTitle(
          "responseTime" as MonitorStateTimelineTooltipField,
        ),
      ).toBe("responseTime");
    });
  });
});
