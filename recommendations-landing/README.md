# A link that ticks recommendations lands on them

How these were made: the offline browser fixtures of the KubernetesEvents and VMwareHostPage suites
(the production cluster and vCenter layouts, side menus, Events page, ESXi host page and
Recommendations page, bundled with the dashboards' own esbuild config, Tailwind runtime, theme and
the Inter font), driven in headless Chromium (Firefox where named) at 2x, following each page's own
link. `before-warning-events-*` is master's landing code (one scroll, at the moment the list was
drawn) in the same fixture; the other `before-*` shots are this pull request's head before its UI
review. They are not screenshots of a running stack. Every name in them is made up.

- `before-warning-events-1280.png`: "Turn on warning alerts" on a cluster's Events page opened its
  Recommendations scrolled once, before the page was laid out: Warning Events, the ticked card and
  the last one on the list, ended under the bottom edge.
- `after-warning-events-1280.png` and `after-warning-events-390-dark.png`: it is kept in view
  while the page settles, at the end of the list above the selection bar.
- `after-host-alerts-1280.png` and `after-host-alerts-390.png`: an ESXi host's "Turn on 4 alerts"
  lands with the first ticked card in the middle of the window, the other three beside or under it.
- `before-keyboard-tab-firefox.png`: followed with the keyboard, the link left the focus nowhere;
  in Firefox the first Tab went to "Create 4 Selected" at the top of the page and scrolled there,
  away from the ticked cards.
- `before-keyboard-tab-chromium.png`: in Chromium that Tab reached the first ticked card, but its
  focus ring was drawn outside the card, which clips it: nothing showed.
- `after-keyboard-landed.png`: the first ticked card now holds the focus as the page opens, ringed
  inside its edge after the keyboard (no ring after a mouse click).
- `after-keyboard-tab.png` and `after-keyboard-tab-dark.png`: Tab goes on to its select button,
  pressed, with its ring drawn inside the card.
- `before-unticked-focus.png`, `after-unticked-focus.png` and `after-unticked-focus-dark.png`: an
  unticked card that Tab reached, before and after.
