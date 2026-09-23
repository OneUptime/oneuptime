/** @timezone Asia/Kolkata */

/**
 * The dashboard saves a new user's timezone from the browser's guess, and
 * asks an existing user whether to update it when the guess differs from
 * the saved one. Both went through the browser's own spelling of the zone,
 * and Chromium spells many zones the ICU way: India is "Asia/Calcutta",
 * Ukraine "Europe/Kiev". Those are legacy tz names the picker no longer
 * offers, so a new user is now saved under the current name, and a saved
 * legacy name is compared as its current name — otherwise every such user
 * would be asked to "change" to the zone they already have.
 *
 * A saved legacy name is never rewritten, in browser storage or on the
 * server. The pickers show it as its current name, and nothing but the
 * user's own choice (the first-run save, or accepting the prompt) writes a
 * timezone.
 *
 * The file runs with TZ=Asia/Kolkata, the zone Node and Chromium both
 * report as "Asia/Calcutta", so the first test reproduces the bug without a
 * mock. The rest pin the guess with a spy. User and LocalStorage are the
 * real ones over jsdom's localStorage; only the profile request is mocked.
 */
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { act } from "react";
import { Mock, SpyInstance } from "jest-mock";
import moment from "moment-timezone";
import UserTimezoneInit from "../../../../App/FeatureSet/Dashboard/src/Components/UserTimezone/UserTimezoneInit";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import User from "../../../UI/Utils/User";

const updateByIdMock: Mock<(args: unknown) => Promise<void>> =
  jest.fn<(args: unknown) => Promise<void>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      updateById: (args: unknown): Promise<void> => {
        return updateByIdMock(args);
      },
    },
  };
});

const SAVED_KEY: string = "user_timezone";
const DISMISSED_KEY: string = "user_timezone_dismissed";

type LocalStorageContents = Record<string, string | null>;

const getLocalStorageContents: () => LocalStorageContents =
  (): LocalStorageContents => {
    const contents: LocalStorageContents = {};

    for (let index: number = 0; index < localStorage.length; index++) {
      const key: string | null = localStorage.key(index);

      if (key !== null) {
        contents[key] = localStorage.getItem(key);
      }
    }

    return contents;
  };

interface SetupOptions {
  saved?: string | undefined;
  dismissed?: string | undefined;
  // What moment.tz.guess() reports; the runtime's own guess when omitted.
  guess?: string | undefined;
  /*
   * Run UserUtil.initializeUserTimezone first, as the dashboard's Index.tsx
   * does before its first render.
   */
  initialize?: boolean | undefined;
}

/*
 * Resolves to everything in localStorage just before the component
 * rendered, so a test can prove the component wrote nothing at all.
 */
const renderInit: (
  options: SetupOptions,
) => Promise<LocalStorageContents> = async (
  options: SetupOptions,
): Promise<LocalStorageContents> => {
  if (options.saved !== undefined) {
    localStorage.setItem(SAVED_KEY, options.saved);
  }

  if (options.dismissed !== undefined) {
    localStorage.setItem(DISMISSED_KEY, options.dismissed);
  }

  if (options.guess !== undefined) {
    jest.spyOn(moment.tz, "guess").mockReturnValue(options.guess);
  }

  if (options.initialize) {
    User.initializeUserTimezone();
  }

  const before: LocalStorageContents = getLocalStorageContents();

  await act(async () => {
    render(<UserTimezoneInit />);
  });

  return before;
};

const getPrompt: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId("confirm-modal-description");
};

const getSavedTimezone: () => string | null = (): string | null => {
  return localStorage.getItem(SAVED_KEY);
};

const savedTimezoneSentToServer: () => Array<unknown> = (): Array<unknown> => {
  return updateByIdMock.mock.calls.map((call: Array<unknown>): unknown => {
    return ((call[0] as { data: { timezone: unknown } }).data || {}).timezone;
  });
};

