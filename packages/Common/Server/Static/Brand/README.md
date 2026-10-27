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
`packages/Common/Server/Utils/VendorAssets.ts`). Reference the files from a view by that
absolute path, or from server code via the `OneUptimeLogoUrl` constant -
`packages/Common/Tests/Server/Utils/OfflineAssetHygiene.test.ts` fails the build on a
`/oneuptime-assets/...` URL that does not resolve to a file on disk.

## Contents

| Path                       | Source                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `oneuptime-logo.svg`       | `packages/Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg`                      |
| `oneuptime-logo-dark.svg`  | `oneuptime-logo.svg` with its letters light (`#121212` to `#f8fafc`), for a dark page |
| `oneuptime-email-logo.png` | `packages/Common/UI/Images/logos/OneUptimePNG/1.png`, at 96 x 96 with rounded corners |
| `ou-wb.svg`, `hou-wb.svg`  | `packages/Home/Static/img/`                                                           |
| `favicons/`                | `packages/Home/Static/img/favicons/`                                                  |

`oneuptime-email-logo.png` is the logo in the header of every email that
shows OneUptime's branding. It is not fetched by address: the email carries
it as an inline image (`packages/Common/Server/Utils/Mail/EmailLogo.ts`), so
an email shows it on a network without the internet and asks no host for
anything when it is opened (issue #5124: it used to load from
res.cloudinary.com). It is 96 x 96 for a header that draws it at 32 x 32, a
PNG because many mail clients draw no SVG, and a few kilobytes because every
email carries it - `packages/Common/Tests/Server/Utils/Mail/EmailLogo.test.ts`
holds it to all three. Its corners are rounded in the image itself, so
Outlook, which ignores `border-radius`, draws it as every other client does.

`oneuptime-logo-dark.svg` is the wordmark on a page drawn in the dark theme
(`packages/Common/Server/Views/Partials/ProductLogo.ejs` shows one of the two,
by the theme `Partials/Theme.ejs` drew): the same file with its dark letters
recoloured, as the apps' `ProductLogo` recolours the wordmark in the browser.
`packages/Common/Tests/Server/Utils/VendorAssets.test.ts` holds it to exactly
that, so a rebrand that changes `oneuptime-logo.svg` fails until it is made
again.

`favicons/oneuptime-up-v1.svg` is the cache-versioned browser-tab icon shared
by the Dashboard, Admin Dashboard, and Home page. It keeps the white `Up.` mark
on its own dark background so the lettering remains visible in both light and
dark browser chrome.

`packages/Common/Tests/Server/Utils/VendorAssets.test.ts` asserts `oneuptime-logo.svg` is
byte-identical to the copies under `packages/Common/UI` and `packages/Home/Static`, so a rebrand
that updates one of them and not this one fails the build rather than leaving
the acknowledge page on the old mark.

Unlike the vendored libraries, these filenames carry no version, so they are
served with a one-hour revalidating cache rather than the year `Static/Vendor`
gets. A rebrand must not be stuck behind a year-old cache entry.
