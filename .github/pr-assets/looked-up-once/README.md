# Nav titles, the products menu and Admin detail cards, looked up once (#7790, #7791)

How these were made: the real Dashboard header and nav bar (the E2E header fixture's
`HeaderFixture`, which stacks `Components/Header/Header` and `Components/NavBar/NavBar` as
the MasterPage does) and the real Admin Dashboard page `Pages/Settings/Telegram/Index.tsx`,
bundled with Common's esbuild config. Each front end starts its own i18n
(`Dashboard/src/Utils/i18n.ts`, `AdminDashboard/src/Utils/i18n.ts`) with the reader's language
in `localStorage.oneuptimeLang`, as a reader who picked it has. The page is the Dashboard's
own: its Tailwind runtime, tailwind.config, Theme.css and Inter. Rendered in headless
Chromium at 1280px wide (390px for the phone), 2x. Only the network is stubbed: no hidden or
pinned products, no records, and Telegram with nothing set up. They are not screenshots of a
running stack. "Before" is `main` at 616649a6353, built the same way from a `git archive` of it.

## The Dashboard's nav: wrong words today

- `nav-spanish-before.png`: on Network's page, the breadcrumb's product reads **Rojo** (the
  colour): the Dashboard put "Network" in Spanish ("Red") and the nav bar looked "Red" up again.
- `nav-spanish.png`: after, **Red**.
- `nav-dutch-before.png` / `nav-dutch.png`: Home read **Starten** (the verb), now **Start**.
- `nav-italian-before.png` / `nav-italian.png`: Logs read **Registro**, now **Log**.
- `phone-menu-spanish-before.png` / `phone-menu-spanish.png`: the same on a phone: the
  current page's name over the menu read Rojo, now Red.

## The products menu's own words: no wrong word today

No language has a menu word that is also a key today, so the real Spanish menu looks the
same before and after. `?probe=menu` adds one: each of the menu's own words in Spanish is
also a key that reads "Rojo", as "Red" is.

- `products-menu-probe-before.png`: the Recent label, the footer's title and its description
  read Rojo: the menu looked the Dashboard's words up again.
- `products-menu-probe.png`: after, Visitado recientemente and the footer as the Dashboard
  words them.
- `products-menu-no-results-probe-before.png` / `products-menu-no-results-probe.png`: the
  same for the words shown when nothing matches.

## An Admin Dashboard detail card's words for an empty value

- `admin-telegram-spanish.png`: Settings > Telegram with nothing set up, in Spanish: No
  configurado. The same before and after: no Admin Dashboard word for an empty value is also
  a key today.
- `admin-telegram-probe-before.png`: `?probe=red` words "Not configured" as "Red", a word
  the Admin Dashboard's Spanish also has as a key ("Red" -> "Rojo"). The card looked the
  page's words up again: each empty field read Rojo.
- `admin-telegram-probe.png`: after, Red, as the page words it.

Measured, not only looked at: the harness counted the page's leaf texts on each shot.
Spanish Network: before 1 "Rojo" and no "Red", after 1 "Red" and no "Rojo". Dutch Home:
"Starten" before, "Start" after (also 2 and 2 in the phone menu). The menu probe: 4 "Rojo"
before, none after. The Telegram probe: 3 "Rojo" before, 3 "Red" after; the real Spanish
shows "No configurado" 3 times in both.
