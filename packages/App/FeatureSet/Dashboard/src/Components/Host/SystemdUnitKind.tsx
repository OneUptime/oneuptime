import React, { FunctionComponent, ReactElement } from "react";

/*
 * A systemd unit's kind - service, socket, timer, target, mount, ... - as
 * systemd writes it, set apart as code (#6731).
 *
 * `systemctl` prints the kind so, the unit's file is named with it
 * (nginx.service) and `systemctl list-units --type=` takes it, so the page
 * shows it exactly as written in every language and never looks it up as a
 * word: the Dashboard's Target is a target value in Arabic and its Mount a
 * connection in Persian, on screens that mean something else by them. A
 * `code` element reads left to right on a page read from the right
 * (Theme.css), so the kind is never turned round there.
 *
 * Inline, a small grey chip - the Type column of the Systemd Units list -
 * on the row's 24px line (leading-6): a table sets what a cell holds at
 * the top of its line (Table/TableLayout), and on a 16px line of its own
 * the chip stood 4px above the unit's name and its State beside it.
 * In a tile's large figure, the figure's own size in the code font, as a
 * line of its own (block): set inline beside the figure's font, the code
 * font's taller letters made the line 3px taller, and the tile's sublabel
 * stood lower than the sublabels of the tiles beside it.
 */

export const SYSTEMD_UNIT_KIND_TEST_ID: string = "systemd-unit-kind";

export const SYSTEMD_UNIT_KIND_CLASS_NAME: string =
  "rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs leading-6 text-gray-700";

export const SYSTEMD_UNIT_KIND_FIGURE_CLASS_NAME: string = "block font-mono";

export interface ComponentProps {
  // The kind as unitTypeOf reads it from the unit's name: "service".
  kind: string;
  // Drawn as a tile's figure rather than as a chip in a line.
  isFigure?: boolean | undefined;
}

const SystemdUnitKind: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <code
      data-testid={SYSTEMD_UNIT_KIND_TEST_ID}
      className={
        props.isFigure
          ? SYSTEMD_UNIT_KIND_FIGURE_CLASS_NAME
          : SYSTEMD_UNIT_KIND_CLASS_NAME
      }
    >
      {props.kind}
    </code>
  );
};

export default SystemdUnitKind;
