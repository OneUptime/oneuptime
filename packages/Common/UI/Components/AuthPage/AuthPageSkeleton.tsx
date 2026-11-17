import {
  AUTH_PAGE_CARD_CLASS,
  AUTH_PAGE_CLASS,
  AUTH_PAGE_COLUMN_CLASS,
} from "./AuthPage";
import SkeletonStatus, {
  SKELETON_BAR_CLASS_NAME,
} from "../Skeleton/SkeletonStatus";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a sign-in page shows while it reads what to offer (the server's
 * sign-in methods, a form, a status page's providers): the page's own
 * column, a title over a line, and the card with its fields and button, as
 * AuthPage lays them out (#9220). It drew PageLoader, one grey bar at the top
 * of an empty screen, and the form then arrived in the middle of it.
 */

export const AUTH_PAGE_SKELETON_TEST_ID: string = "auth-page-skeleton";

export interface ComponentProps {
  // The fields the card will hold (an email and a password: two).
  fields?: number | undefined;
}

const AuthPageSkeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const fieldCount: number = Math.max(1, props.fields ?? 2);

  return (
    <SkeletonStatus dataTestId={AUTH_PAGE_SKELETON_TEST_ID}>
      <div className={AUTH_PAGE_CLASS}>
        <div className={AUTH_PAGE_COLUMN_CLASS}>
          <div className="mt-4 flex h-8 justify-center sm:mt-6">
            <div className={`h-6 w-48 ${SKELETON_BAR_CLASS_NAME}`} />
          </div>
          <div className="mt-2 flex h-5 justify-center">
            <div className={`h-3 w-64 ${SKELETON_BAR_CLASS_NAME}`} />
          </div>
        </div>
        <div className={`mt-6 sm:mt-8 ${AUTH_PAGE_COLUMN_CLASS}`}>
          <div className={AUTH_PAGE_CARD_CLASS}>
            <div className="space-y-6">
              {Array.from(Array(fieldCount).keys()).map((index: number) => {
                return (
                  <div key={index}>
                    <div className={`h-3 w-24 ${SKELETON_BAR_CLASS_NAME}`} />
                    <div
                      className={`mt-2 h-9 w-full ${SKELETON_BAR_CLASS_NAME}`}
                    />
                  </div>
                );
              })}
              <div className={`h-9 w-full ${SKELETON_BAR_CLASS_NAME}`} />
            </div>
          </div>
        </div>
      </div>
    </SkeletonStatus>
  );
};

export default AuthPageSkeleton;
