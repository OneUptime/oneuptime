# UI polish: the Arabic Dashboard after #6633

How these were made: a local OneUptime (the App run natively behind nginx, with
Postgres, ClickHouse and Valkey) with a project seeded in Arabic and English: monitors
with long names in both, an open incident, a maintenance window two days ahead and a
public status page. The Dashboard and Admin Dashboard are this branch's own builds.
Each page was drawn in headless Chromium at twice its size, then halved and reduced
to a palette PNG.

- `1-monitors-ar-1280-light.png`: the monitor list in Arabic. The Monitor Type column
  says يدوي, not Manual. The English name is cut short at its own end. The long
  Arabic name breaks between words and ends in a whole "...".
- `2-monitors-ar-390-dark.png`: the same list on a phone, dark.
- `3-monitor-ar-1280-light.png` and `4-monitor-ar-1280-dark.png`: a monitor's
  Overview. The header's button reads اسأل الذكاء الاصطناعي. Refreshed at shows
  6:44 م. The open incidents tiles and the record's kind are Arabic. The record's
  facts read right to left: its kind, then the project's own severity and state as
  written (Major Incident, Identified), then its time.
- `5-monitor-de-1280-light.png`: the same page in German. The header reads KI fragen.
  The Uptime history card is still English in German, as in 14 other languages. Only
  Arabic and Japanese have translated it so far. #6071 already tracks it.
- `6-topology-ar-1280-light.png`: Topology. The Service Map tab reads خريطة الخدمات.
- `7-maintenance-ar-1280-light.png`: a maintenance window. Under Starts and Ends it
  reads خلال يومين, not "in 2 days".
- `8-admin-projects-ar-1280-light.png` and `9-admin-settings-de-1280-light.png`: the
  Admin Dashboard's header. Its page's section reads المشاريع and Einstellungen. It
  used to read Projects and Settings in every language.
