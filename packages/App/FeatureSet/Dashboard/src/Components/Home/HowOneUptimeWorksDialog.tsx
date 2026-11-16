import EventName from "../../Utils/EventName";
import {
  HOW_IT_WORKS_TITLE,
  HowOneUptimeWorksDocsLinks,
} from "./HowOneUptimeWorks";
import HowOneUptimeWorksOverview from "./HowOneUptimeWorksOverview";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";
import WasThisClear from "Common/UI/Components/Feedback/WasThisClear";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ProductEvents from "Common/UI/Utils/ProductEvents";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * "HOW ONEUPTIME WORKS", ALWAYS ONE CLICK AWAY.
 *
 * What OneUptime does and how it fits together, from any page and in any
 * project however old: the four steps a problem moves through, with the
 * products that do each, then every product, by category
 * (HowOneUptimeWorksOverview, #8891). Help opens it, Home opens it, Search
 * opens it, and so can anything else that calls openHowOneUptimeWorks.
 * It used to name four products only, as the Welcome checklist's strip did
 * until the checklist opened this instead (#8995).
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
  // Beside Explore OneUptime, on Home.
  Home = "home",
  /*
   * A new project's Welcome checklist on Home: the line under its steps,
   * and the line it leaves when hidden (#8995).
   */
  WelcomeChecklist = "welcome-checklist",
  // Help in the phone's menu, where the header has no Help (#6816).
  PhoneMenu = "phone-menu",
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

// The topic "Was this clear?" under the overview is kept under (#6832).
export const HOW_ONEUPTIME_WORKS_FEEDBACK_TOPIC: string = "how_oneuptime_works";

// The line under the dialog's title: what it holds.
export const HOW_ONEUPTIME_WORKS_DESCRIPTION: string = translationKey(
  "Everything OneUptime does, and how it fits together.",
);

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

  /*
   * The focus starts on the first section's tab, as a dialog's starts on
   * the first thing in its body: the arrow keys walk the sections from
   * there, and Tab goes on into the section shown.
   */
  return (
    <Modal
      title={HOW_IT_WORKS_TITLE}
      description={HOW_ONEUPTIME_WORKS_DESCRIPTION}
      modalWidth={ModalWidth.Large}
      onClose={close}
      closeButtonText="Close"
    >
      <div data-testid={HOW_ONEUPTIME_WORKS_DIALOG_TEST_ID}>
        <HowOneUptimeWorksOverview
          projectId={ProjectUtil.getCurrentProjectId()?.toString() || undefined}
          onProductOpened={close}
        />
        {/*
         * Where the docs say more, and whether this helped (#6832): a quiet
         * thumb up or down, only where OneUptime may ask this person.
         */}
        <div className="mt-6 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <WasThisClear topic={HOW_ONEUPTIME_WORKS_FEEDBACK_TOPIC} />
          <HowOneUptimeWorksDocsLinks className="text-sm" />
        </div>
      </div>
    </Modal>
  );
};

export default HowOneUptimeWorksDialog;
