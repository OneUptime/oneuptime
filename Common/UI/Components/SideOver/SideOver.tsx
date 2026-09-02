import Button, { ButtonStyleType } from "../Button/Button";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { lockPageScroll, unlockPageScroll } from "../../Utils/PageScrollLock";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

export enum SideOverSize {
  Small = "Small",
  Medium = "Medium",
  Large = "Large",
}

export interface ComponentProps {
  title: string;
  description: string;
  onClose: () => void;
  onSubmit?: (() => void) | undefined;
  children: ReactElement | Array<ReactElement>;
  submitButtonDisabled?: boolean | undefined;
  submitButtonText?: string | undefined;
  /*
   * Spinner on the submit button, and a disable that comes with it — the same
   * affordance Modal has always forwarded to its footer. Without it a panel
   * whose submit kicks off a long job has to hand-roll a "Creating..." label
   * and remember to disable itself, which is what every such panel here did.
   */
  submitButtonIsLoading?: boolean | undefined;
  /*
   * Disables the footer's Close button. Only worth setting while the panel is
   * running something it cannot abandon: the alternative every caller reached
   * for was to no-op inside `onClose`, which leaves a live-looking button that
   * does nothing when pressed.
   *
   * Note this does NOT disable the header's × — that one stays available so a
   * panel can never trap the user.
   */
  closeButtonDisabled?: boolean | undefined;
  leftFooterElement?: ReactElement | undefined;
  size?: SideOverSize | undefined;
  /*
   * Opt out of hiding the page's scrollbar while the panel is open. Only worth
   * setting for a panel that is a permanent part of its page rather than a
   * transient drawer — every current caller wants the lock.
   */
  disablePageScrollLock?: boolean | undefined;
}

type PortalTargetFunction = () => HTMLElement | null;

/*
 * Where the panel is appended in the DOM, not where it appears on screen — it
 * is `position: fixed` either way.
 *
 * Two reasons it cannot simply stay where the caller rendered it. First, any
 * ancestor with a z-index traps the panel in that ancestor's stacking context,
 * which is how a map's zoom toolbar (z-20) ended up painting on top of an open
 * device panel. Second, and unfixable by z-index at all: only the fullscreen
 * element's own subtree reaches the browser's top layer, so a panel appended to
 * <body> while a chart or map is fullscreen is not painted anywhere. Following
 * document.fullscreenElement keeps the panel visible in both modes.
 */
const getPortalTarget: PortalTargetFunction = (): HTMLElement | null => {
  if (typeof document === "undefined") {
    return null;
  }

  const fullscreenElement: Element | null = document.fullscreenElement;

  if (fullscreenElement instanceof HTMLElement) {
    return fullscreenElement;
  }

  return document.body;
};

