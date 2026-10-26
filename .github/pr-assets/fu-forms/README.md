# fu-forms screenshots

Before and after shots for the "Follow-ups: Forms" pull request. Each pair is
the same scene drawn by master (`-before`) and by the branch (`-after`), at
2x.

They were taken from an esbuild harness that mounts the real Dashboard and
Admin Dashboard components (the project picker's Create New Project dialog,
BasicFormModal with the real field builders, the Admin Projects page) with
the network answered in the page, and from the MonitorOverview offline
fixture (`packages/E2E/MonitorOverview`) for the monitor criteria editor,
with Inter loaded as production loads it. The data is synthetic.

| Pair | What it shows |
| --- | --- |
| `create-project-plan-first` | Picking a plan before typing a name: "Project Name is required." no longer shows |
| `create-project-promo-refused` | A refused promo code is said under the code, with More fields opened and the code focused |
| `create-project-promo-refused-390` | The same on a phone: the dialog scrolls to the code |
| `first-error-focus-390` | Create pressed at the bottom of a long dialog: the first field in error is brought into view, with room from the header, and takes the focus |
| `monitor-criteria-alert-390` | The criteria editor's actions on a phone: wider fields, no "(Optional)" on the status it changes to or on the alert's heading |
| `criteria-description-editor-390` | The alert description's editor on a phone: Insert variable keeps its { } instead of being cut off, and the Template variables box holds its chevron |
| `optional-titles-de` | A title that says "(optional)" itself gets one mark, not two (German) |
| `optional-titles-fr` | The same in French: every optional field shows the same mark, "(Optionnel)" |
| `incident-state-form-de` | Create Incident State: Name and Description help in the page's own words (German) |
| `admin-create-project-required-de` | Admin Dashboard: "Projektname ist erforderlich." instead of English |
| `more-fields-opened-390` | Opening More fields at the bottom of a dialog brings its fields into view |
