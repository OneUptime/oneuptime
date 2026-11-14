# Names drawn as written (issues #7780 and #7782)

Screenshots for the pull request that answers issues #7780 and #7782. They come
from the real incident page, as the `packages/E2E/EventOverview` fixture bundles
it, on a Spanish page (`?lang=es`) at 1280px. Chromium, device scale factor 2,
with the Inter font. "Before" is `main` at 74ea100ef7c; "after" is this branch.

Three of the fixture's records were renamed on their way to the page, so the
incident shows each kind of name the issues are about:

- its first state is named "Identified", as a new project's is. That name is
  OneUptime's, so it reads "Identificado" in Spanish, before and after;
- its acknowledged state is one the project named "Open". Spanish has a word
  for "Open", the verb "Abrir";
- its label "team:checkout" is one named "Network". Spanish has a word for it,
  "Red".

"Resolved" is OneUptime's name for the last state. It reads "Resuelto" before
and after.

- `incident-es-open-before.png`: the incident while it is Open. The label reads
  "Red", and the state badge and the state track read "Abrir".
- `incident-es-open-after.png`: the same incident on this branch. The label
  reads "Network", and the badge and the track read "Open". "Identificado" and
  "Resuelto" are still in Spanish.
- `incident-es-resolved-before.png` and `incident-es-resolved-after.png`: the
  incident once it is resolved. The badge reads "Resuelto" on both.
