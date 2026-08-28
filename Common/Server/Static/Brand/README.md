# OneUptime brand images for server-rendered pages

The logo and icons that the pages rendered out of the **App** container need -
the on-call acknowledge page, the already-acknowledged page and the SSO message
page.

These are OneUptime's own images, not third-party assets, so they do not belong
in `../Vendor`. They are here for the same reason that directory exists: a view
must not reference a path the service rendering it does not serve.

`/img/...` is served by the **Home** container. nginx routes `/` to **App** on
every install with billing off - which is every self-hosted install - so
`<img src="/img/3-transparent.svg">` on the acknowledge page 404'd and the
browser drew a broken image. See
https://github.com/OneUptime/oneuptime/issues/3457.

Every service mounts this directory read-only at `/oneuptime-assets/brand` (see
`Common/Server/Utils/VendorAssets.ts`). Reference the files from a view by that
absolute path, or from server code via the `OneUptimeLogoUrl` constant -
`Common/Tests/Server/Utils/OfflineAssetHygiene.test.ts` fails the build on a
`/oneuptime-assets/...` URL that does not resolve to a file on disk.

## Contents

| Path                          | Source                                              |
| ----------------------------- | --------------------------------------------------- |
| `oneuptime-logo.svg`          | `Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg` |
| `ou-wb.svg`, `hou-wb.svg`     | `Home/Static/img/`                                  |
| `favicons/`                   | `Home/Static/img/favicons/`                         |

`Common/Tests/Server/Utils/VendorAssets.test.ts` asserts `oneuptime-logo.svg` is
byte-identical to the copies under `Common/UI` and `Home/Static`, so a rebrand
that updates one of them and not this one fails the build rather than leaving
the acknowledge page on the old mark.

Unlike the vendored libraries, these filenames carry no version, so they are
served with a one-hour revalidating cache rather than the year `Static/Vendor`
gets. A rebrand must not be stuck behind a year-old cache entry.
