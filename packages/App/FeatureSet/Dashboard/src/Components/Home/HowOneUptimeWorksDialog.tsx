import EventName from "../../Utils/EventName";
import HowOneUptimeWorks, { HOW_IT_WORKS_TITLE } from "./HowOneUptimeWorks";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import WasThisClear from "Common/UI/Components/Feedback/WasThisClear";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ProductEvents from "Common/UI/Utils/ProductEvents";
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
  // Help in the phone's menu, where the header has no Help (#6816).
  PhoneMenu = "phone-menu",
  // A sample project's bar, whose story it is (#6808).
  SampleProject = "sample-project",
  // Search (Cmd/Ctrl+K): "how it works", "overview" (#6936).
  CommandPalette = "command-palette",
}

/*
 * Each opening is the activation funnel's "How it works" opened (#6830,
 * ProductEventName.HowItWorksOpened, as a product's own How it works sends
 * it), for the product "oneuptime", with where it was opened from.
 */
export const HOW_ONEUPTIME_WORKS_PRODUCT: string = "oneuptime";

export const HOW_ONEUPTIME_WORKS_DIALOG_TEST_ID: string =
  "how-oneuptime-works-dialog";

// The topic "Was this clear?" under the map is kept under (#6832).
export const HOW_ONEUPTIME_WORKS_FEEDBACK_TOPIC: string = "how_oneuptime_works";

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
      // The project, plan and language come with every product event.
      ProductEvents.send(ProductEventName.HowItWorksOpened, {
        product: HOW_ONEUPTIME_WORKS_PRODUCT,
        source:
          typeof from === "string" ? from : HowOneUptimeWorksOpenedFrom.Help,
      });
    };

    GlobalEvents.addEventListener(EventName.HOW_ONEUPTIME_WORKS_OPEN, open);

    return () => {
      GlobalEvents.removeEventListener(
        EventName.HOW_ONEUPTIME_WORKS_OPEN,
        open,
      );
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
        {/*
         * Whether the map helped (#6832): a quiet thumb up or down, only
         * where OneUptime may ask this person.
         */}
        <WasThisClear
          topic={HOW_ONEUPTIME_WORKS_FEEDBACK_TOPIC}
          className="mt-4"
        />
      </div>
    </Modal>
  );
};

export default HowOneUptimeWorksDialog;
