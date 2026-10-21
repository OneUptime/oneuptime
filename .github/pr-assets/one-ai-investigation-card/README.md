# One AI Investigation card: the investigation and the conversation together

These images show the AI Investigation card on the incident overview page
(`packages/App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel.tsx` with
`InvestigationNotStarted.tsx`, `InvestigationNotice.tsx` and
`InvestigationConversation/*`). They were rendered by the offline Playwright fixture in
`packages/E2E/EventOverview/Fixture` at 1440px (the phone pair at 390px) and 1.5x, with the
browser clock pinned to 2026-09-14 18:20 UTC and production's Inter font loaded the way
`views/index.ejs` declares it (the fixture itself falls back to the system font). Every
incident, question, answer and name in them is fabricated for the fixture's "Acme Commerce"
workspace; no customer data appears.

Each `before-*` image is the fixture scenario rendered with master's components (a copy of
master with this branch's fixture laid over it, since master's fixture has no conversation
to show), each `after-*` image the same scenario with this branch's.

| Pair       | Scenario                                    | What changed                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`     | `?ai=none`                                  | Two cards (why nothing was investigated, then "Ask OneUptime AI" in a card of its own) are one. The conversation is the card's last section, its suggestions are plain chips that lead with "What is the root cause?", and the composer holds the mode and what it means.                                                                                |
| `thread`   | `?ai=none&thread=answered`                  | The same two cards with a thread in the second: it sat in a 40rem box that scrolled inside the card and cut the first answer off mid-way. It is part of the page now. Sources are a quiet list instead of bordered pills, and the action that ran is a line instead of a bordered row with a chip.                                                         |
| `running`  | `?ai=running&thread=working`                | With a run the conversation was in the card, behind an icon tile and a header of its own. It is drawn like the card's other rows. The steps of the answer being written hang from a rule instead of sitting in a gray box, and the status pill ends where the card's hairlines end.                                                                       |
| `crowded`  | `?thread=crowded` (the conversation only)   | Twelve messages from six people: the scroll box showed an arbitrary window of them. The thread opens on its last three exchanges with "Show 6 earlier messages" above them. The participants' initials are no longer covered by the next avatar, and the eighth avatar tone (lime, which had no dark-theme rule) is cyan.                                  |
| `error`    | `?thread=error` (the conversation only)     | A failed answer was a red box; it is a line with a red mark. The stopped answer's mark is a stop sign (a circle with a square in it), where the icon drew an empty ring.                                                                                                                                                                                  |
| `refused`  | `?fail=conversation-send`, after asking     | A refused question was a red alert box between the suggestions and the composer; it is the card's own notice, which can be dismissed.                                                                                                                                                                                                                     |
| `messages` | `?fail=verdict,create-fix-task`, after both | "Could not create the fix task" and "Could not save your verdict" were red alert boxes, the loudest things in the card. They are lines of their rows.                                                                                                                                                                                                     |
| `menu`     | `?ai=running`, the mode menu open           | The menu lined up on the picker's right edge, and the picker is the first thing under the composer, so it opened some 150px past the card's left edge, over the side menu. It opens from the picker's own left edge. Its Read-only option's eye has its pupil.                                                                                            |
| `phone`    | `?ai=none&thread=answered` at 390px         | Two cards, the status pill alone and centred under the title, a thread clipped inside its box with its sources squeezed and truncated beside the avatar column. One card, the pill under the title at its left edge (beside it when it fits), and each message's text at the card's full width under its author's mark.                                    |
| `dark`     | `?ai=none&theme=dark&thread=answered`       | The same card in the dark theme.                                                                                                                                                                                                                                                                                                                         |

Regenerate the fixture's own screenshots of the card with a conversation in it
(`ai-card-conversation-{answered,none-answered,working,approval,error,crowded,dark,mobile}`
and `ai-card-none-mobile`) with `cd packages/E2E && CI=1 npm run test-event-overview-ui`;
they land in `output/playwright/event-overview-ui/`. See
`packages/E2E/EventOverview/README.md` for the `?thread=` scenarios.
