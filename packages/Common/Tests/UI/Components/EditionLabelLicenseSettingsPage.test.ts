import {
  announceLicenseChanged,
  LICENSE_CHANGED_EVENT,
  subscribeToLicenseChanged,
} from "../../../UI/Components/EditionLabel/LicenseEvents";
import {
  getLicenseSettingsPageUrl,
  LICENSE_SETTINGS_PAGE_PATH,
} from "../../../UI/Components/EditionLabel/LicenseSettingsPage";
import { ADMIN_DASHBOARD_URL } from "../../../UI/Config";
import URL from "../../../Types/API/URL";
import { describe, expect, it, jest } from "@jest/globals";

/*
 * The two things core knows about the license page, which is the Enterprise
 * Edition's (ee/AdminDashboard/License): where it is, so the edition dialog
 * of both dashboards can lead to it, and that it changed the license, so the
 * edition pill can follow.
 */

describe("where the license page is", () => {
  it("is the settings path the Enterprise plugin registers", () => {
    expect(LICENSE_SETTINGS_PAGE_PATH).toBe("license");
  });

  it("is under the Admin Dashboard, as a whole URL: the Dashboard is another app", () => {
    const url: URL = getLicenseSettingsPageUrl();

    expect(url).toBeInstanceOf(URL);
    expect(url.toString()).toBe(
      `${ADMIN_DASHBOARD_URL.toString()}/settings/license`,
    );
  });

  it("leaves the Admin Dashboard's own URL as it was", () => {
    const before: string = ADMIN_DASHBOARD_URL.toString();

    getLicenseSettingsPageUrl();
    getLicenseSettingsPageUrl();

    expect(ADMIN_DASHBOARD_URL.toString()).toBe(before);
  });

  it("is a new URL every time, so a caller can never change the next one", () => {
    expect(getLicenseSettingsPageUrl()).not.toBe(getLicenseSettingsPageUrl());
  });
});

describe("telling the pill the license changed", () => {
  it("reaches a subscriber", () => {
    const onChanged: jest.Mock = jest.fn();
    const unsubscribe: () => void = subscribeToLicenseChanged(
      onChanged as () => void,
    );

    announceLicenseChanged();

    expect(onChanged).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("reaches every subscriber", () => {
    const first: jest.Mock = jest.fn();
    const second: jest.Mock = jest.fn();
    const unsubscribeFirst: () => void = subscribeToLicenseChanged(
      first as () => void,
    );
    const unsubscribeSecond: () => void = subscribeToLicenseChanged(
      second as () => void,
    );

    announceLicenseChanged();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it("stops after the unsubscribe, for that subscriber only", () => {
    const leaving: jest.Mock = jest.fn();
    const staying: jest.Mock = jest.fn();
    const unsubscribeLeaving: () => void = subscribeToLicenseChanged(
      leaving as () => void,
    );
    const unsubscribeStaying: () => void = subscribeToLicenseChanged(
      staying as () => void,
    );

    unsubscribeLeaving();
    announceLicenseChanged();

    expect(leaving).not.toHaveBeenCalled();
    expect(staying).toHaveBeenCalledTimes(1);

    unsubscribeStaying();
  });

  it("carries nothing a listener could mistake for the license itself", () => {
    const events: Array<Event> = [];
    const listener: (event: Event) => void = (event: Event): void => {
      events.push(event);
    };

    window.addEventListener(LICENSE_CHANGED_EVENT, listener);

    announceLicenseChanged();

    window.removeEventListener(LICENSE_CHANGED_EVENT, listener);

    expect(events).toHaveLength(1);
    expect((events[0] as CustomEvent).detail).toEqual({});
  });
});
