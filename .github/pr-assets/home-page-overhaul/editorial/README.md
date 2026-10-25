# Homepage editorial overhaul

The homepage now reads as one editorial page instead of a stack of rounded cards. The
type is a serif display face, the eyebrows are numbered in mono, the palette is paper
and ink with the logo green used sparingly, and the product is shown in dense,
real-DOM mocks rather than generic screenshots.

The before screenshots are the existing `before-*` files in the parent folder. The
screenshots here are the after state, rendered from the templates with compiled Tailwind
3.4.5 at a 1x pixel ratio. Animations were paused and webfonts were allowed to load
before capture.

## Screenshots

Desktop is 1440×1000; phone is 390×844.

| Section | Desktop | Phone |
| --- | --- | --- |
| Full page | `desktop-full.png` | `mobile-full.png` |
| Hero | `desktop-hero.png` | `mobile-hero.png` |
| Platform | `desktop-platform.png` | `mobile-platform.png` |
| How it works | `desktop-how-it-works.png` | `mobile-how-it-works.png` |
| AI investigation | `desktop-ai.png` | `mobile-ai.png` |
| Product index | `desktop-products.png` | `mobile-products.png` |
| Open source | `desktop-own-it.png` | `mobile-own-it.png` |
| Air-gapped | `desktop-air-gapped.png` | `mobile-air-gapped.png` |
| Reviews | `desktop-reviews.png` | `mobile-reviews.png` |
| FAQ | `desktop-faq.png` | `mobile-faq.png` |

## Measured at those viewports

- Desktop page height is 11,682 px; the hero is 1,438 px.
- Phone page height is 18,603 px; the hero is 1,910 px.
- Neither viewport has page-level horizontal overflow. The customer logo marquee and the
  deliberately cropped platform mock are the only elements that extend beyond it.
- The H1 is 120 px / 108 px line-height on desktop and 44 px / 39.6 px on phone, in the
  site's serif fallback stack.

## Checks

- `Tests/TailwindBuild.test.ts`: 59 passed. Every class emitted on the page has its rule
  in the built stylesheet, in the same order.
- `Tests/ForeignHiddenRule.test.ts`: 43 passed. The new responsive hides use the
  `max-*:hidden` + breakpoint display idiom, so a foreign `.hidden` rule cannot win.
- Full Home suite: 5,021 tests passed across 78 suites. The three suites that did not run
  (`AirGappedDiscovery`, `Routes`, `Sitemap`) fail to load because the installed
  `isolated-vm` has no native build for Node 22; that is an environment failure, not a
  test assertion.

The hidden terminal "builder tribute" interaction was removed from the open-source
section along with the old terminal-window chrome. Copying the install command still
works.
