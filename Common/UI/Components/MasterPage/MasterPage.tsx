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
        <div className={props.className || "min-h-screen bg-gray-50"}>
          <div
            className={props.makeTopSectionUnstick ? "" : "sticky top-0 z-40"}
          >
            <TopSection
              hideHeader={props.hideHeader}
              className={props.topSectionClassName}
              header={props.header}
              navbar={props.navBar}
            />
          </div>

          <main className="flex-1 overflow-y-auto">
            {props.children}
          </main>

          {props.footer && (
            <footer className="mt-auto">
              {props.footer}
            </footer>
          )}
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
