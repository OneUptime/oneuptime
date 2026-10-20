import React, { FunctionComponent, ReactElement } from "react";

/*
 * On the page's own ground (the body's), the darkest tone on the dark page.
 * The big code is drawn faint in both themes: a border's grey, which the
 * dark theme takes down to a slate that sits back on the dark ground
 * (Common/UI/Styles/Theme.css, --ou-border-strong), where text-gray-300
 * would turn bright. The page knows no dashboard's theme, so it follows the
 * visitor's own pick, else their device (App.tsx).
 */
export const ERROR_CODE_COLOR: string = "var(--ou-border-strong, #d1d5db)";

const NotFoundPage: FunctionComponent = (): ReactElement => {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold" style={{ color: ERROR_CODE_COLOR }}>
          404
        </h1>
        <h2 className="mt-4 text-xl font-semibold text-gray-700">
          Dashboard Not Found
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          The dashboard you are looking for does not exist or is no longer
          available.
        </p>
      </div>
    </div>
  );
};

export default NotFoundPage;
