# File custom fields - screenshots

Taken by the offline suite `packages/E2E/CustomFieldFiles` (`CI=1 npm run test-custom-field-files-ui` in `packages/E2E`), which draws the production pages: an incident's Custom Fields page with a "Signed change request" File field and an "Evidence" Multiple files field, and the public form page with a File and a Multiple Files question.

| Shot | What it shows |
| --- | --- |
| `card-1280.png`, `card-390.png` | The Custom Fields card: each file by name and size, a download |
| `card-long-390.png` | Long file names, wrapped whole on a phone |
| `card-dark-1280.png`, `card-fa-1280.png` | Dark mode; Persian, right to left |
| `dialog-1280.png` | Edit Fields: a File field holding its file (Replace, Remove), a Multiple files field with room for more |
| `dialog-uploading-1280.png` | A file uploading, with its progress |
| `dialog-full-1280.png` | A full Multiple files field |
| `dialog-long-390.png` | Long names on a phone: the buttons move under the name |
| `dialog-dark-1280.png`, `dialog-de-1280.png` | Dark mode; German |
| `form-chosen-1280.png` | A public form with files chosen, kept in the browser |
| `form-sending-1280.png` | The submission sending its files, with its progress |
| `form-390.png`, `form-fa-1280.png` | A phone; Persian |

The shots above were retaken after the UI review. `ui-review/` holds its
before and after pairs: `*-before.png` is the page as the branch first drew
it, `*-after.png` the reviewed one. The dialog, full field and form pairs are
the suite's own shots; the empty dialog, the failed upload and the empty card
come from the same fixture served by hand; the submission's answers and the
Declare Incident review step from a harness that renders the production
`FormSubmissionAnswersList` and a stepped form of the real custom field inputs.

| Pair | What changed |
| --- | --- |
| `dialog-*` | Each file with its kind's icon and its size (a stored file's too); no "Uploaded files" heading over a File field's one file; a smaller zone to add more |
| `dialog-empty-*` | A File field says "Click to choose a file"; a click anywhere on the zone opens the chooser |
| `dialog-full-*` | A full field is a note, not a dashed drop zone; rows 8px apart |
| `upload-failed-*` | The server's refusal said once, in the upload's own row, with no red progress bar |
| `card-empty-*` | An empty file field reads as the empty text field beside it |
| `form-*` | The public form: the File question's file alone, sizes in bytes ("70 B", never "0.1 KB") |
| `answers-*` | A submission's file answers listed as files, with their sizes, not as names run together |
| `review-step-*` | Declare Incident's review step: each file with its size |
