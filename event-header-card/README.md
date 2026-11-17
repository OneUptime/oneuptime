# Event header screenshots

Screenshots for PR #5251, the one header of incidents, alerts, episodes and
scheduled maintenance events.

- `before-*` and `after-*`: master's header and the new one, from the offline
  fixture in `packages/E2E/EventOverview`.
- `review-before-*` and `review-after-*`: the UI review. "Before" is the
  header as the PR first built it, "after" is the header once reviewed. Both
  are drawn by the same fixture, with production's Inter font, at the width
  in the file name.
  - `facts-row-390`: the facts of a row start on one line where a label
    wraps.
  - `owners-1024`: owners one a line, ending with Add.
  - `maintenance-overdue-390`: a maintenance event's facts and its amber band
    on a phone.
  - `locked-1280`: a locked state button's reason.
  - `episode-refresh-error-1280` and `placeholder-390`: drawn by a small
    harness around the same components (`EventStatusPanel` with
    `EpisodeHeaderRefreshError`, and `EventHeaderSkeleton`), because the
    fixture does not fail an episode's refresh or hold its placeholder. Their
    "before" already has the review's thinner state track and fact rows: what
    they compare is the red band, and where the placeholder draws its
    buttons on a phone.
