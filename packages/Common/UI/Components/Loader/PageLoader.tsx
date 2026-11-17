import Loader, { LoaderType } from "./Loader";
import { LOADER_BOX_CLASS_NAME, LOADER_COLOR } from "./LoaderLayout";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  isVisible: boolean;
  /*
   * Lets a full-page caller reserve height (e.g. "min-h-[60vh]") without
   * changing the footprint of the many inline, in-card call sites that rely on
   * the default box.
   */
  className?: string | undefined;
}

/*
 * The shared bar in the shared box (LoaderLayout). It used to sit 208px down
 * wherever it was drawn (mt-52), in a card as on a page, so a card that
 * loaded grew by that much and then shrank to its content. A page's content
 * area draws PageSkeleton instead, in the shape of the card to come.
 */
const PageLoader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.isVisible) {
    return <></>;
  }

  return (
    <div className={props.className || LOADER_BOX_CLASS_NAME}>
      <Loader loaderType={LoaderType.Bar} color={LOADER_COLOR} size={200} />
    </div>
  );
};

export default PageLoader;
