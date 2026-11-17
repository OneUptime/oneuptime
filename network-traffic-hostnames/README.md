# Names instead of bare addresses on Network > Traffic: screenshots

Before/after pairs for #5340 (names instead of bare IP addresses on the Traffic pages) and its UI review.

- **Pages**: drawn by the Network Traffic Names offline fixture (`packages/E2E/NetworkTrafficNames/Fixture`)
  in headless Chromium with Inter loaded: the real Network layout, Traffic page and Address Names page,
  with only the data boundary replaced. 1280px wide unless the name says otherwise (`phone` is 390px,
  `768` and `1024` are beside the side menu). `names=long` is the fixture's longest-names scenario,
  `lang=fa` Persian, `lang=de` German, `theme=dark` the dark theme, `exporters=unknown` two devices that
  send flows and are no device yet.
- **Before, for the feature** (`top-lists`, `conversations-*`, `one-address`, `find`): master at
  4120b48511, drawn by the same fixture without the Address Names page master does not have. Every
  address is bare, and find takes an address only.
- **Before, for the UI review** (`*-review-before`): the builder's branch at b50b9c24eb; after is the
  reviewed branch. `conversations-phone-after` is also the phone list's review "after".
- **After only**: the Address Names page, the address card's other kinds (DNS name, no name, Address
  Name), the senders that are no device yet, dark and German.

Each image is cropped to the card, list, dialog or window it shows.
