import Tippy from "@tippyjs/react";
import React, {
  cloneElement,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import "tippy.js/dist/tippy.css";
import "tippy.js/themes/light-border.css";
import "tippy.js/animations/shift-away-subtle.css";

export interface ComponentProps {
  text?: string | undefined;
  children: ReactElement;
  richContent?: ReactElement | undefined;
  // Large collections can wait to create a tooltip until first opened.
  lazy?: boolean | undefined;
}

interface PopupProps extends ComponentProps {
  reference?: HTMLElement | undefined;
}

const TooltipPopup: FunctionComponent<PopupProps> = (
  props: PopupProps,
): ReactElement => {
  if (!props.text && !props.richContent) {
    return props.children;
  }

  const tooltipContent: ReactElement = props.richContent ? (
    props.richContent
  ) : (
    <span>{props.text}</span>
  );

  const isRich: boolean = Boolean(props.richContent);

  const themeProps: { theme: string } | Record<string, never> = isRich
    ? { theme: "light-border" }
    : {};

  const animationProps: { animation: string } | Record<string, never> = isRich
    ? { animation: "shift-away-subtle" }
    : {};

  return (
    <Tippy
      /*
       * Deliberately no key. This used to carry key={Math.random()}, which
       * gives the element a different identity on every render and so unmounts
       * and remounts the child each time the parent re-renders. Tippy updates
       * its content from props perfectly well without that, and the remount
       * had two costs worth naming: a page that re-renders on a timer tore
       * down and rebuilt every tooltipped element under it (a status page
       * draws ninety of them per resource), and anything focused inside one
       * lost focus on every tick - which makes a keyboard-navigable widget
       * impossible to build under it.
       */
      content={tooltipContent}
      {...(props.reference
        ? { reference: props.reference, showOnCreate: true }
        : { children: props.children })}
      interactive={isRich}
      trigger="mouseenter focus"
      hideOnClick={false}
      maxWidth={isRich ? 380 : 350}
      delay={isRich ? [120, 80] : [0, 0]}
      duration={[200, 150]}
      placement={isRich ? "top" : "top"}
      {...themeProps}
      {...animationProps}
      aria={{
        content: "describedby",
        /*
         * Tippy's default ("auto") stamps aria-expanded onto the trigger, but our
         * triggers are often plain non-interactive elements (e.g. uptime bars) whose
         * role does not support aria-expanded (WCAG 4.1.2). Disable it.
         */
        expanded: false,
      }}
    />
  );
};

const Tooltip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [reference, setReference] = useState<HTMLElement | null>(null);

  if (!props.lazy || (!props.text && !props.richContent)) {
    return <TooltipPopup {...props} />;
  }

  /*
   * Keep the trigger in the same place before and after opening. Wrapping it
   * in Tippy on first interaction would replace the DOM node and lose focus.
   * Tippy attaches its normal hover, focus and interactive-hide handlers to
   * this external reference once, when the visitor first uses the tooltip.
   */
  const child: ReactElement<React.HTMLAttributes<HTMLElement>> = props.children;

  return (
    <>
      {cloneElement(child, {
        onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
          child.props.onMouseEnter?.(event);
          setReference(event.currentTarget);
        },
        onFocus: (event: React.FocusEvent<HTMLElement>) => {
          child.props.onFocus?.(event);
          setReference(event.currentTarget);
        },
      })}
      {reference && <TooltipPopup {...props} reference={reference} />}
    </>
  );
};

export default Tooltip;