const SideOver: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let widthClass: string = "max-w-2xl";

  if (props.size === SideOverSize.Small) {
    widthClass = "max-w-2xl";
  } else if (props.size === SideOverSize.Medium) {
    widthClass = "max-w-5xl";
  } else if (props.size === SideOverSize.Large) {
    widthClass = "max-w-7xl";
  }

  const titleId: string = useId();
  const descriptionId: string = useId();

  /*
   * The panel is mounted parked off the right edge and flipped into place one
   * frame later so the browser has something to transition from — the same
   * pattern Modal uses for its entrance.
   */
  const [hasEntered, setHasEntered] = useState<boolean>(false);

  useEffect(() => {
    const open: () => void = (): void => {
      setHasEntered(true);
    };

    const frame: number = requestAnimationFrame(open);

    /*
     * A hidden or throttled tab never runs an animation frame; the timer
     * skips the transition rather than leaving the panel offscreen.
     */
    const fallbackTimer: ReturnType<typeof setTimeout> = setTimeout(open, 80);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallbackTimer);
    };
  }, []);

  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(
    getPortalTarget,
  );

  useEffect(() => {
    const syncPortalTarget: () => void = (): void => {
      setPortalTarget(getPortalTarget());
    };

    /*
     * Re-read once on mount as well: the first render happens before the
     * browser has necessarily settled document.fullscreenElement.
     */
    syncPortalTarget();
    document.addEventListener("fullscreenchange", syncPortalTarget);

    return () => {
      document.removeEventListener("fullscreenchange", syncPortalTarget);
    };
  }, []);

  /*
   * A layout effect, not an ordinary one. Hiding the page scrollbar widens the
   * viewport that `right: 0` resolves against, so a panel that painted before
   * the lock landed would visibly jump sideways by the scrollbar's width on
   * every platform that draws a classic scrollbar. Locking before paint means
   * the panel is only ever drawn in its final position.
   */
  useLayoutEffect(() => {
    if (props.disablePageScrollLock) {
      return undefined;
    }

    lockPageScroll();

    return () => {
      unlockPageScroll();
    };
  }, [props.disablePageScrollLock]);

  const sideOver: ReactElement = (
    /*
     * z-30 clears every tier of page chrome (sticky headers and table headers
     * at z-10/z-20, map and log-viewer toolbars at z-20) while staying under
     * the app-wide overlays that must remain visible over a panel: the AI chat
     * panel at z-40, Modal at z-50, portalled dropdown menus at z-60.
     * Deliberately NOT z-40 — AIChatPanel is mounted ahead of the routed page
     * in App.tsx, so an equal z-index would be broken in this panel's favour
     * by document order and the AI drawer would disappear behind it.
     *
     * role="dialog" without aria-modal, because the panel genuinely is not
     * modal: everything outside it stays clickable by design (both topology
     * maps let you click straight from one node's panel to the next). Claiming
     * aria-modal also made this panel the last entry in Modal's dialog stack,
     * which silently disabled Escape, backdrop-dismissal and initial focus on
     * any Modal that was already open.
     */
    <div
      className="relative z-30"
      aria-labelledby={titleId}
      aria-describedby={props.description ? descriptionId : undefined}
      role="dialog"
      data-testid="side-over"
    >
      <div
        className="pointer-events-none fixed inset-0 flex justify-end"
        data-testid="side-over-layer"
      >
        {/*
         * Settled state carries no transform class at all: a lingering
         * translate would make the panel the containing block for
         * position:fixed descendants (the Modal invariant).
         */}
        <div
          className={`pointer-events-auto w-full ${widthClass} transition-transform duration-200 ease-out motion-reduce:transition-none ${
            hasEntered ? "" : "translate-x-full"
          }`}
        >
          <div className="flex h-full flex-col bg-white shadow-xl">
            <div className="flex-shrink-0 flex flex-col bg-gray-50 px-4 py-6 sm:px-6">
              <div className="flex items-start justify-between space-x-3">
                <div className="space-y-1">
                  <h2
                    className="text-lg font-medium text-gray-900"
                    id={titleId}
                    data-testid="side-over-title"
                  >
                    {props.title}
                  </h2>
                  <p
                    className="text-sm text-gray-500"
                    id={descriptionId}
                    data-testid="side-over-description"
                  >
                    {props.description}
                  </p>
                </div>
                <div className="flex h-7 items-center">
                  <button
                    onClick={() => {
                      props.onClose();
                    }}
                    type="button"
                    title="Close panel"
                    data-testid="close-button"
                    className="rounded-md text-gray-400 transition-colors duration-150 ease-out hover:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                  >
                    <span className="sr-only">Close panel</span>

                    <Icon className="h-6 w-6" icon={IconProp.Close} />
                  </button>
                </div>
              </div>
            </div>
            {/*
             * overflow-y-auto, not overflow-y-scroll: `scroll` paints a dead
             * track down the panel's right edge even when the content fits,
             * immediately beside the page's own scrollbar, which reads as the
             * page scrollbar bleeding through the panel. overscroll-contain
             * stops a wheel past the end of the panel from scrolling the page
             * out from under it.
             */}
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              data-testid="side-over-content"
            >
              <div className="space-y-6 py-6 sm:space-y-0 sm:divide-y sm:divide-gray-200 sm:py-0 p-5">
                {props.children}
              </div>
            </div>
            <div
              className="flex-shrink-0 border-t border-gray-200 px-4 py-5 sm:px-6 flex justify-between"
              data-testid="side-over-footer"
            >
              <div className="flex justify-start space-x-3">
                {props.leftFooterElement}
              </div>
              <div className="flex justify-end space-x-3">
                <Button
                  title="Close"
                  disabled={props.closeButtonDisabled}
                  onClick={() => {
                    props.onClose();
                  }}
                  buttonStyle={ButtonStyleType.NORMAL}
                />

                {props.onSubmit && (
                  <Button
                    title={props.submitButtonText || "Save"}
                    disabled={props.submitButtonDisabled}
                    isLoading={props.submitButtonIsLoading}
                    onClick={() => {
                      props.onSubmit!();
                    }}
                    buttonStyle={ButtonStyleType.PRIMARY}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (!portalTarget) {
    return sideOver;
  }

  return createPortal(sideOver, portalTarget);
};

export default SideOver;
