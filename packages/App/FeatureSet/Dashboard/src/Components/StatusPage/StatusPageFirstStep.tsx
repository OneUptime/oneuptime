import BulkAddStatusPageMonitorsModal from "./BulkAddStatusPageMonitorsModal";
import {
  STATUS_PAGE_FIRST_STEP_BUTTON_TEST_ID,
  STATUS_PAGE_FIRST_STEP_TEST_ID,
  StatusPageOverviewCopy,
} from "./StatusPageOverviewCopy";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import EmptyState, {
  EmptyStateSize,
} from "Common/UI/Components/EmptyState/EmptyState";
import { STATUS_PAGE_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The first thing on the Overview of a status page that shows no monitors
 * yet: a new status page shows its visitors no status at all until monitors
 * are put on it. So until it has one, its Overview says so, with Add
 * Monitors.
 *
 * Add Monitors opens the dialog that puts monitors on the page right here
 * (BulkAddStatusPageMonitorsModal: the monitors, the rest folded at its
 * defaults), on the Overview, whose Status Page Link card is where the page
 * is opened. It used to open the page's Resources page, where a second Add
 * opened the picker, and the link was back on the Overview (#7466). Once
 * the monitors are on the page, a toast says so, with View Status Page,
 * and this card gives way to the link: the page is no longer empty.
 * Resources stays the place to arrange them in groups.
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
  const translator: Translator = useTranslator();
  const [state, setState] = useState<FirstStepState>(FirstStepState.Asking);
  const [isAddOpen, setIsAddOpen] = useState<boolean>(false);
  /*
   * Bumped when monitors were added from here: the page is counted again,
   * and the card gives way once it shows one.
   */
  const [countRevision, setCountRevision] = useState<number>(0);
  const statusPageId: string = props.statusPageId.toString();

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

    // Counted again after an add, the card stays as it is until it knows.
    if (countRevision === 0) {
      setState(FirstStepState.Asking);
    }

    void countResources();

    return () => {
      isCurrent = false;
    };
  }, [statusPageId, countRevision]);

  /*
   * The dialog, while open: drawn whatever the card is, so a report of
   * what could not be added stays to be read after the page is counted
   * again.
   */
  const addDialog: ReactElement = isAddOpen ? (
    <BulkAddStatusPageMonitorsModal
      projectId={ProjectUtil.getCurrentProjectId()!}
      statusPageId={props.statusPageId}
      canSwitchTarget={Boolean(
        ProjectUtil.getCurrentProject()?.isFeatureFlagMonitorGroupsEnabled,
      )}
      title={StatusPageOverviewCopy.firstStepButton}
      description={StatusPageOverviewCopy.firstStepDescription}
      addedToastAction={{
        title:
          translator.translateText(StatusPageOverviewCopy.viewStatusPage) ||
          StatusPageOverviewCopy.viewStatusPage,
        onClick: () => {
          // The page as its visitors see it, beside the Dashboard.
          Navigation.navigate(
            URL.fromString(`${STATUS_PAGE_URL.toString()}/${statusPageId}`),
            { openInNewTab: true },
          );
        },
      }}
      onClose={() => {
        setIsAddOpen(false);
      }}
      onComplete={() => {
        setCountRevision((revision: number): number => {
          return revision + 1;
        });
      }}
    />
  ) : (
    <></>
  );

  if (state !== FirstStepState.Shown) {
    return addDialog;
  }

  const canAddMonitors: boolean = PermissionGate.check(
    new StatusPageResource(),
    ModelAction.Create,
  ).isAllowed;

  return (
    <>
      {/*
       * A card with no title: its body starts at the card's own padding,
       * not a header's distance below it, so the step sits in the middle.
       */}
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
            size={EmptyStateSize.Inline}
            footer={
              canAddMonitors ? (
                <div>
                  <Button
                    title={StatusPageOverviewCopy.firstStepButton}
                    icon={IconProp.Add}
                    buttonStyle={ButtonStyleType.PRIMARY}
                    dataTestId={STATUS_PAGE_FIRST_STEP_BUTTON_TEST_ID}
                    onClick={() => {
                      setIsAddOpen(true);
                    }}
                  />
                </div>
              ) : undefined
            }
          />
        </div>
      </Card>
      {addDialog}
    </>
  );
};

export default StatusPageFirstStep;
