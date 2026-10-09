import { handleChunkLoadError } from "../ErrorBoundary";
import React, {
  ErrorInfo,
  FunctionComponent,
  ReactElement,
  ReactNode,
} from "react";
import {
  ErrorBoundary as NativeErrorBoundary,
  FallbackProps,
} from "react-error-boundary";

export interface ContainedErrorFallbackProps {
  error: Error;
  // Draws the children again: a "Try again" for a failure that may pass.
  retry: () => void;
}

export interface ComponentProps {
  children?: ReactNode;
  /*
   * What to draw in place of the children once a render below has thrown.
   * It takes only the children's place, so the rest of the page stays.
   */
  renderFallback: (fallback: ContainedErrorFallbackProps) => ReactElement;
  /*
   * When any of these changes, the boundary clears its error and draws the
   * children again - a new config for a widget that could not be drawn,
   * say, so editing it is what brings it back.
   */
  resetKeys?: Array<unknown> | undefined;
  // Notified for every caught error (tests, and callers that report).
  onError?: ((error: Error, errorInfo: ErrorInfo) => void) | undefined;
}

/*
 * An error boundary for ONE part of a page. The app's own ErrorBoundary
 * replaces the whole page with its support screen, which is right for a
 * page that cannot run at all and wrong for one widget of many: a dashboard
 * whose one widget threw used to go with it (issue #4571). Put this around
 * the part that may fail, and only that part is replaced.
 *
 * A stale bundle (a chunk that 404s after a deploy) still reloads the page
 * once, exactly as the app's boundary does: a widget's lazily loaded chunk
 * failing is the deploy's fault, not the widget's, and a reload fixes it.
 */
const ContainedErrorBoundary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <NativeErrorBoundary
      resetKeys={props.resetKeys || []}
      onError={(error: Error, errorInfo: ErrorInfo): void => {
        // eslint-disable-next-line no-console
        console.error("Uncaught error rendering part of the page:", error);

        handleChunkLoadError(error);

        props.onError?.(error, errorInfo);
      }}
      fallbackRender={(fallbackProps: FallbackProps): ReactElement => {
        const error: Error =
          fallbackProps.error instanceof Error
            ? fallbackProps.error
            : new Error(String(fallbackProps.error));

        return props.renderFallback({
          error: error,
          retry: (): void => {
            fallbackProps.resetErrorBoundary();
          },
        });
      }}
    >
      {props.children}
    </NativeErrorBoundary>
  );
};

export default ContainedErrorBoundary;
