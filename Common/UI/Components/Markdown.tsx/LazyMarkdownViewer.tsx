import { ComponentProps } from "./MarkdownViewer";
import React, {
  FunctionComponent,
  LazyExoticComponent,
  Suspense,
  lazy,
} from "react";

const MarkdownViewer: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("./MarkdownViewer");
  });

const LazyMarkdownViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): JSX.Element => {
  return (
    <Suspense
      fallback={
        /*
         * A bare "Loading..." string here painted raw English text in the
         * middle of the page, then swapped it for content of a different
         * height. Reserve roughly the space two lines of prose take instead.
         *
         * Spans rather than divs: callers such as EventItem render this inside
         * a <p>, where block elements are invalid nesting.
         */
        <span role="status" aria-live="polite" className="block space-y-2">
          <span className="block h-4 w-3/4 animate-pulse rounded bg-gray-100" />
          <span className="block h-4 w-1/2 animate-pulse rounded bg-gray-100" />
          <span className="sr-only">Loading content</span>
        </span>
      }
    >
      <MarkdownViewer {...props} />
    </Suspense>
  );
};

export default LazyMarkdownViewer;
