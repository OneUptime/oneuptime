# Confirming an Amazon SNS or Azure Event Grid subscription: screenshots

Screenshots for #7723. Every value in them is synthetic: the topic ARN uses
AWS's documentation account (`123456789012`), and the Event Grid topic a
placeholder subscription. What is drawn is the real `Summary` component (the
monitor overview's **Monitor Summary** card) with an Incoming Request
monitor's latest request, rendered by React Testing Library and laid out in
Chromium with the Dashboard's own Tailwind runtime
(`Common/Server/Static/Vendor/tailwind/tailwind-3.4.5.js`, the Dashboard's
`tailwind.config`) and theme stylesheet (`Common/UI/Styles/Theme.css`), in
the system font rather than Inter.

| File | What it shows |
| --- | --- |
| `sns-confirm-light.jpg` | An Amazon SNS `SubscriptionConfirmation` sent a minute ago: what SNS is waiting for, the topic, **Confirm Subscription**, until when the link works, and that the note stays until the next request. |
| `event-grid-light.jpg` | An Azure Event Grid `SubscriptionValidationEvent`: **Validate Subscription**, the link's 10 minutes, a long topic broken at its separators. |
| `sns-expired-light.jpg` | An SNS confirmation older than two days: no button, what to do instead. |
| `sns-confirm-dark.jpg` | The dark theme. |
| `sns-confirm-375.jpg` | A phone, 375 pixels wide. |
