import { getCurrentFeedbackPage } from "./FeedbackPage";
import ProductFeedback from "Common/UI/Utils/ProductFeedback";
import UserUtil from "Common/UI/Utils/User";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * WHETHER THIS DASHBOARD ASKS PEOPLE HOW THINGS WENT (issue #6832), read
 * once when it starts: the server's switch and the person's own
 * (ProductFeedback.loadSettings). Until the answer arrives - and wherever
 * it cannot be read - nothing asks and nothing is offered.
 *
 * Also hands ProductFeedback the Dashboard's way of naming the page an
 * answer was given on: the pattern of the route it matched, with no ids
 * (FeedbackPage).
 */
const ProductFeedbackInit: FunctionComponent = (): ReactElement => {
  useEffect(() => {
    ProductFeedback.setPageResolver(getCurrentFeedbackPage);

    if (UserUtil.isLoggedIn()) {
      void ProductFeedback.loadSettings();
    }
  }, []);

  return <></>;
};

export default ProductFeedbackInit;
