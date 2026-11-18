import React, { FunctionComponent, ReactElement } from "react";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import {
  GuidedSetupEntryPoint,
  withGuidedSetupEntryPoint,
} from "Common/UI/Utils/GuidedSetupEvents";
import ResourceShowcaseCard, {
  ShowcaseAddButton,
  ShowcaseSetupButton,
} from "../ResourceShowcase/ResourceShowcaseCard";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { OnboardedProductKey, ProductOnboarding } from "./ProductOnboarding";
import { getProductOnboarding } from "./ProductOnboardings";

/*
 * A product's explanation on its own first page, while the project has
 * nothing in it yet (ProductOnboarding.ts): the showcase, its steps, the
 * page's own first button and the documentation. Someone who may not take
 * that first step (a read-only member) reads the same explanation without
 * the button; the empty table above keeps its own locked one, and the note
 * that says why (getProductFirstRunEmptyState).
 */

export const PRODUCT_SHOWCASE_TEST_ID: string = "product-showcase";

export interface ComponentProps {
  product: OnboardedProductKey;
  // The page's own first step, as its own button says it.
  startButton?: ShowcaseAddButton | undefined;
  // Where the page above already walks through its own steps.
  hidesSteps?: boolean | undefined;
  /*
   * Where the page above already says what the product is for: under an
   * empty list, whose table says it, and under a connect card that does.
   */
  hidesDescription?: boolean | undefined;
}

/*
 * The start button for a page whose first step creates a record: offered
 * only to someone who may create one. A locked button would say what is
 * missing, but this one is the page's invitation, so it is left out.
 */
export function getProductStartButton(data: {
  modelType: { new (): BaseModel };
  button: ShowcaseAddButton;
}): ShowcaseAddButton | undefined {
  return PermissionGate.check(new data.modelType(), ModelAction.Create)
    .isAllowed
    ? data.button
    : undefined;
}

// A create-form button (useShowcaseCreateForm) without its locked state.
export function getUnlockedButton(
  button: ShowcaseAddButton | undefined,
): ShowcaseAddButton | undefined {
  return button && !button.disabled ? button : undefined;
}

/*
 * The product's guided setup as the explanation's button (#7148): for
 * whoever may create what the setup makes - every record of it
 * (ProductGuidedSetup.alsoCreates, #7142) - as Create is offered. It opens
 * the setup's page, saying where it was opened from (`from`: the empty
 * list or How it works, sent with guided_setup/started, #7054);
 * `beforeOpen` closes what it is drawn in (a dialog).
 */
export function getProductGuidedSetupButton(data: {
  onboarding: ProductOnboarding;
  from: GuidedSetupEntryPoint;
  beforeOpen?: (() => void) | undefined;
}): ShowcaseSetupButton | undefined {
  const setup: ProductOnboarding["guidedSetup"] = data.onboarding.guidedSetup;

  if (
    !setup ||
    ![setup.modelType, ...(setup.alsoCreates || [])].every(
      (modelType: { new (): BaseModel }): boolean => {
        return PermissionGate.check(new modelType(), ModelAction.Create)
          .isAllowed;
      },
    )
  ) {
    return undefined;
  }

  return {
    title: setup.buttonTitle,
    onClick: (): void => {
      data.beforeOpen?.();
      Navigation.navigate(
        new Route(
          withGuidedSetupEntryPoint(
            RouteUtil.populateRouteParams(
              RouteMap[setup.page] as Route,
            ).toString(),
            data.from,
          ),
        ),
      );
    },
  };
}

const ProductShowcase: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const onboarding: ProductOnboarding = getProductOnboarding(props.product);

  return (
    <div data-testid={PRODUCT_SHOWCASE_TEST_ID} data-product={props.product}>
      <ResourceShowcaseCard
        showcase={onboarding.showcase}
        addButton={props.startButton}
        setupButton={getProductGuidedSetupButton({
          onboarding: onboarding,
          from: GuidedSetupEntryPoint.EmptyList,
        })}
        docsRoute={onboarding.docsRoute}
        guideRoute={onboarding.guideRoute}
        hidesSteps={props.hidesSteps}
        hidesDescription={props.hidesDescription}
      />
    </div>
  );
};

export default ProductShowcase;
