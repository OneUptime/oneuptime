import {
  ERROR_PAGE_DESCRIPTION_TEST_ID,
  ERROR_PAGE_NEXT_STEP_TEST_ID,
  ERROR_PAGE_TITLE_TEST_ID,
  ERROR_PAGE_TRY_AGAIN_TEST_ID,
} from "./PublicDashboardCopy";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * On the page's own ground (the body's), the darkest tone on the dark page.
 * The big code is drawn faint in both themes: a border's grey, which the
 * dark theme takes down to a slate that sits back on the dark ground
 * (Common/UI/Styles/Theme.css, --ou-border-strong), where text-gray-300
 * would turn bright. The page knows no dashboard's theme, so it follows the
 * visitor's own pick, else their device (App.tsx).
 */
export const ERROR_CODE_COLOR: string = "var(--ou-border-strong, #d1d5db)";

// The look of the one button an error page can have, as the sign-in pages draw theirs.
const BUTTON_CLASS_NAME: string =
  "inline-flex cursor-pointer justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700";

export interface ComponentProps {
  code: string;
  // English keys of the public dashboard's locales, looked up here.
  title: string;
  description: string;
  nextStep: string;
  /*
   * A way to try once more, where trying again can work (a visitor who
   * moves to an allowed network): a full load of the dashboard's address,
   * so the page asks the server again.
   */
  tryAgain?:
    | {
        text: string;
        address: string;
      }
    | undefined;
}

/*
 * A public dashboard's error page: what is wrong, then what to do next, in
 * the visitor's language, in a column with a gutter on a phone.
 */
const ErrorPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md text-center">
        <p
          className="text-6xl font-bold"
          style={{ color: ERROR_CODE_COLOR }}
          aria-hidden="true"
        >
          {props.code}
        </p>
        <h1
          className="mt-4 text-xl font-semibold text-gray-700"
          data-testid={ERROR_PAGE_TITLE_TEST_ID}
        >
          {t(props.title)}
        </h1>
        <p
          className="mt-2 text-balance text-sm text-gray-500"
          data-testid={ERROR_PAGE_DESCRIPTION_TEST_ID}
        >
          {t(props.description)}
        </p>
        <p
          className="mt-2 text-balance text-sm text-gray-500"
          data-testid={ERROR_PAGE_NEXT_STEP_TEST_ID}
        >
          {t(props.nextStep)}
        </p>
        {props.tryAgain ? (
          <div className="mt-6">
            <a
              href={props.tryAgain.address}
              className={BUTTON_CLASS_NAME}
              data-testid={ERROR_PAGE_TRY_AGAIN_TEST_ID}
            >
              {t(props.tryAgain.text)}
            </a>
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default ErrorPage;
