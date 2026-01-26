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
}

const MasterPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isOnline, setIsOnline] = React.useState(true);

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
          {/* Skip to main content link for keyboard navigation */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-gray-900 focus:rounded-md focus:shadow-lg focus:ring-2 focus:ring-indigo-500"
          >
            Skip to main content
          </a>
          <div
            className={props.makeTopSectionUnstick ? "" : "sticky top-0 z-10"}
          >
            <TopSection
              hideHeader={props.hideHeader}
              className={props.topSectionClassName}
              header={props.header}
              navbar={props.navBar}
            />
          </div>

          <main id="main-content" tabIndex={-1}>
            {props.children}
          </main>

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
