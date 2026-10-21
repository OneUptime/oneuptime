import React, { FunctionComponent, ReactElement } from "react";

/*
 * An email's HTML, shown as the recipient's mail client would show it: in an
 * iframe of its own, from srcDoc, so none of the dashboard's styles reach it
 * and none of its styles reach the dashboard.
 *
 * The email is not trusted. A custom template is HTML an admin wrote, and the
 * values filled into it come from incidents, notes and status pages, so the
 * frame is sandboxed without allow-scripts - nothing in it runs - and without
 * allow-same-origin - it cannot read the dashboard's cookies, storage or
 * DOM, or call its API as the signed-in user. The only grants are popups, and
 * popups escaping the sandbox, so a link in the email opens in a new tab as
 * an ordinary page (the <base> added below sends every link there) instead of
 * inside the frame. No referrer goes with it.
 *
 * Mail clients do not run scripts either, so the preview shows what a
 * recipient sees.
 */

// Exactly what the frame may do. Never allow-scripts or allow-same-origin.
export const EMAIL_PREVIEW_SANDBOX: string =
  "allow-popups allow-popups-to-escape-sandbox";

/*
 * The document the frame shows: the email, with links opening in a new tab.
 * A <base> ahead of the email's own markup is moved into its head by the
 * parser; the email itself is left as it is.
 */
export const getEmailPreviewDocument: (html: string) => string = (
  html: string,
): string => {
  return `<base target="_blank">${html}`;
};

export interface ComponentProps {
  html: string;
  title: string;
  heightInPx?: number | undefined;
  dataTestId?: string | undefined;
}

const EmailPreviewFrame: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <iframe
      title={props.title}
      srcDoc={getEmailPreviewDocument(props.html)}
      sandbox={EMAIL_PREVIEW_SANDBOX}
      referrerPolicy="no-referrer"
      data-testid={props.dataTestId || "email-preview-frame"}
      className="w-full rounded-lg border border-gray-200 bg-white"
      style={{ height: `${props.heightInPx || 560}px` }}
    />
  );
};

export default EmailPreviewFrame;
