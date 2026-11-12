import React, { ReactElement } from "react";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import type EmptyStateOptions from "Common/UI/Components/ModelTable/EmptyStateOptions";
import Navigation from "Common/UI/Utils/Navigation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useFirstRecordWatch, {
  FirstRecordWatch,
} from "../Infrastructure/UseFirstRecordWatch";
import { ShowcaseAddButton } from "../ResourceShowcase/ResourceShowcaseCard";
import { OnboardedProductKey } from "./ProductOnboarding";
import ProductShowcase, { getProductStartButton } from "./ProductShowcase";
import { getProductFirstRunEmptyState } from "./UseProductFirstRun";

/*
 * A product list's first run (ProductOnboarding.ts), for a list whose first
 * step is a page of its own (Monitors, Incidents, Alerts, Scheduled
 * Maintenance): the table's empty state while the project has none, and
 * the showcase under it, whose button goes where the table's own Create
 * goes. The table is drawn at once; a count that fails leaves it as it was.
 */

export interface CreatePageFirstRun {
  /*
   * For the table's emptyState: no second Create button over the
   * showcase's (getProductFirstRunEmptyState).
   */
  emptyState: EmptyStateOptions;
  // For the table's refreshToggle, where it takes one.
  refreshToken: string;
  // Under the table: the showcase while there is nothing yet.
  showcase: ReactElement;
}

export default function useCreatePageFirstRun<
  TBaseModel extends BaseModel,
>(data: {
  modelType: { new (): TBaseModel };
  product: OnboardedProductKey;
  // English, as the table's own button says it: "Create Monitor".
  startTitle: string;
  createPage: PageMap;
}): CreatePageFirstRun {
  const watch: FirstRecordWatch = useFirstRecordWatch<TBaseModel>({
    modelType: data.modelType,
  });
  // Offered only to someone who may create one.
  const startButton: ShowcaseAddButton | undefined = getProductStartButton({
    modelType: data.modelType,
    button: {
      title: data.startTitle,
      onClick: () => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(RouteMap[data.createPage] as Route),
        );
      },
    },
  });

  return {
    emptyState: getProductFirstRunEmptyState({
      emptyState: undefined,
      count: watch.count,
      hasStartButton: Boolean(startButton),
    }),
    refreshToken: watch.refreshToken,
    showcase:
      watch.count === 0 ? (
        <ProductShowcase
          product={data.product}
          // The empty table above says what the list is for.
          hidesDescription={true}
          startButton={startButton}
        />
      ) : (
        <></>
      ),
  };
}
