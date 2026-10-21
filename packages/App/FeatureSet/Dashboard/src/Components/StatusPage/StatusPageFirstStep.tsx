import {
  STATUS_PAGE_FIRST_STEP_BUTTON_TEST_ID,
  STATUS_PAGE_FIRST_STEP_TEST_ID,
  StatusPageOverviewCopy,
} from "./StatusPageOverviewCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The first thing on the Overview of a status page that shows no monitors
 * yet: a new status page shows its visitors no status at all until monitors
 * are put on it, and that happens on its Resources page, two sections down
 * the menu. So until it has one, its Overview says so, with Add Monitors,
 * which opens that page.
 *
 * It asks once, how many resources the page has, and draws nothing while
 * it asks, when it has some, or when the count cannot be read - it is a
 * pointer to the next step, never a reason for an error on the Overview.
 * Someone who may not add resources reads the same sentence without the
 * button.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
}

/*
 * The card's body class: none of the margin a card puts between its header
 * and its body, as this card has no header (Card's default is mt-4).
 */
export const STATUS_PAGE_FIRST_STEP_BODY_CLASS_NAME: string = "mt-0";

enum FirstStepState {
  Asking = "Asking",
  Shown = "Shown",
  Hidden = "Hidden",
}

const StatusPageFirstStep: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [state, setState] = useState<FirstStepState>(FirstStepState.Asking);

  useEffect(() => {
    let isCurrent: boolean = true;

    const countResources: () => Promise<void> = async (): Promise<void> => {
      try {
        const count: number = await ModelAPI.count<StatusPageResource>({
          modelType: StatusPageResource,
          query: {
            statusPageId: props.statusPageId,
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
        });

        if (isCurrent) {
          setState(count > 0 ? FirstStepState.Hidden : FirstStepState.Shown);
        }
      } catch {
        if (isCurrent) {
          setState(FirstStepState.Hidden);
        }
      }
    };

    setState(FirstStepState.Asking);
    void countResources();

    return () => {
      isCurrent = false;
    };
  }, [props.statusPageId.toString()]);

  if (state !== FirstStepState.Shown) {
    return <></>;
  }

  const canAddMonitors: boolean = PermissionGate.check(
    new StatusPageResource(),
    ModelAction.Create,
  ).isAllowed;

  return (
    /*
     * A card with no title: its body starts at the card's own padding, not
     * a header's distance below it, so the step sits in the middle.
     */
    <Card bodyClassName={STATUS_PAGE_FIRST_STEP_BODY_CLASS_NAME}>
      <div data-testid={STATUS_PAGE_FIRST_STEP_TEST_ID}>
        <EmptyState
          id={STATUS_PAGE_FIRST_STEP_TEST_ID + "-empty-state"}
          title={StatusPageOverviewCopy.firstStepTitle}
          description={
            canAddMonitors
              ? StatusPageOverviewCopy.firstStepDescription
              : StatusPageOverviewCopy.firstStepReaderDescription
          }
          icon={IconProp.AltGlobe}
          paddingClassName="py-8"
          footer={
            canAddMonitors ? (
              /*
               * Button keeps a dialog footer's left margin (md:ml-3), which
               * would push it off the centre here, so its wrapper clears it.
               */
              <div className="[&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
                <Button
                  title={StatusPageOverviewCopy.firstStepButton}
                  icon={IconProp.Add}
                  buttonStyle={ButtonStyleType.PRIMARY}
                  dataTestId={STATUS_PAGE_FIRST_STEP_BUTTON_TEST_ID}
                  onClick={() => {
                    Navigation.navigate(
                      RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_VIEW_RESOURCES] as Route,
                        { modelId: props.statusPageId },
                      ),
                    );
                  }}
                />
              </div>
            ) : undefined
          }
        />
      </div>
    </Card>
  );
};

export default StatusPageFirstStep;
