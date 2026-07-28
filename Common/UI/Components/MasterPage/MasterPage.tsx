import PageError from "../Error/PageError";
import PageLoader from "../Loader/PageLoader";
import OfflineIndicator from "../Offline/OfflineIndicator";
import TopSection from "../TopSection/TopSection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  header?: undefined | ReactElement;
  footer?: undefined | ReactElement;
  navBar?: undefined | ReactElement;
  children: ReactElement | Array<ReactElement>;
  isLoading: boolean;
  error: string;
  topSectionClassName?: string | undefined;
  className?: string | undefined;
  hideHeader?: boolean | undefined;
  makeTopSectionUnstick?: boolean | undefined;
  /*
   * Set when the consumer renders its own <main id="main-content"> landmark
   * and skip link inside children (e.g. the status page), so this component
   * does not add a second, nested main landmark or a duplicate skip link.
   */
  disableMainContentWrapper?: boolean | undefined;
}

const MasterPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOnline, setIsOnline] = React.useState(true);
  const topSectionRef: React.RefObject<HTMLDivElement> =
    React.useRef<HTMLDivElement>(null);

  /*
   * Publish the sticky top section's height as --app-header-height so anything
   * that sticks underneath it (the side menu, for example) can offset itself by
   * the real header instead of guessing and ending up tucked behind it. The
   * height is not a constant — it changes when the navbar is hidden, when the
   * header wraps on narrow viewports and when top alerts appear — so keep it in
   * sync rather than measuring once.
   */
  React.useLayoutEffect(() => {
    const setHeaderHeight: (height: number) => void = (
      height: number,
    ): void => {
      document.documentElement.style.setProperty(
        "--app-header-height",
        `${height}px`,
      );
    };

    const element: HTMLDivElement | null = topSectionRef.current;

    if (!element || props.makeTopSectionUnstick) {
      // Nothing is overlaying the content, so no offset is needed.
      setHeaderHeight(0);
      return undefined;
    }

    const measure: () => void = (): void => {
      setHeaderHeight(element.offsetHeight);
    };

    measure();

    /*
     * ResizeObserver is missing in jsdom and in older browsers, so fall back to
     * resize events there — less precise, but the header only really changes
     * height when the viewport does.
     */
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);

      return () => {
        window.removeEventListener("resize", measure);
        document.documentElement.style.removeProperty("--app-header-height");
      };
    }

    const observer: ResizeObserver = new ResizeObserver(measure);
    observer.observe(element);

    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--app-header-height");
    };
  }, [
    props.makeTopSectionUnstick,
    props.hideHeader,
    props.isLoading,
    props.error,
    props.disableMainContentWrapper,
    isOnline,
  ]);

  if (props.isLoading) {
    return (
      <React.Fragment>
        <PageLoader isVisible={true} />
      </React.Fragment>
    );
  }

  if (props.error) {
    return (
      <React.Fragment>
        <PageError message={props.error} />
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      {isOnline && (
        <div className={props.className}>
          {/*
           * Skip link so keyboard and screen-reader users can bypass the
           * repeated header/navigation and jump straight to the page content
           * (WCAG 2.4.1 Bypass Blocks). Visually hidden until focused.
           */}
          {!props.disableMainContentWrapper && (
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg"
            >
              Skip to main content
            </a>
          )}
          <div
            ref={topSectionRef}
            className={props.makeTopSectionUnstick ? "" : "sticky top-0 z-10"}
          >
            <TopSection
              hideHeader={props.hideHeader}
              className={props.topSectionClassName}
              header={props.header}
              navbar={props.navBar}
            />
          </div>

          {props.disableMainContentWrapper ? (
            props.children
          ) : (
            <main
              id="main-content"
              tabIndex={-1}
              /*
               * grow so the main content fills the remaining vertical space in
               * the flex column, keeping the page top-aligned and pinning the
               * footer to the bottom even when the content is short.
               */
              className="grow focus:outline-none"
            >
              {props.children}
            </main>
          )}

          {props.footer && props.footer}
        </div>
      )}
      <OfflineIndicator
        onOnlineOfflineChange={(isOnline: boolean) => {
          return setIsOnline(isOnline);
        }}
      />
    </React.Fragment>
  );
};

export default MasterPage;
