import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import NewVersion, {
  NewVersionAudience,
  NewVersionState,
  NewVersionStatus,
} from "../../Utils/NewVersion/NewVersion";
import UnsavedChanges from "../../Utils/NewVersion/UnsavedChanges";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * "A new version of OneUptime is available": a small card in the corner of
 * the Dashboard and the Admin Dashboard once the server serves a newer build
 * than the tab runs (NewVersion).
 *
 * Quiet on purpose. The reader does not have to do anything: the next page
 * they open loads the new version by itself (NewVersionNavigation). Reload
 * brings it to this page now, back to the same place; when something typed
 * on the page is not saved yet, Reload asks first instead of losing it.
 * Dismissed, it stays away for this build and comes back for the next one.
 * It steps aside while the page itself says a new version is loading or
 * needed (ChunkLoadRecovery), and once a reload into it has begun.
 *
 * Status pages and public dashboards never show it: their visitors did not
 * choose OneUptime and get the new version on their next page all the same.
 */

// The product's primary and plain buttons, at the size a card's own take.
const PRIMARY_BUTTON_CLASS_NAME: string =
  "inline-flex items-center justify-center rounded-md border border-transparent bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors duration-150 ease-out hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

const PLAIN_BUTTON_CLASS_NAME: string =
  "inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors duration-150 ease-out hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

const NewVersionNotice: FunctionComponent = (): ReactElement | null => {
  const translator: Translator = useTranslator();

  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const [state, setState] = useState<NewVersionState>(NewVersion.getState());
  const [isDismissed, setIsDismissed] = useState<boolean>(
    NewVersion.isNoticeDismissed(),
  );
  const [isConfirmingReload, setIsConfirmingReload] = useState<boolean>(false);
  /*
   * Bumped on every notification: a reload starting or the page taking the
   * word changes what the notice shows without changing the state.
   */
  const [, setRevision] = useState<number>(0);

  useEffect(() => {
    // Whatever changed before this subscribed.
    setState(NewVersion.getState());
    setIsDismissed(NewVersion.isNoticeDismissed());

    return NewVersion.subscribe((next: NewVersionState): void => {
      setState(next);
      setIsDismissed(NewVersion.isNoticeDismissed());
      setRevision((revision: number): number => {
        return revision + 1;
      });
    });
  }, []);

  // A newer build than the one asked about: ask again.
  useEffect(() => {
    setIsConfirmingReload(false);
  }, [state.serverBuildId]);

  if (
    NewVersion.getAudience() !== NewVersionAudience.Members ||
    state.status !== NewVersionStatus.Available ||
    isDismissed ||
    // Already on its way to the new version, or the page says so itself.
    NewVersion.isReloadInProgress() ||
    NewVersion.isNoticeHeld()
  ) {
    return null;
  }

  const onReload: () => void = (): void => {
    if (!isConfirmingReload && UnsavedChanges.hasUnsavedChanges()) {
      setIsConfirmingReload(true);
      return;
    }

    NewVersion.reloadKeepingPlace();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="new-version-notice"
      data-confirming={isConfirmingReload ? "true" : "false"}
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 print:hidden sm:inset-x-auto sm:bottom-6 sm:start-6 sm:w-[24rem]"
    >
      <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
        <div
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-indigo-50 text-indigo-600"
          aria-hidden="true"
        >
          <Icon icon={IconProp.ArrowPath} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p
            className="text-sm font-semibold text-gray-900"
            data-testid="new-version-notice-title"
          >
            {translate("A new version of OneUptime is available")}
          </p>
          <p
            className="mt-1 text-sm text-gray-500"
            data-testid="new-version-notice-message"
          >
            {isConfirmingReload
              ? translate(
                  "Reload now? Changes you haven't saved on this page will be lost.",
                )
              : translate("The next page you open will use it.")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={PRIMARY_BUTTON_CLASS_NAME}
              data-testid="new-version-notice-reload"
              onClick={onReload}
            >
              {isConfirmingReload
                ? translate("Reload anyway")
                : translate("Reload")}
            </button>
            {isConfirmingReload ? (
              <button
                type="button"
                className={PLAIN_BUTTON_CLASS_NAME}
                data-testid="new-version-notice-cancel"
                onClick={() => {
                  setIsConfirmingReload(false);
                }}
              >
                {translate("Cancel")}
              </button>
            ) : (
              <></>
            )}
          </div>
        </div>
        <button
          type="button"
          className="-m-1 flex-none rounded-md p-1 text-gray-400 transition-colors duration-150 ease-out hover:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label={translate("Dismiss")}
          data-testid="new-version-notice-dismiss"
          onClick={() => {
            NewVersion.dismissNotice();
          }}
        >
          <Icon icon={IconProp.Close} className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default NewVersionNotice;
