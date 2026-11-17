# Discovery scan "Show details" / "Hide details" (issue #3842)

These screenshots come from the Discovery page fixture (`packages/E2E/Discovery`). It
renders the real page with synthetic scans.

## Before

The reporter's scan summary fits in the two-line preview. "Show details" and
"Hide details" both showed the whole sentence. Clicking only moved the link
above the text.

![Before: collapsed](./before-fits-collapsed.png)

![Before: expanded, with the same text](./before-fits-expanded.png)

## After

A message that fits in the preview is shown in full, with no toggle.

![After: a message that fits has no toggle](./after-fits.png)

A longer message shows a two-line preview and "Show details".

![After: a long message, collapsed](./after-long-collapsed.png)

"Show details" shows the whole message. "Hide details" sits under it.

![After: a long message, expanded](./after-long-expanded.png)

On a phone, the preview is measured at the card's width.

![After: phone width](./after-mobile.png)
