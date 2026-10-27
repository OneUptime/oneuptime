# The homepage hero answers the pointer: UI review

How these were made: the homepage rendered from this branch's templates with the locals `Routes.ts`
hands `/` (the test helper `renderMarketingPage`), served locally with Home's static files and the
Tailwind runtime the pages load without a build, and captured in headless Chromium at 1440x900 and
1920x900, 2x pixel density. Playwright places the pointer. `pointer-light.gif` runs on Playwright's
fake clock, 50 ms a frame at 1x, so the light moves as it does in a browser whatever the machine's
load; its fade is left out there, because the fake clock does not drive CSS transitions.
`before-hero-laptop.png` is master as it was (a5c58294cb). The rest are this branch.

- `before-hero-laptop.png`: the hero at rest on master. At rest it looks the same on this branch,
  but for the ring rippling out of the incident banner's disc.
- `after-pointer-headline-laptop.png`: the pointer over "AI-native": a fine grid of dots shows in a
  soft circle around it, behind the words.
- `after-pointer-margin-laptop.png`: the pointer in the margin beside the product: the dots run on
  from the white into the grey stage, and stop at the window, which stands over them.
- `after-pointer-wide.png`: 1920px, the pointer in the wide right margin.
- `after-pointer-buttons.png`: the pointer on Book a demo (2x crop): its hover background and its
  darker ring, with the dots around it.
- `after-incident-ripple.png`: the incident banner's disc a third of the way through its ripple, as
  the real Home page draws it while an incident is open (2x crop).
- `pointer-light.gif`: the pointer drifting in from the left, over the headline, to the buttons and
  past the window's corner; the light follows a beat behind and settles under it.

Phones and tablets draw no dots (their incident disc still ripples), and visitors who ask for less
motion see the hero exactly as on master: no dots, and a still disc.
