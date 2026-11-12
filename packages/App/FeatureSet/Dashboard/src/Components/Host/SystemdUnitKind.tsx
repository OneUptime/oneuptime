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
 * Inline, a small grey chip - the Type column of the Systemd Units list.
 * In a tile's large figure, the figure's own size in the code font.
 */

export const SYSTEMD_UNIT_KIND_TEST_ID: string = "systemd-unit-kind";

export const SYSTEMD_UNIT_KIND_CLASS_NAME: string =
  "rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700";

export const SYSTEMD_UNIT_KIND_FIGURE_CLASS_NAME: string = "font-mono";

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
