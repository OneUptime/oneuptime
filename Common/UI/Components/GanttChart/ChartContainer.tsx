import React, { FunctionComponent, ReactElement, Ref } from "react";

export interface ComponentProps {
  onWidthChange: (width: number) => void;
  children?: undefined | Array<ReactElement> | ReactElement;
}

const ChartContainer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const divRef: Ref<HTMLDivElement> = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!props.onWidthChange) {
      return;
    }

    if (!divRef.current) {
      return;
    }

    const resizeObserver: ResizeObserver = new ResizeObserver(() => {
      if (divRef.current && props.onWidthChange) {
        props.onWidthChange(divRef.current.offsetWidth);
      }
    });

    resizeObserver.observe(divRef.current);

    return () => {
      return resizeObserver.disconnect();
    }; // clean up
  }, []);

  return (
    /*
     * `isolate` creates a new stacking context so the chart's internal
     * z-indexes (e.g. a highlighted/matched bar uses z-30, see Bar/Index.tsx)
     * stay trapped inside the chart. Without it those bars paint above
     * page-level overlays like the span-details SideOver (z-10), making a
     * matched span "show above" the sidebar.
     */
    <div ref={divRef} className={"w-full"} style={{ isolation: "isolate" }}>
      {props.children}
    </div>
  );
};

export default ChartContainer;
