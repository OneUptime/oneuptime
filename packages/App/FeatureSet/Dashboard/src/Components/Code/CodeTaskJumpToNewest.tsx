import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

// What the button says, and what a screen reader names it.
export const CODE_TASK_JUMP_TO_NEWEST: string =
  translationKey("Jump to newest");

/*
 * Whether the newest turn is out of view: its reply starts below the part
 * of the window the reader sees - the window, less the reply box held at
 * its bottom (`footerHeight`). A reply the reader is in, or above, is in
 * view.
 */
export const isNewestOutOfView: (data: {
  newestTop: number | null;
  windowHeight: number;
  footerHeight: number;
}) => boolean = (data: {
  newestTop: number | null;
  windowHeight: number;
  footerHeight: number;
}): boolean => {
  if (data.newestTop === null || !Number.isFinite(data.newestTop)) {
    return false;
  }

  return data.newestTop > data.windowHeight - Math.max(0, data.footerHeight);
};

export interface ComponentProps {
  // The newest turn's reply: the conversation's last item.
  getNewest: () => Element | null;
  // The box held at the bottom of the window, over the conversation.
  getFooter: () => Element | null;
  /*
   * What grows as turns arrive: watched, so the button shows as soon as a
   * new turn starts out of view.
   */
  container?: Element | null | undefined;
  // Take the reader to the newest turn (useFollowLatest.jumpToNewest).
  onJump: () => void;
}

/*
 * JUMP TO NEWEST (#7129).
 *
 * A task's page opens at its top - what the task is and how it stands -
 * and a long one's newest turn, the one people come for, can be a hundred
 * screens below. While the newest turn is out of view, a button floats
 * over the reply box: Jump to newest. Pressed, the page goes to the newest
 * turn - its end, or no further than its reply's first line once AI is
 * done - and follows from there as AI works (useFollowLatest). It never
 * moves the page by itself: a reader who scrolled up to read stays there,
 * with the button to come back. Opening a task keeps opening it at its top,
 * as before, so its title and state are the first thing read.
 *
 * A real button, reached with Tab, named by its words; drawn only while
 * there is somewhere to jump, and hidden at the newest turn.
 */
const CodeTaskJumpToNewest: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isShown, setIsShown] = useState<boolean>(false);

  // The latest of each, for the listeners set up once.
  const getNewestRef: MutableRefObject<() => Element | null> = useRef<
    () => Element | null
  >(props.getNewest);
  getNewestRef.current = props.getNewest;

  const getFooterRef: MutableRefObject<() => Element | null> = useRef<
    () => Element | null
  >(props.getFooter);
  getFooterRef.current = props.getFooter;

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    let frame: number | null = null;

    const measure: () => void = (): void => {
      frame = null;

      const newest: Element | null = getNewestRef.current();
      const footer: Element | null = getFooterRef.current();

      setIsShown(
        isNewestOutOfView({
          newestTop: newest ? newest.getBoundingClientRect().top : null,
          windowHeight: window.innerHeight,
          footerHeight: footer ? footer.getBoundingClientRect().height : 0,
        }),
      );
    };

    // At most once a frame, however many scroll events a frame sends.
    const schedule: () => void = (): void => {
      if (frame !== null) {
        return;
      }

      frame =
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame(measure)
          : null;

      if (frame === null) {
        measure();
      }
    };

    measure();

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    const observer: ResizeObserver | null =
      props.container && typeof window.ResizeObserver === "function"
        ? new window.ResizeObserver(schedule)
        : null;

    if (observer && props.container) {
      observer.observe(props.container);
    }

    return (): void => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();

      if (frame !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [props.container]);

  if (!isShown) {
    return <></>;
  }

  return (
    <div
      data-testid="code-task-jump-to-newest"
      className="pointer-events-none absolute inset-x-0 -top-14 flex justify-center"
    >
      <div className="pointer-events-auto rounded-md shadow-md">
        <Button
          title={CODE_TASK_JUMP_TO_NEWEST}
          icon={IconProp.ArrowDown}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          dataTestId="code-task-jump-to-newest-button"
          onClick={() => {
            props.onJump();
            setIsShown(false);
          }}
        />
      </div>
    </div>
  );
};

export default CodeTaskJumpToNewest;
