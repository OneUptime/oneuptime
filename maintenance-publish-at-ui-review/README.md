# Publishing scheduled maintenance at a chosen time (#5249): UI review

How these were made: the real Dashboard pages, bundled with the Dashboard's own esbuild config,
its Tailwind runtime and the Inter font, and rendered in headless Chromium with the model APIs
answered from memory. The event's page comes from the repository's offline Event Overview fixture
(`packages/E2E/EventOverview`, `?publish=later`, clock pinned to 14 September 2026, 18:20 UTC);
the Create form from a review harness that draws `Pages/ScheduledMaintenanceEvents/Create.tsx`
the same way. `before-*` is the branch as its builder left it (27628f0fd5). They are not
screenshots of a running stack, and every name in them is made up.

- `before-band-1280.png` / `after-band-1280.png`: the header's band while the event waits for its
  publish time. Beside the words, Publish Now's label now sits level with "Not on status pages
  yet" (it was 5px lower), and it is an outline button sized to its label.
- `before-band-768.png` / `after-band-768.png`: beside the side menu at 768px the header is
  narrow. Before, Publish Now wrapped to the start of the next line, 12px in from it (a dialog
  footer's margin). After, it takes the line under the words, at the band's end, where the wide
  header has it.
- `before-band-390.png` / `after-band-390.png`: a phone. Before, a full-width button and the date
  split over two lines ("Sep / 14 2026"); after, a button sized to its label at the band's end,
  and the date kept whole.
- `before-create-publish-later.png` / `after-create-publish-later.png`: Create Scheduled
  Maintenance Event, Subscriber Notifications open, At a date and time picked. At a date and time
  says "It stays off its status pages until then, and their subscribers hear nothing about it."
  (was "Until then it is on no status page, and their subscribers hear nothing of it.").
  When the event is scheduled says "Sent when the event shows on its status pages." - the time
  picked just above it - instead of the column's "Should subscribers be notified about this event
  creation?"; the start and end boxes drop "...about this event event is changed to ongoing?".
- `before-create-publish-later-de.png` / `after-create-publish-later-de.png`: the same in German,
  where those three lines were English.
- `before-edit-status-pages.png` / `after-edit-status-pages.png`: the event's Edit, step Status
  Pages, Right away picked (before) and At a date and time with its time (after).
- `before-details-reminders.png` / `after-details-reminders.png`: Maintenance Details. The next
  reminder (19:20) comes before the publish time (19:30), so it will not be sent; the card now
  says "Reminders due before the event is published are not sent." (and, for an event hidden from
  its status pages, "Reminders are not sent while the event is hidden from its status pages.").
- `after-publish-now-refused.png`: Publish Now refused by the server (`?fail=publish`): the dialog
  stays open with the reason, and the event keeps waiting.
