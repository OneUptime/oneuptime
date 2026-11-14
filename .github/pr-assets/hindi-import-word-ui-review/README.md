# Hindi import screens: UI review

How these were made: the real components (`ImportModelsModal` with `CodeEditor`,
`ImportLabelRulesModal`, `CSVFileUpload`, the Dashboard's `AutoImportRules` page and
`RunAutoImportRuleModal`), bundled with esbuild and drawn in headless Chromium with the real
locale files, at 1280 px and at 390 px, light and dark. Only the API is stood in for: three auto
import rules (two import rules, one exclusion rule), a label rule export of three rules (one that
fails on import), and a small sites CSV. Devanagari is drawn with the machine's FreeSans, as no
Devanagari webfont ships; production uses the reader's system font.

"Before" is the branch as it was built (every import word already आयात); "after" is the branch
after the review, merged with main.

- `auto-rules-before.png`, `auto-rules-after.png`: Network > Settings > Auto Import Rules. The
  rule-type pill drew the Import button's key, so an import rule read आयात करें ("do import") and
  an exclusion rule read Exclusion in English; the Dry Run button was English. Now the pill
  names the kind of rule, आयात नियम / बहिष्करण नियम, and the button reads ड्राई रन.
- `auto-rules-de-after.png`: the same page in German: Importregel / Ausschlussregel (it read
  Importieren, a verb, before). `auto-rules-fa-phone-after.png`: Persian at 390 px,
  قاعده درون‌ریزی / قاعده مستثنی‌سازی. `auto-rules-phone-dark-after.png`: Hindi at 390 px, dark.
- `auto-rule-form-after.png`: the create form's first step, with its steps (मूल जानकारी,
  मिलान मानदंड, व्यवहार, मॉनिटर) and the switch's help, all Hindi.
- `dry-run-before.png`, `dry-run-after.png`: the Dry Run dialog. Its title, sentence and Start
  Dry Run button were English; now "Import core switches" का ड्राई रन, ड्राई रन शुरू करें.
- `label-rules-upload-before.png`, `label-rules-upload-after.png`: the label rule import's
  first step. Its description, file label, JSON help link and Validate and preview button were
  English.
- `label-rules-preview-before.png`, `label-rules-preview-after.png`: its preview. The
  validated line, the mapped conditions heading, Labels to add, View conditions and actions,
  the paging line and Edit JSON were English. `label-rules-preview-phone-after.png`: 390 px.
- `csv-upload-before.png`, `csv-upload-after.png`: the CSV upload of the site import. Expected
  columns, Click to upload CSV, or drag and drop, CSV files only and the preview line were
  English.
- `json-import-before.png`, `json-import-after.png`: a table's Import JSON dialog. The code
  editor's status line (Nothing entered yet., Ln 1, Col 1) was English, and the description said
  पेस्ट करें where the label beside it says चिपकाएँ.

Left as they are (follow-ups filed): the Match Criteria summary ("IP Address is in ...") is built
in English in every language; the browser's own file input (Choose File, No file chosen) follows
the browser's language.
