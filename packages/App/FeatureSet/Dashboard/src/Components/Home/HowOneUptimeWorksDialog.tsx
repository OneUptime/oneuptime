import EventName from "../../Utils/EventName";
import HowOneUptimeWorks, { HOW_IT_WORKS_TITLE } from "./HowOneUptimeWorks";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import UiAnalytics from "Common/UI/Utils/Analytics";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * "HOW ONEUPTIME WORKS", ALWAYS ONE CLICK AWAY.
 *
 * The best explanation of OneUptime the product has - four products in the
 * order a problem flows through them - used to live only inside Home's
 * Welcome checklist, and went for good once the checklist was done or
 * dismissed. This dialog shows it on its own, from any page and in any
 * project however old: Help opens it, Home opens it, and so can anything
 * else that calls openHowOneUptimeWorks.
 *
 * Mounted once in App.tsx, beside the keyboard shortcuts and the command
 * palette, and opened with a window event, so the opener needs nothing but
 * the event's name.
 */

/*
 * Where it was opened from, recorded with the event below. Another opener
 * (the command palette, Help on a phone) adds its own place here.
 */
export enum HowOneUptimeWorksOpenedFrom {
  Help = "help",
  Home = "home",
}

/*
 * The event recorded each time it opens (#6830 lists "How it works opened"
 * among the behaviour events): the project it was opened in and from where.
 * One constant, so the event's name can follow the activation funnel's
 * naming once that is written down.
 */
export const HOW_ONEUPTIME_WORKS_OPENED_EVENT: string =
  "dashboard/how-oneuptime-works/opened";

export const HOW_ONEUPTIME_WORKS_DIALOG_TEST_ID: string =
  "how-oneuptime-works-dialog";

// Opens the dialog, from anywhere in the dashboard.
export const openHowOneUptimeWorks: (
  from: HowOneUptimeWorksOpenedFrom,
) => void = (from: HowOneUptimeWorksOpenedFrom): void => {
  GlobalEvents.dispatchEvent(EventName.HOW_ONEUPTIME_WORKS_OPEN, {
    from: from,
  });
};

const HowOneUptimeWorksDialog: FunctionComponent = (): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  useEffect(() => {
    const open: (event: CustomEvent) => void = (event: CustomEvent): void => {
      const from: unknown = (event.detail as { from?: unknown } | null)?.from;

      setIsOpen(true);
      UiAnalytics.capture(HOW_ONEUPTIME_WORKS_OPENED_EVENT, {
        projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
        from:
          typeof from === "string" ? from : HowOneUptimeWorksOpenedFrom.Help,
      });
    };

    GlobalEvents.addEventListener(EventName.HOW_ONEUPTIME_WORKS_OPEN, open);

    return () => {
      GlobalEvents.removeEventListener(EventName.HOW_ONEUPTIME_WORKS_OPEN, open);
    };
  }, []);

  if (!isOpen) {
    return <></>;
  }

  const close: () => void = (): void => {
    setIsOpen(false);
  };

  return (
    <Modal
      title={HOW_IT_WORKS_TITLE}
      modalWidth={ModalWidth.Large}
      onClose={close}
      closeButtonText="Close"
      /*
       * Something to read, not a form: the focus starts on the dialog, so
       * the first step does not light up, and Tab goes on from there.
       */
      isInitialFocusOnDialog={true}
    >
      <div data-testid={HOW_ONEUPTIME_WORKS_DIALOG_TEST_ID}>
        <HowOneUptimeWorks
          projectId={ProjectUtil.getCurrentProjectId()?.toString() || undefined}
          isInDialog={true}
          onStepOpened={close}
        />
      </div>
    </Modal>
  );
};

export default HowOneUptimeWorksDialog;
