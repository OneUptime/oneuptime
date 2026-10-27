import { splitAtNameBreaks } from "../../../Utils/NameBreaks";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Text that may hold a long name - a metric ("container.network.io.usage.
 * rx_bytes"), an image ("registry.example/shop/checkout:2.7.0"), an id
 * ("task/x7k2m9p4q1r8") - drawn so that, in a box narrower than it, the
 * name breaks after its own dots and slashes first (Common/Utils/
 * NameBreaks), and anywhere only where a part is still too long for its
 * line. Left to `overflow-wrap: anywhere` alone, a name broke at whatever
 * letter filled the line: "checkout:2.7." / "0", "io_service_b" / "ytes".
 *
 * The text is unchanged: a <wbr> adds no character, so a copy, a search and
 * a screen reader read it as written. The box that holds it sets how it
 * breaks the rest of the way ([overflow-wrap:anywhere]) or that it never
 * does (truncate).
 */

export interface ComponentProps {
  text: string;
}

const BreakableName: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const parts: Array<string> = splitAtNameBreaks(props.text);

  if (parts.length < 2) {
    return <>{props.text}</>;
  }

  return (
    <>
      {parts.map((part: string, index: number): ReactElement => {
        return (
          <React.Fragment key={index}>
            {part}
            {index < parts.length - 1 ? <wbr /> : <></>}
          </React.Fragment>
        );
      })}
    </>
  );
};

export default BreakableName;