describe("UserTimezoneInit", () => {
  beforeEach(() => {
    localStorage.clear();
    OneUptimeDate.setUserTimezone(null);
    updateByIdMock.mockReset();
    updateByIdMock.mockResolvedValue(undefined);

    // Signed in: User.isLoggedIn reads the email, the save reads the id.
    localStorage.setItem("user_email", "user@example.com");
    localStorage.setItem("user_id", "11111111-1111-4111-8111-111111111111");
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    localStorage.clear();
    OneUptimeDate.setUserTimezone(null);
  });

  describe("first sign-in on this browser", () => {
    test("saves the runtime's own guess for India as Asia/Kolkata", async () => {
      /*
       * Node 24 and Chromium report Asia/Calcutta here; an ICU that has
       * caught up reports Asia/Kolkata. Either way the profile gets the
       * name the picker offers.
       */
      expect([Timezone.AsiaCalcutta, Timezone.AsiaKolkata]).toContain(
        moment.tz.guess(),
      );

      await renderInit({});

      await waitFor(() => {
        expect(updateByIdMock).toHaveBeenCalledTimes(1);
      });

      expect(savedTimezoneSentToServer()).toEqual([Timezone.AsiaKolkata]);
      expect(getSavedTimezone()).toBe(Timezone.AsiaKolkata);
      expect(OneUptimeDate.getUserTimezone()).toBe(Timezone.AsiaKolkata);
      expect(getPrompt()).toBeNull();
    });

    test.each([
      [Timezone.AsiaCalcutta, Timezone.AsiaKolkata],
      [Timezone.EuropeKiev, Timezone.EuropeKyiv],
      [Timezone.AsiaSaigon, Timezone.AsiaHo_Chi_Minh],
      [Timezone.AsiaRangoon, Timezone.AsiaYangon],
      [Timezone.AmericaGodthab, Timezone.AmericaNuuk],
      [Timezone.EtcUTC, Timezone.UTC],
    ])(
      "saves a guessed %s under its current name, %s",
      async (guess: Timezone, current: Timezone) => {
        await renderInit({ guess: guess });

        await waitFor(() => {
          expect(updateByIdMock).toHaveBeenCalledTimes(1);
        });

        expect(savedTimezoneSentToServer()).toEqual([current]);
        expect(getSavedTimezone()).toBe(current);
        expect(getPrompt()).toBeNull();
      },
    );

    test("saves a current guess exactly as it is", async () => {
      await renderInit({ guess: Timezone.AmericaNew_York });

      await waitFor(() => {
        expect(updateByIdMock).toHaveBeenCalledTimes(1);
      });

      expect(savedTimezoneSentToServer()).toEqual([Timezone.AmericaNew_York]);
      expect(getSavedTimezone()).toBe(Timezone.AmericaNew_York);
    });

    test("does nothing for a signed-out visitor", async () => {
      localStorage.removeItem("user_email");

      await renderInit({ guess: Timezone.AsiaCalcutta });

      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(getSavedTimezone()).toBeNull();
      expect(getPrompt()).toBeNull();
    });
  });

  describe("a saved legacy name", () => {
    /*
     * The saved value is what an older build stored: the untranslated
     * guess, or a name the picker offered at the time. It is compared as its
     * current name and otherwise left exactly as it was: the server's copy
     * of the profile is not rewritten either, and the browser's copy must
     * keep matching it.
     */
    const LEGACY_SAVED: Array<[Timezone, Timezone]> = [
      [Timezone.AsiaCalcutta, Timezone.AsiaKolkata],
      [Timezone.EuropeKiev, Timezone.EuropeKyiv],
      [Timezone.Singapore, Timezone.AsiaSingapore],
      [Timezone.USPacific, Timezone.AmericaLos_Angeles],
      [Timezone.EtcUTC, Timezone.UTC],
      // Removed from tzdata; moment cannot resolve it at all.
      [Timezone.USPacificNew, Timezone.AmericaLos_Angeles],
    ];

    let saveSpy: SpyInstance<typeof User.setSavedUserTimezone>;

    beforeEach(() => {
      saveSpy = jest.spyOn(User, "setSavedUserTimezone");
    });

    test.each(LEGACY_SAVED)(
      "once the app has initialised it, %s (%s) means no prompt, no save and untouched storage",
      async (saved: Timezone, current: Timezone) => {
        const before: LocalStorageContents = await renderInit({
          saved: saved,
          initialize: true,
        });

        expect(getPrompt()).toBeNull();
        expect(updateByIdMock).not.toHaveBeenCalled();
        expect(saveSpy).not.toHaveBeenCalled();
        expect(getLocalStorageContents()).toEqual(before);
        expect(getSavedTimezone()).toBe(saved);
        /*
         * Dates are still read in the zone's current name: that is the
         * in-memory setting, not a write.
         */
        expect(OneUptimeDate.getUserTimezone()).toBe(current);
      },
    );

    /*
     * Not initialised, so the component compares the saved value with the
     * browser's own guess, in either spelling: saved Asia/Calcutta against
     * guessed Asia/Calcutta used to be equal only because neither side was
     * translated.
     */
    test.each(
      LEGACY_SAVED.flatMap(
        ([saved, current]: [Timezone, Timezone]): Array<
          [Timezone, Timezone, Timezone]
        > => {
          return [
            [saved, current, current],
            [saved, current, saved],
          ];
        },
      ),
    )(
      "saved %s (%s) with the browser reporting %s: no prompt, no save, storage untouched",
      async (saved: Timezone, _current: Timezone, guess: Timezone) => {
        const before: LocalStorageContents = await renderInit({
          saved: saved,
          guess: guess,
        });

        expect(getPrompt()).toBeNull();
        expect(updateByIdMock).not.toHaveBeenCalled();
        expect(saveSpy).not.toHaveBeenCalled();
        expect(getLocalStorageContents()).toEqual(before);
        expect(getSavedTimezone()).toBe(saved);
      },
    );

    test("matches in any case or padding, and keeps the value as it was typed", async () => {
      const before: LocalStorageContents = await renderInit({
        saved: " asia/calcutta ",
        guess: Timezone.AsiaKolkata,
      });

      expect(getPrompt()).toBeNull();
      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
      expect(getLocalStorageContents()).toEqual(before);
      expect(getSavedTimezone()).toBe(" asia/calcutta ");
    });

    test("honours a dismissal an older build saved under a legacy name, and leaves it as it was", async () => {
      const before: LocalStorageContents = await renderInit({
        saved: Timezone.EuropeLondon,
        dismissed: Timezone.EuropeKiev,
        guess: Timezone.EuropeKyiv,
      });

      expect(getPrompt()).toBeNull();
      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(getLocalStorageContents()).toEqual(before);
      expect(localStorage.getItem(DISMISSED_KEY)).toBe(Timezone.EuropeKiev);
    });

    test("still prompts when the browser really is somewhere else, and leaves the saved name alone until the user answers", async () => {
      const before: LocalStorageContents = await renderInit({
        saved: Timezone.USPacific,
        guess: Timezone.AsiaCalcutta,
      });

      const prompt: HTMLElement | null = getPrompt();

      expect(prompt).not.toBeNull();
      expect(
        within(prompt!).getByText(Timezone.AsiaKolkata),
      ).toBeInTheDocument();
      expect(getLocalStorageContents()).toEqual(before);
      expect(getSavedTimezone()).toBe(Timezone.USPacific);
      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
    });

    test("is not mistaken for another clock that merely sounds alike", async () => {
      /*
       * US/Samoa is AMERICAN Samoa (Pacific/Pago_Pago, UTC-11), not the
       * country Samoa (Pacific/Apia, UTC+13): translating must not make
       * them equal and swallow the prompt.
       */
      await renderInit({
        saved: Timezone.USSamoa,
        guess: Timezone.PacificApia,
      });

      const prompt: HTMLElement | null = getPrompt();

      expect(prompt).not.toBeNull();
      expect(
        within(prompt!).getByText(Timezone.PacificApia),
      ).toBeInTheDocument();
      expect(getSavedTimezone()).toBe(Timezone.USSamoa);
    });

    test("is replaced only when the user accepts the prompt, and then by the new zone's current name", async () => {
      await renderInit({
        saved: Timezone.USPacific,
        guess: Timezone.AsiaCalcutta,
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      });

      await waitFor(() => {
        expect(updateByIdMock).toHaveBeenCalledTimes(1);
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(saveSpy).toHaveBeenCalledWith(Timezone.AsiaKolkata);
      expect(savedTimezoneSentToServer()).toEqual([Timezone.AsiaKolkata]);
      expect(getSavedTimezone()).toBe(Timezone.AsiaKolkata);
    });

    test("is kept when the user dismisses the prompt", async () => {
      await renderInit({
        saved: Timezone.USPacific,
        guess: Timezone.AsiaCalcutta,
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("modal-footer-close-button"));
      });

      expect(getPrompt()).toBeNull();
      expect(getSavedTimezone()).toBe(Timezone.USPacific);
      expect(localStorage.getItem(DISMISSED_KEY)).toBe(Timezone.AsiaKolkata);
      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(saveSpy).not.toHaveBeenCalled();
    });
  });

  describe("a saved current name", () => {
    test("is left exactly as it is when the browser reports the ICU spelling", async () => {
      await renderInit({
        saved: Timezone.AsiaKolkata,
        guess: Timezone.AsiaCalcutta,
      });

      expect(getPrompt()).toBeNull();
      expect(getSavedTimezone()).toBe(Timezone.AsiaKolkata);
      expect(updateByIdMock).not.toHaveBeenCalled();
    });

    test("is left alone after the app initialises it", async () => {
      await renderInit({
        saved: Timezone.EuropeKyiv,
        guess: Timezone.EuropeKiev,
        initialize: true,
      });

      expect(getPrompt()).toBeNull();
      expect(getSavedTimezone()).toBe(Timezone.EuropeKyiv);
      expect(updateByIdMock).not.toHaveBeenCalled();
    });
  });

  describe("the update prompt", () => {
    test("offers the current name of a genuinely different zone", async () => {
      await renderInit({
        saved: Timezone.EuropeLondon,
        guess: Timezone.AsiaCalcutta,
      });

      const prompt: HTMLElement | null = getPrompt();

      expect(prompt).not.toBeNull();
      expect(
        within(prompt!).getByText(Timezone.AsiaKolkata),
      ).toBeInTheDocument();
      expect(prompt!.textContent).not.toContain(Timezone.AsiaCalcutta);
      // Nothing is written until the user answers.
      expect(getSavedTimezone()).toBe(Timezone.EuropeLondon);
    });

    test("saves the current name when accepted", async () => {
      localStorage.setItem(DISMISSED_KEY, Timezone.AmericaNew_York);

      await renderInit({
        saved: Timezone.EuropeLondon,
        guess: Timezone.AsiaCalcutta,
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      });

      await waitFor(() => {
        expect(updateByIdMock).toHaveBeenCalledTimes(1);
      });

      expect(savedTimezoneSentToServer()).toEqual([Timezone.AsiaKolkata]);
      expect(getSavedTimezone()).toBe(Timezone.AsiaKolkata);
      expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
      expect(getPrompt()).toBeNull();
    });

    test("remembers the dismissal under the current name", async () => {
      await renderInit({
        saved: Timezone.EuropeLondon,
        guess: Timezone.AsiaCalcutta,
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("modal-footer-close-button"));
      });

      expect(getPrompt()).toBeNull();
      expect(localStorage.getItem(DISMISSED_KEY)).toBe(Timezone.AsiaKolkata);
      expect(getSavedTimezone()).toBe(Timezone.EuropeLondon);
      expect(updateByIdMock).not.toHaveBeenCalled();
    });

    test.each([
      // Dismissed by an older build, which stored the ICU spelling.
      [Timezone.AsiaCalcutta, Timezone.AsiaCalcutta],
      [Timezone.AsiaCalcutta, Timezone.AsiaKolkata],
      // Dismissed by this build, with the browser still on the ICU spelling.
      [Timezone.AsiaKolkata, Timezone.AsiaCalcutta],
      [Timezone.AsiaKolkata, Timezone.AsiaKolkata],
    ])(
      "stays dismissed: dismissed %s, browser now reports %s",
      async (dismissed: Timezone, guess: Timezone) => {
        await renderInit({
          saved: Timezone.EuropeLondon,
          dismissed: dismissed,
          guess: guess,
        });

        expect(getPrompt()).toBeNull();
        expect(updateByIdMock).not.toHaveBeenCalled();
      },
    );

    test("comes back when the browser moves to another zone than the one dismissed", async () => {
      await renderInit({
        saved: Timezone.EuropeLondon,
        dismissed: Timezone.EuropeKiev,
        guess: Timezone.AsiaCalcutta,
      });

      const prompt: HTMLElement | null = getPrompt();

      expect(prompt).not.toBeNull();
      expect(
        within(prompt!).getByText(Timezone.AsiaKolkata),
      ).toBeInTheDocument();
    });

    test("still appears for a saved value that is not a zone at all", async () => {
      await renderInit({
        saved: "Mars/Olympus",
        guess: Timezone.AsiaCalcutta,
        initialize: true,
      });

      expect(OneUptimeDate.getUserTimezone()).toBeNull();
      // An unknown value is left exactly as it was, like any other.
      expect(getSavedTimezone()).toBe("Mars/Olympus");

      const prompt: HTMLElement | null = getPrompt();

      expect(prompt).not.toBeNull();
      expect(
        within(prompt!).getByText(Timezone.AsiaKolkata),
      ).toBeInTheDocument();
    });
  });
});
