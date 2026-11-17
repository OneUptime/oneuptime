# More monitor types folds again: before and after

Screenshots for the pull request "Create Monitor: More monitor types folds
again, and every show-more in the product says which way it is" (#5389,
issue #5364). They are drawn at 1x, with the Inter font, by:

- Create Monitor and Settings > Monitor Templates: the repository's offline
  browser fixture `packages/E2E/MonitorOverview` - the real Dashboard pages
  over fixture data, with Theme.css (`?monitorType=Kubernetes`,
  `?theme=dark`, `?lang=de|fa`).
- The replay card, the network device import's host groups, the facet
  sidebar's footer and the Hosts list's IP Addresses cell: a review harness
  that renders the real components with the data boundary replaced.

`*-master.png` is master before the pull request (a94f9f81b3), `*-after.png`
the branch as merged.

- `more-open-1280-master` / `more-open-1280-after`: More monitor types
  pressed. Master: the button is gone, and the other types stay open until
  the page is reloaded. After: More stays where it is, its chevron turned
  up, and a second press folds the other types away.
  `more-open-390-master` / `more-open-390-after`: the same on a phone.
  `more-open-dark-1280-after` and `more-open-fa-390-after`: dark mode, and
  Persian on a phone (More at the line's start).
- `change-kubernetes-1280-master` / `change-kubernetes-1280-after`: Change
  on a Kubernetes monitor. Master: every type open and no toggle at all.
  After: More is there, open.
- `change-kubernetes-folded-1280-after` (and `-dark-`): More folded after
  that Change. No row on screen is checked, so More's line names the
  choice, as the More fields line under it names what it holds: "More
  monitor types · Selected: Kubernetes". `more-folded-selection-de-390-after`:
  the same in German on a phone, the choice wrapped whole under the words.
- `template-change-kubernetes-1280-master` /
  `template-change-kubernetes-folded-1280-after`: a monitor template's
  Monitor Defaults step, the same picker in a dialog.
- `import-hosts-opened-1280-master` / `import-hosts-opened-1280-after`: a
  network device import stopped with 47 hosts not reached, "and 35 more"
  pressed. Master: the list stays open for good. After: Show fewer under
  the list folds it back.
- `replay-show-all-pressed-1280-master` / `replay-show-all-pressed-1280-after`:
  an exception's replay card with 12 other sessions, Show all 12 pressed.
  Master: the button is gone. After: Show fewer folds them back.
- `facets-hidden-footer-focus-after` and `host-ip-addresses-focus-after`:
  the facet sidebar's empty-filters toggle and the Hosts list's Show less,
  reached by keyboard: the product's focus ring, where the browser's outline
  sat tight on the words.
