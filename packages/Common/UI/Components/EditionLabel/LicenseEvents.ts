import GlobalEvents from "../../Utils/GlobalEvents";

/*
 * The edition pill reads the license when the page loads, and the Admin
 * Dashboard's license page, which changes it, is a page of its own. The page
 * announces every change here and the pill in the header reads the license
 * again, so it never keeps saying "Trial" beside a license that was just
 * activated.
 */
export const LICENSE_CHANGED_EVENT: string = "LICENSE_CHANGED";

export const announceLicenseChanged: () => void = (): void => {
  GlobalEvents.dispatchEvent(LICENSE_CHANGED_EVENT);
};

// Calls onChanged whenever the license changes. Returns the unsubscribe.
export const subscribeToLicenseChanged: (
  onChanged: () => void,
) => () => void = (onChanged: () => void): (() => void) => {
  const listener: () => void = (): void => {
    onChanged();
  };

  GlobalEvents.addEventListener(LICENSE_CHANGED_EVENT, listener);

  return (): void => {
    GlobalEvents.removeEventListener(LICENSE_CHANGED_EVENT, listener);
  };
};
