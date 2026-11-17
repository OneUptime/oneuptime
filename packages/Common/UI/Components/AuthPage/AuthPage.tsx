import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * The frame every sign-in page is drawn in: OneUptime's own (Accounts) and a
 * status page's (its sign-in, single sign-on, sign-in link, password prompt,
 * forgot and reset password pages). A logo, a title and one sentence under
 * it, a card that holds the form, and a line under the card that leads back.
 *
 * It was written out in each page. The status pages kept an older copy of
 * it (#9132): no gutter on a phone, so the card's square corners touched
 * both edges of the screen, a title that stayed 24px on a 390px screen, and
 * 48px of empty space above the logo. Every page now draws this one, so the
 * two apps match on a phone and in the dark theme.
 *
 * The page brings its own logo (the product's, or the status page's own
 * branding) and its words; the frame brings the widths, the gutters, the
 * spacing and the card.
 */

// One column, as wide as a sign-in form, with a 16px gutter on a phone.
export const AUTH_PAGE_CLASS: string =
  "flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8";

export const AUTH_PAGE_COLUMN_CLASS: string = "w-full max-w-md mx-auto";

// A name of any length wraps rather than running off a phone's screen.
export const AUTH_PAGE_TITLE_CLASS: string =
  "mt-4 sm:mt-6 break-words text-center text-xl sm:text-2xl tracking-tight text-gray-900";

export const AUTH_PAGE_SUBTITLE_CLASS: string =
  "mt-2 text-balance text-center text-sm text-gray-600 px-2 sm:px-0";

// Rounded on a phone too: a square card running edge to edge read as a sheet.
export const AUTH_PAGE_CARD_CLASS: string =
  "bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10";

export const AUTH_PAGE_FOOTER_CLASS: string = "mt-4 sm:mt-5 text-center";

export const AUTH_PAGE_FOOTER_TEXT_CLASS: string =
  "mb-0 text-gray-500 text-sm sm:text-base";

// A link in a sentence on these pages: "Remember your password? Sign in."
export const AUTH_PAGE_LINK_CLASS: string =
  "text-indigo-500 hover:text-indigo-900 cursor-pointer";

export const AUTH_PAGE_TEST_ID: string = "auth-page";
export const AUTH_PAGE_TITLE_TEST_ID: string = "auth-page-title";
export const AUTH_PAGE_SUBTITLE_TEST_ID: string = "auth-page-subtitle";
export const AUTH_PAGE_CARD_TEST_ID: string = "auth-page-card";
export const AUTH_PAGE_FOOTER_TEST_ID: string = "auth-page-footer";

export interface ComponentProps {
  // The product's logo, or the status page's.
  logo?: ReactNode | undefined;
  // What the page is for, in Title Case or as a sentence. None on a page whose card says it.
  title?: ReactNode | undefined;
  titleTestId?: string | undefined;
  // One sentence under the title: what to do here.
  subtitle?: ReactNode | undefined;
  subtitleTestId?: string | undefined;
  // What goes in the card: the form, or what happened.
  children?: ReactNode | undefined;
  /*
   * Drawn above the card, in the same column: a notice that stands for the
   * form (a server that cannot send email has no form to show).
   */
  beforeCard?: ReactNode | undefined;
  // False draws no card at all: the page has only a notice to show.
  hasCard?: boolean | undefined;
  cardClassName?: string | undefined;
  cardTestId?: string | undefined;
  // The line under the card, usually the way back to sign in.
  footer?: ReactNode | undefined;
  footerTestId?: string | undefined;
  dataTestId?: string | undefined;
}

const AuthPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const hasCard: boolean = props.hasCard !== false;

  return (
    <div
      className={AUTH_PAGE_CLASS}
      data-testid={props.dataTestId || AUTH_PAGE_TEST_ID}
    >
      <div className={AUTH_PAGE_COLUMN_CLASS}>
        {props.logo}
        {props.title ? (
          <h2
            className={AUTH_PAGE_TITLE_CLASS}
            data-testid={props.titleTestId || AUTH_PAGE_TITLE_TEST_ID}
          >
            {props.title}
          </h2>
        ) : (
          <></>
        )}
        {props.subtitle ? (
          <p
            className={AUTH_PAGE_SUBTITLE_CLASS}
            data-testid={props.subtitleTestId || AUTH_PAGE_SUBTITLE_TEST_ID}
          >
            {props.subtitle}
          </p>
        ) : (
          <></>
        )}
      </div>

      <div className={`mt-6 sm:mt-8 ${AUTH_PAGE_COLUMN_CLASS}`}>
        {props.beforeCard}
        {hasCard ? (
          <div
            className={
              props.cardClassName
                ? `${AUTH_PAGE_CARD_CLASS} ${props.cardClassName}`
                : AUTH_PAGE_CARD_CLASS
            }
            data-testid={props.cardTestId || AUTH_PAGE_CARD_TEST_ID}
          >
            {props.children}
          </div>
        ) : (
          <></>
        )}
        {props.footer ? (
          <div
            className={AUTH_PAGE_FOOTER_CLASS}
            data-testid={props.footerTestId || AUTH_PAGE_FOOTER_TEST_ID}
          >
            <p className={AUTH_PAGE_FOOTER_TEXT_CLASS}>{props.footer}</p>
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default AuthPage;
