# Three layout fixes (#7087, #7103, #7111)

Each screenshot was taken in headless Chromium with the product's fonts (Inter, and Vazirmatn for Arabic letters).
The "before" shots come from the same page built with main's component in place of this branch's.

## Status page resource grid (#7087)

A small esbuild page draws the real `ResourceGrid` with the Dashboard's `StatusPageResourceName`, framed as
Status Page > Resources frames it at 390 pixels: the page's padding, the Resources card whose body runs to its
edges, and the detail pane's padding (a 316px grid). It has three columns, two rows, long English monitor names and
two resources whose axis values are off the grid.

- `grid-en-390-before.png`: the grid is 694px wide in 316px. It scrolls 378px sideways, and each chip's name has
  56px ("oneupti...").
- `grid-en-390-after.png`: below 30rem of its own width the grid is a stack: each row is a box headed by its value,
  and each cell sits under its column's name. Nothing scrolls, and each name has 162px.
- `grid-en-390-touch-after.png`: the same page on a touch device (hover: none). Each chip draws its Edit and ⋯
  buttons, as a list's row does.
- `grid-en-390-dark-after.png`: the stack in the dark theme.
- `grid-ar-390-off-grid-before.png`: on an Arabic page, the off-grid line "Region: Asia Pacific · Service: Search"
  was cut at its start ("...acific · Service: Search").
- `grid-ar-390-off-grid-after.png`: the line reads left to right from its own start and ends in "..." at its own
  end.

At 1280 pixels (a 536px grid) the English page's screenshot is byte-identical to main's.

## Infrastructure list (#7103)

These come from the Topology offline fixture (`packages/E2E/Topology`, `?lang=`), with the self-hosted estate's
oneuptime-app group open and inactive resources shown.

- `infrastructure-ru-1280-before.png` and `infrastructure-ru-1280-after.png`: the Russian list was 622px in its
  608px pane and scrolled 14px. Each row's chevron was cut at the pane's edge. Now it is 608px and fits.
- `infrastructure-en-1024-before.png` and `infrastructure-en-1024-after.png`: beside a 1024-pixel window's side
  menu, the tree left the list a 352px pane, which scrolled 217px. Now the tree sits over the list, and the list
  has the card's whole width (640px).

## AI rules table (#7111)

- `ai-rules-ru-1280-narrowest-after.png`: the Incidents AI rules card in Russian at 1280 pixels, with the
  "Investigates and fixes" column made as narrow as its edge allows (Home on its separator, 184px). Each fix pill
  wraps between its words, never inside one.
