# Saved funnels and retention tables, their dashboard widgets, and All cohorts (#6630, #6632)

How these were made: the real RUM application layout with the real **Funnels** and **User Retention**
pages, and the real **Funnel** and **User Retention** dashboard widgets, bundled with the Dashboard's
esbuild config and rendered in headless Chromium at 2x, with `Theme.css`, the Tailwind runtime and the
Inter font. The API is answered from memory: the product analytics read routes and the saved views'
list. They are not screenshots of a running stack; every name and number in them is made up.

- `1-all-cohorts.png`: the saved retention table **Weekly return visits** opened from the page's
  address. **All cohorts** sits over the cohorts: 4,935 people, and in each week the people who came
  back over the people of the cohorts that reached it. The empty cohort (Oct 7) is left out of it, and
  a week only the older cohorts reached is theirs alone.
- `2-saved-retention-tables.png`: **Saved retention tables**, open, with the open one checked and
  **Edit** and **Delete** on the row under the pointer, **Clear view** above and **+ Save retention
  table** below.
- `3-saved-funnel-open.png`: the saved funnel **Checkout** opened: its three steps and its time to
  finish, read with the page's own time range.
- `4-save-funnel-dialog.png`: **+ Save funnel** asks for a name, and says what is kept and that the
  time range is not.
- `5-widgets.png`: the two dashboard widgets, each titled by its saved view's name, with **Open in
  Funnels** and **Open in User Retention**. The widget reads the dashboard's time range.
- `6-all-cohorts-dark.png`, `7-widgets-dark.png`: dark mode.
- `8-all-cohorts-phone-390.png`, `9-all-cohorts-phone-390-dark.png`: a 390px phone. The table scrolls
  sideways under the cohort column, All cohorts included.
- `10-all-cohorts-fa.png`, `11-all-cohorts-fa-390.png`, `12-saved-funnels-menu-fa.png`: Persian,
  right to left, with Persian digits. A saved view's name is what the team typed, so it stays as
  written.
