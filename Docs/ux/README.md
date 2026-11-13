# The OneUptime UX rulebook

How to build a page that people understand the first time they see it. Read it before you build or
change anything a person sees: a page, a form, a dialog, a menu, a sentence. It takes about fifteen
minutes.

Most rules here are enforced by a test, and each rule ends with that test: **Enforced by** a link to
it, or **Not enforced: use judgement** when no test can check it. The test's header says why the rule
exists, what it reads and how to list an exception with its reason. Read the header before you list
one. Every guard named here starts with a line pointing back to its section:

```ts
// UX rule: Docs/ux/README.md#steps
```

[UxRulebookInStep](../../packages/Common/Tests/App/UxRulebookInStep.test.ts) keeps this guide and the
guards in step. It fails when a guard named here is missing, when a guard points to a section that
does not name it, and when a guard in a UX test folder belongs to no rule. [Adding a rule or a
guard](#adding-a-rule-or-a-guard) says what to do when it fails.

The mobile app has its own guide: [`packages/MobileApp/docs/DESIGN_SYSTEM.md`](../../packages/MobileApp/docs/DESIGN_SYSTEM.md).

## Principles

These come from the epic that set out to make OneUptime easy to use (#6802). The rules after them are
how they are kept, and they are the test for anything new, including a new rule.

1. **Outcome before object.** A flow ends when the thing works and has been tested, not when a record
   exists. A monitor's setup ends with a check that ran, not with a saved form.
2. **One obvious next step.** At any point in the first hour, the product says what comes next. An
   empty list offers its Create button. It does not offer Refresh.
3. **Show the chain.** Where a result depends on several records, show them connected, and name the
   break: "this policy pages nobody until a rule triggers it".
4. **Fit the product to the project.** Show what a project uses, and keep the rest one click away. A
   side menu lists Slack only when the project has connected Slack.
5. **One name per thing**, explained where it is used. One thing is not called "On-Call Duty",
   "On-Call" and "On Call" on three pages.
6. **Help where the person is.** Docs, guides, the importer and checklists appear when they are needed,
   on the page where they are needed, not three menus away.
7. **Measure.** Every flow records where people start, stop and finish, and the core jobs have budgets
   that a test enforces.
8. **Nothing to relearn.** Pages, addresses and APIs people use today keep working, and a renamed thing
   is still found by its old name.

The way to apply all eight is the line in `AGENTS.md`: show what most people need first, with sensible
defaults, and fold advanced settings away so nobody faces choice paralysis.

## The skeleton of a product

Every product (Monitors, Incidents, Status Pages, Logs and the rest) has the same shape, so a person who
learned one can find their way around the next.

### A product's first page

- **A product explains itself.** Its first page says what it does, its first steps, an example and its
  docs, behind "How it works" once the product is in use. A product added to the products menu needs
  its explanation in `Components/ProductOnboarding`. Enforced by
  [ProductOnboardingRegistry](../../packages/Common/Tests/App/Dashboard/ProductOnboardingRegistry.test.ts).
- **A new project is told what is not set up, never that all is well.** With no monitors, Home says
  "No monitors yet" and opens the Monitors list. It does not say "Inoperational monitors 0 · All
  operational". Not enforced: use judgement.
- **Do not ask for what is already done.** "Send your first logs" never sits above a page of logs, and
  there is one button for one job on a page, not the explanation's and the empty state's for the same
  setup. Not enforced: use judgement.
- **A job that crosses products is a guided setup, on one page.** "Know when my website is down" needs a
  monitor, who is told and a test page; three products would leave the person to find the chain. A
  guided setup draws its steps in `Components/GuidedSetup/GuidedSetupFrame`: each step saves real
  records, coming back opens the first step not done, and it ends with a summary read from the
  records and what to do next (`/monitors/setup`, #6804; `/on-call-duty/setup`, #6805). Its journey gets a budget of its own, with
  `"path": "guided"`. Enforced by
  [GuidedSetupFrame](../../packages/Common/Tests/App/Dashboard/GuidedSetupFrame.test.tsx).

### Side menus

A product's side menu lists its daily pages first, then Rules, Settings, Advanced and Developer. Each
product's own menu suite in `packages/Common/Tests/App/Dashboard` (`IncidentsSideMenu`,
`NetworkSideMenu`, `CloudSideMenus` and the other `*SideMenu*` suites) pins its order, counts, icons
and phone summary: change the suite in the same pull request as the menu.

- **Everyday sections start open; the rest start folded.** Settings, Rules, Workspace, AI, Logs,
  Advanced and Developer start collapsed, and open by themselves on their own pages, so folding never
  hides where the person is. A new section is a decision: it holds what people open the menu for, or
  it folds away. Enforced by
  [RarelyUsedMenuSectionsCollapsed](../../packages/Common/Tests/App/RarelyUsedMenuSectionsCollapsed.test.tsx)
  and
  [AdvancedMenuSectionsCollapsed](../../packages/Common/Tests/App/AdvancedMenuSectionsCollapsed.test.tsx).
- **A menu shows what the project uses.** Slack, Microsoft Teams and Mattermost entries come from
  `useWorkspaceSideMenuSection`, which lists only the workspaces the project has connected. Enforced by
  [WorkspaceConnectionsGuards](../../packages/Common/Tests/App/Dashboard/WorkspaceConnectionsGuards.test.ts).
- **One kind of record is one page.** Kinds of the same thing are tabs on that page, not a page each:
  How to Reach Me is one page, a ladder with a tab per kind behind it, not four pages in two menu
  sections. Enforced by
  [OnCallRulesOnePageGuard](../../packages/App/Tests/Dashboard/OnCallRulesOnePageGuard.test.ts).
- **Every entry in the More menu has an icon.** Enforced by
  [MoreMenuItemIconsGuard](../../packages/App/Tests/MoreMenuItemIconsGuard.test.ts).

### Finding a page

- **Every page has a breadcrumb trail.** The trail says where a page is and is the way back up. A new
  routed page gets one. Enforced by
  [EveryPageHasATrail](../../packages/Common/Tests/App/Dashboard/EveryPageHasATrail.test.tsx).
- **Search (Cmd/Ctrl+K) finds every page a menu links to,** by the menu's name for it, and says where
  it lives the way the menu does. Add a new page to `PageSearchIndex.ts`. Enforced by
  [PageSearchIndexCoversMenus](../../packages/Common/Tests/App/Dashboard/PageSearchIndexCoversMenus.test.tsx).
- **A setting is found by the name on its card.** Searching "require sso for login" finds that switch
  on the SSO page. Add a new settings card or switch to its page's settings list in
  `PageSearchIndex.ts`, or to `NOT_A_SETTING`. Enforced by
  [SettingsFoundByName](../../packages/App/Tests/Dashboard/SettingsFoundByName.test.ts).

### A record's overview

A record's overview answers "what is this, and is it all right?" first. What it is connected to comes
next, and how to change it last.

- **The hero is laid out one way.** Every resource's Overview opens with its icon, name and badges,
  when it was last seen, and the page's controls in one top row (`ResourceHeroLayout`). Enforced by
  [ResourceHeroLayoutGuard](../../packages/App/Tests/Dashboard/ResourceHeroLayoutGuard.test.ts).
- **Raw IDs go in a small copy line, not the grid.** A record's own ID and when it was created sit in
  one "ID" line under the other fields, with a copy button. Enforced by
  [RecordIdLineGuard](../../packages/App/Tests/RecordIdLineGuard.test.ts).
- **A record's details are edited in one place.** Enforced by
  [ResourceDetailsOnePlaceGuard](../../packages/Common/Tests/UI/Components/Forms/ResourceDetailsOnePlaceGuard.test.ts).
- **An Edit button opens something to edit.** A card that says it is editable hands its dialog the
  fields, so Edit never opens an empty dialog. Enforced by
  [EditableCardsHaveFormFieldsGuard](../../packages/App/Tests/Dashboard/EditableCardsHaveFormFieldsGuard.test.ts).
- **What is created from a record keeps the record.** A monitor's Declare Incident starts with that
  monitor filled in. Enforced by
  [CreateFromRecordGuard](../../packages/App/Tests/Dashboard/CreateFromRecordGuard.test.ts).
- **One composer for notes.** Adding a note from an event's overview uses the same composer as its
  Notes page. Enforced by
  [FeedNotesUseNotesComposerGuard](../../packages/App/Tests/Dashboard/FeedNotesUseNotesComposerGuard.test.ts).
- **An outdated agent says so where its version is shown,** with how to upgrade it one click away.
  Enforced by
  [AgentVersionDisplayGuard](../../packages/App/Tests/Dashboard/AgentVersionDisplayGuard.test.ts).

### Settings and danger

- **Advanced settings fold under More settings.** A card goes there when it is a setting, it is
  optional (the page works fully without it) and it is advanced: an Enterprise extra, an override of a
  project default, your own infrastructure (a mail server, a Twilio account) or an access limit. It
  stays out when it is the page's main job, something people use often, a destructive or emergency
  action, or the page's only card. Not enforced: use judgement.
- **A fold names what it holds, and a link reaches inside it.** The folded header lists every card in
  it, with the set ones as chips ("Custom Roles: 2"), and a link to a card (`#custom-roles`) opens the
  fold at that card. Enforced by
  [MoreSettingsFoldsGuard](../../packages/Common/Tests/App/Dashboard/MoreSettingsFoldsGuard.test.ts).
- **A setting that is a switch saves when it is flipped.** A card whose Edit dialog held only switches
  becomes the switches themselves, which save and say "Saved". Enforced by
  [OneSwitchCardsGuard](../../packages/Common/Tests/UI/Components/Forms/OneSwitchCardsGuard.test.ts)
  and [SwitchCardsGuard](../../packages/Common/Tests/UI/Components/Forms/SwitchCardsGuard.test.ts).
- **States, severities and monitor statuses are set on one kind of page,** listed in the order they
  are used (an incident's states in the order it moves through them, severities most severe first),
  each with its colour, and every picker of them keeps that order and draws that colour. Enforced by
  [StateSettingsPagesGuard](../../packages/App/Tests/Dashboard/StateSettingsPagesGuard.test.ts),
  [StatePickersInOrderGuard](../../packages/App/Tests/Dashboard/StatePickersInOrderGuard.test.ts) and
  [StateDropdownColorsGuard](../../packages/App/Tests/Dashboard/StateDropdownColorsGuard.test.ts).
- **Every value can be archived from its settings page,** and an archived value is never offered for
  a new pick. Enforced by
  [ArchivedValuePickersGuard](../../packages/App/Tests/Dashboard/ArchivedValuePickersGuard.test.ts).
- **Danger comes last.** Delete, Reset and other actions that cannot be undone sit at the end of the
  page, in the danger style, and never inside a fold. Not enforced: use judgement.

## Forms

Creating a website monitor is three fields, and a status page is one. A form asks only what it cannot
work out, starts from a default for everything else, and folds what most people never change.

### Steps

- **More than three visible fields walk steps; three or fewer are one page.** A step earns its place:
  no step with one field, no step a person could finish the form without seeing. Enforced by
  [LongFormStepsGuard](../../packages/Common/Tests/UI/Components/Forms/LongFormStepsGuard.test.ts) and
  [SmallWizardsOnePageGuard](../../packages/Common/Tests/UI/Components/Forms/SmallWizardsOnePageGuard.test.ts).
- **A step shows at most five fields.** Enforced by
  [OverloadedFormStepsGuard](../../packages/Common/Tests/UI/Components/Forms/OverloadedFormStepsGuard.test.ts).
- **The primary button is only on the last step.** Next is never primary, and Declare Incident is not
  on step one. Enforced by
  [PrimaryActionLastStepGuard](../../packages/Common/Tests/UI/Components/Forms/PrimaryActionLastStepGuard.test.ts).
- **No step is called "Advanced" or "More".** What is rarely needed folds inside the step it belongs
  to. Enforced by
  [AdvancedStepsGuard](../../packages/Common/Tests/UI/Components/Forms/AdvancedStepsGuard.test.ts).

### Ask only what you cannot work out

- **A create form starts from defaults.** A rule created from its form starts switched on, as one
  created through the API does. Enforced by
  [CreateFormDefaultsGuard](../../packages/Common/Tests/UI/Components/Forms/CreateFormDefaultsGuard.test.ts).
- **A key is made from the name.** A person can edit it, but is never asked to type it. Enforced by
  [GeneratedKeyGuard](../../packages/Common/Tests/UI/Components/Forms/GeneratedKeyGuard.test.ts).
- **What can be derived is not asked.** A monitor's criteria take their name from their filters, and
  the description and the default status fold away. Enforced by
  [MonitorCriteriaRequiredInputsGuard](../../packages/App/Tests/Dashboard/MonitorCriteriaRequiredInputsGuard.test.ts).
- **A choice appears only when it is one.** All or Any is asked once there are two filters to combine.
  Enforced by
  [FilterConditionOnlyWithTwoFiltersGuard](../../packages/Common/Tests/UI/Components/Forms/FilterConditionOnlyWithTwoFiltersGuard.test.ts).
- **A rule form starts with what the rule does,** not a "Basic Info" step of a name and a description.
  Enforced by
  [ResourceRuleFormsGuard](../../packages/Common/Tests/UI/Components/Forms/ResourceRuleFormsGuard.test.ts),
  [TelemetryDataRuleFormsGuard](../../packages/Common/Tests/UI/Components/Forms/TelemetryDataRuleFormsGuard.test.ts)
  and
  [MetricAndRecordingRuleFormsGuard](../../packages/Common/Tests/UI/Components/Forms/MetricAndRecordingRuleFormsGuard.test.ts).
- **The obvious pick is suggested, one click to add.** A maintenance event suggests the status pages
  that show its monitors. Enforced by
  [StatusPageSuggestionsGuard](../../packages/App/Tests/Dashboard/StatusPageSuggestionsGuard.test.ts).
- **The forms of the first hour are pinned to their shortest shape.** Each guard below holds one family
  of forms to the questions it was cut down to; read its header before you add a field to one. Enforced
  by [DeclareAndCreateFormsGuard](../../packages/Common/Tests/UI/Components/Forms/DeclareAndCreateFormsGuard.test.ts),
  [DiscoveredResourceCreateFormsGuard](../../packages/Common/Tests/UI/Components/Forms/DiscoveredResourceCreateFormsGuard.test.ts),
  [StatusPageResourceFormsGuard](../../packages/Common/Tests/UI/Components/Forms/StatusPageResourceFormsGuard.test.ts),
  [CreateProjectFormsGuard](../../packages/Common/Tests/UI/Components/Project/CreateProjectFormsGuard.test.ts),
  [ProjectTeamFormsGuard](../../packages/Common/Tests/UI/Components/Forms/ProjectTeamFormsGuard.test.ts),
  [TeamCreateAccessGuard](../../packages/App/Tests/Dashboard/TeamCreateAccessGuard.test.ts),
  [IngestionKeyFormGuard](../../packages/App/Tests/Dashboard/IngestionKeyFormGuard.test.ts),
  [OnCallPolicyCreateFormGuard](../../packages/Common/Tests/App/Dashboard/OnCallPolicyCreateFormGuard.test.ts),
  [OnCallScheduleCreateFormGuard](../../packages/Common/Tests/App/Dashboard/OnCallScheduleCreateFormGuard.test.ts),
  [EscalationRuleFormGuard](../../packages/Common/Tests/App/Dashboard/EscalationRuleFormGuard.test.ts),
  [IncomingCallEscalationRuleFormGuard](../../packages/Common/Tests/App/Dashboard/IncomingCallEscalationRuleFormGuard.test.ts),
  [UserOverrideFormGuard](../../packages/Common/Tests/App/Dashboard/UserOverrideFormGuard.test.ts),
  [OidcProviderFormsGuard](../../packages/Common/Tests/UI/Components/Forms/OidcProviderFormsGuard.test.ts),
  [SamlProviderFormsGuard](../../packages/Common/Tests/UI/Components/Forms/SamlProviderFormsGuard.test.ts)
  and
  [SmtpConfigFormsGuard](../../packages/Common/Tests/UI/Components/Forms/SmtpConfigFormsGuard.test.ts).

### One control for one job

- **One switch.** Every yes or no is the shared `Toggle` (`Common/UI/Components/Toggle`). Enforced by
  [ToggleUsageGuard](../../packages/Common/Tests/UI/Components/ToggleUsageGuard.test.ts).
- **One color picker:** named swatches first, a custom color for an exact code. Enforced by
  [OneColorPickerGuard](../../packages/Common/Tests/UI/Components/ColorPicker/OneColorPickerGuard.test.ts).
- **One Owners field,** not an owner-teams dropdown beside an owner-users one. Enforced by
  [OwnersFieldGuard](../../packages/Common/Tests/UI/Components/PeoplePicker/OwnersFieldGuard.test.ts).
- **One incident role picker.** Enforced by
  [OneIncidentRolePickerGuard](../../packages/Common/Tests/UI/Components/Forms/OneIncidentRolePickerGuard.test.ts).
- **One Labels field,** folded at the end of the step that holds the record's name, never a step of
  its own. Enforced by
  [LabelsFormFieldGuard](../../packages/Common/Tests/UI/Components/Forms/LabelsFormFieldGuard.test.ts).
- **Order is set by dragging,** not typed as numbers. A new item goes to the end. Enforced by
  [DragOrderedListsGuard](../../packages/App/Tests/Dashboard/DragOrderedListsGuard.test.ts).
- **No control inside another control,** such as a button inside a link. Enforced by
  [NestedControlsGuard](../../packages/Common/Tests/UI/Components/NestedControlsGuard.test.ts).

### Folds

- **A fold is called "More fields" in a form and "More settings" on a page,** never "Advanced", and
  lists what it holds while folded, with the set ones and their values. Use the shared constants in
  `FoldedSectionTitles`. Enforced by
  [FoldedSectionsGuard](../../packages/Common/Tests/UI/Components/Forms/FoldedSectionsGuard.test.ts).
- **Show more and Show less say which way they are,** from the fold's state, and stay on screen both
  ways. Enforced by
  [DisclosureTogglesGuard](../../packages/Common/Tests/UI/DisclosureTogglesGuard.test.ts).
- **A fold never cuts off what it holds.** No fixed height cap on an open fold. Enforced by
  [FoldHeightCapGuard](../../packages/Common/Tests/UI/Components/FoldHeightCapGuard.test.ts).

### Help text

- **A description is one short sentence.** Under a field, at most 150 characters (two short lines);
  beside a card's title, 210. A switch's says what "on" does. The detail goes in the docs or a guide.
  Enforced by
  [ShortDescriptionsGuard](../../packages/App/Tests/Dashboard/ShortDescriptionsGuard.test.ts) and
  [NetworkFormDescriptionsGuard](../../packages/App/Tests/Dashboard/NetworkFormDescriptionsGuard.test.ts).
- **A field says what it is for in the product's words,** or says nothing. Never the API's column
  description ("Any friendly name of this object"). Enforced by
  [MonitorFormsOwnWordsGuard](../../packages/App/Tests/Dashboard/MonitorFormsOwnWordsGuard.test.ts) and
  [SettingsFormsOwnWordsGuard](../../packages/App/Tests/Dashboard/SettingsFormsOwnWordsGuard.test.ts).
- **"(Optional)" is said once, on the label.** Not again in the placeholder. Enforced by
  [PlaceholderOptionalMarkGuard](../../packages/Common/Tests/UI/Components/Forms/PlaceholderOptionalMarkGuard.test.ts).
- **Help says what the field does first, then why it matters,** and is true: "A monitor with no
  probes is never checked", not "Leave this empty to use every probe". Not enforced: use judgement.

### Errors

- **A field's error is drawn by `FieldError`,** under the field, in one red that can be read in both
  themes. Enforced by [FieldErrorGuard](../../packages/Common/Tests/UI/FieldErrorGuard.test.ts) and
  [FieldErrorColorGuard](../../packages/Common/Tests/UI/FieldErrorColorGuard.test.ts).
- **A field says what is wrong in the reader's language.** Enforced by
  [FormValidationMessagesInLocales](../../packages/App/Tests/FormValidationMessagesInLocales.test.ts).
- **An error says what happened, why if OneUptime knows, and what to do next.** It is the moment a
  person most needs the product to be clear (#6836). What to do next is a fix they can make, who can
  make it, or Try again. Good, from the product: "You already have a project with the same name.
  Choose another name."; "That code is not right. Enter the code from the latest message we sent, or
  send a new code."; "This project has no monitor status marked as operational, so a new monitor has
  no status to start in. Add one under Monitors > Settings > Monitor Status, then create the monitor
  again." Bad, as they were: "Project with the same name already exists", "Invalid code",
  "Operational status not found for this project". Not enforced: use judgement.
- **An error never blames the person, never shows an internal name or code alone, and never ends at
  an empty phrase:** "Server Error", "Something went wrong", "Invalid request", "Bad request" or "An
  error occurred" on their own (`EMPTY_ERROR_PHRASES` in `Common/Types/Exception/ErrorMessageRule`).
  Every message thrown with its words written where it is thrown is a sentence, a capital letter first
  and a full stop last; the first-hour flows' files (sign-up, a project, an invitation, a monitor, a
  notification method, on-call, a status page, an ingestion key) have no exception, and everywhere
  else a per-file baseline of messages that are not sentences may not grow (lower it with
  `UPDATE_ERROR_MESSAGES_BASELINE=true` when you rewrite one). Enforced by
  [ErrorMessagesGuard](../../packages/Common/Tests/App/ErrorMessagesGuard.test.ts).
- **A failure nobody explained still says what to do next, with a reference.** When the server fails
  in a way no message describes, it answers with what happened and what to do next, and a reference
  (the start of the request's id) that one of its log lines names
  (`Common/Server/Utils/UnexplainedServerError`). `API.getFriendlyMessage` turns every unexplained
  failure into one of four sentences (`Common/Types/Exception/UnexplainedError`): the server failed,
  the server did not answer, OneUptime could not be reached, or the page failed; never a
  TypeError's words or a URL. A form's alert, a list or table that did not load, a dialog and the
  page that did not load draw them with `ErrorExplanation`: what failed ("The monitor was not
  saved."), why, Try again, the reference with a copy button, and, for a master admin of a
  self-hosted server, where to look (`npm run doctor -- --logs`, OneUptime Health). Use
  `API.getFriendlyMessage` for every error you show, and hand a sentence of what failed to the form
  or list (`whatFailed`) where the page knows it. Enforced by
  [ErrorMessagesGuard](../../packages/Common/Tests/App/ErrorMessagesGuard.test.ts) for the words of
  the last resort; for everything else, not enforced: use judgement.
- **Another system's failure is said in OneUptime's words first,** and that system's own words
  second: "The verification code was not sent to +15551230100. No Twilio account is set up to send
  SMS." Not enforced: use judgement.
- **An error inside a sentence is said in the reader's language.** A card that says what failed in
  a sentence of its own ("Couldn't work out who is told. {{error}}") draws the error with
  `ErrorSentence`, or fills it with `errorInSentence(message)` where it has to be text
  (`Common/UI/Utils/ErrorInSentence`). Filled with the message as it came, a German or a Persian
  card read half in English, and a server failure's reference had no copy button (#7307).
  Enforced by
  [ErrorSentenceGuard](../../packages/Common/Tests/App/Dashboard/ErrorSentenceGuard.test.ts).

## Lists and empty states

### Lists

- **A list looks like every other list.** Its card header uses the shared table's buttons, not icons
  of its own. Enforced by
  [TableHeaderButtonsGuard](../../packages/Common/Tests/UI/Components/Table/TableHeaderButtonsGuard.test.ts).
- **Columns can be sized.** A new table element spreads `useResizableColumns`' `tableAttributes`, or
  is listed in `LEFT_OUT` with its reason. Enforced by
  [TableColumnResizeCoverage](../../packages/Common/Tests/UI/Components/Table/ColumnResize/TableColumnResizeCoverage.test.ts).
- **On a narrow screen, columns fold under another column** the page names (`foldInto`): an
  incident's severity under its state. Enforced by
  [TableFoldIntoGuard](../../packages/App/Tests/Dashboard/TableFoldIntoGuard.test.ts).
- **A column earns its place.** A column that tells the reader nothing they act on goes, as the Type
  column of workflow variables did. Enforced by
  [WorkflowVariableListsGuard](../../packages/Common/Tests/App/Dashboard/WorkflowVariableListsGuard.test.ts).
- **A bulk action shows its progress and can be stopped.** It runs through `runBulkAction`. Enforced
  by
  [BulkActionsRunThroughRunnerGuard](../../packages/Common/Tests/UI/BulkActionsRunThroughRunnerGuard.test.ts).
- **The colours of the shared table hold in both themes.** Enforced by
  [TableSourceGuard](../../packages/Common/Tests/UI/Components/Table/TableSourceGuard.test.ts).
- **An empty value is the quiet dash, never a hyphen a page writes.** An empty cell or detail field
  draws the light grey dash a screen reader reads as "Not set" (`TableEmptyValue`,
  `Detail/EmptyValue`). A column's `noValueMessage: "-"` or a field's `placeholder: "-"` drew a
  darker hyphen of its own, so one row could show both marks for the same nothing (#7264). A page
  that wants words writes words ("Never", "No labels attached."). Enforced by
  [TableEmptyValueDashGuard](../../packages/Common/Tests/UI/Components/Table/TableEmptyValueDashGuard.test.ts).

### Empty states and suggestions

- **An empty list says "No X yet", what the list is for, and offers its Create button.** Never "No X
  found." with "Refresh?", which reads as a failed load on a new project. A product's own list explains
  the product while the project has none. Enforced by
  [CoreListEmptyStates](../../packages/Common/Tests/App/Dashboard/CoreListEmptyStates.test.tsx).
- **A search or filter that finds nothing never offers Create.** It says nothing matched. Not
  enforced: use judgement.
- **An empty state says each thing once.** An embedded logs list's empty state has one line from the
  page that embeds it. Enforced by
  [LogsEmptyHintsGuard](../../packages/App/Tests/Dashboard/LogsEmptyHintsGuard.test.ts).
- **A suggestion shows only when it applies,** decided by one helper per kind in
  `Common/Utils/Suggestions`, never in a page. Enforced by
  [SuggestionRulesGuard](../../packages/Common/Tests/App/Dashboard/SuggestionRulesGuard.test.ts).

## Dialogs and confirmations

- **A dialog has exactly one primary button,** and it is the thing the dialog exists to do. Cancel is
  plain. Enforced by
  [DialogPrimaryActionGuard](../../packages/Common/Tests/UI/DialogPrimaryActionGuard.test.ts).
- **A delete dialog names what it deletes:** "Are you sure you want to delete Nightly Backup?", not
  "...delete this workflow?". Enforced by
  [DeleteConfirmationNamesGuard](../../packages/Common/Tests/UI/DeleteConfirmationNamesGuard.test.ts).
- **Taking away something others depend on says what breaks first.** Deleting the last on-call rule
  that covers a severity says who would no longer be paged, before it happens. Enforced by
  [OnCallPreventionGuards](../../packages/Common/Tests/App/Dashboard/OnCallPreventionGuards.test.tsx)
  and
  [OnCallRulesDeleteGuard](../../packages/Common/Tests/App/Dashboard/OnCallRulesDeleteGuard.test.tsx).
- **A dialog is for a short job that returns the person where they were.** Creating a record from a
  list, a confirmation, a quick edit. Something people read, compare or come back to is a page. Not
  enforced: use judgement.
- **A preview in a dialog never leaves the page.** It draws a thing as its reader will see it, over
  work the dialog has not saved yet, so a click in it must not open another page and drop that work.
  In a dashboard widget's Live Preview a link is its words, and a tile, a map's site, an incident's
  marker or an exemplar opens nothing (#6859). Enforced by
  [DashboardWidgetPreviewGuard](../../packages/Common/Tests/App/Dashboard/DashboardWidgetPreviewGuard.test.tsx).
- **Confirm only what cannot be undone.** A switch that can be flipped back saves without asking.
  Not enforced: use judgement.
- **Leaving unsaved work asks first.** While a page holds work it has not saved (a dashboard being
  edited), a step to another page waits for its answer, Keep Editing or Discard Changes: a link,
  the side menu, the breadcrumbs, a button, the project picker, the browser's Back and Forward.
  Closing or reloading the tab asks with the browser's own dialog (`useLeaveGuard`, #7173). With
  nothing unsaved, nothing asks. Enforced by
  [LeaveGuard](../../packages/Common/Tests/UI/Utils/LeaveGuard.test.ts),
  [UseLeaveGuard](../../packages/Common/Tests/UI/Utils/UseLeaveGuard.test.tsx),
  [NavigationLeaveGuard](../../packages/Common/Tests/UI/Utils/NavigationLeaveGuard.test.ts),
  [LinkLeaveGuard](../../packages/Common/Tests/UI/Components/LinkLeaveGuard.test.tsx),
  [AppLinkLeaveGuard](../../packages/Common/Tests/App/Dashboard/AppLinkLeaveGuard.test.tsx) and
  [ProjectPickerLeaveGuard](../../packages/Common/Tests/UI/Components/ProjectPickerLeaveGuard.test.tsx).

## Cards and the look of a page

- **No card inside a card.** A section inside a card is a divider and a heading. Enforced by
  [CardInCardGuard](../../packages/Common/Tests/UI/Components/CardInCardGuard.test.ts).
- **A card's actions sit on the right of its title,** in one box on the same row. Enforced by
  [CardHeaderActionsGuard](../../packages/Common/Tests/UI/Components/CardHeaderActionsGuard.test.tsx).
- **A card's description sits right under its title,** with no gap. Enforced by
  [CardDescriptionUnderTitleGuard](../../packages/Common/Tests/UI/Components/CardDescriptionUnderTitleGuard.test.tsx).
- **What a card holds lines up with its title,** in every product: the card pads its body, and the
  body does not pad it again. Enforced by
  [CardBodyPaddingGuard](../../packages/Common/Tests/App/Dashboard/CardBodyPaddingGuard.test.ts).
- **A row of cards ends on one line.** Enforced by
  [CardRowsGuard](../../packages/Common/Tests/UI/Components/CardRowsGuard.test.ts).
- **A chart's legend names its series in the order the page gives them,** not alphabetically, so it reads
  the same in every language: every recharts `Legend` passes an `itemSorter` (never `itemSorter={null}`). Enforced by
  [ChartLegendOrderGuard](../../packages/Common/Tests/UI/ChartLegendOrderGuard.test.ts).
- **A details card lays its fields out by its own width,** not by a share of the page's. Enforced by
  [DetailCardsSourceGuard](../../packages/Common/Tests/UI/Components/Detail/DetailCardsSourceGuard.test.ts)
  and
  [MonitorSummaryViewsLayoutGuard](../../packages/App/Tests/Dashboard/MonitorSummaryViewsLayoutGuard.test.ts).
- **Banners are for exceptions the person must act on,** never for the default state. Enforced by
  [NoAlwaysOnInfoBannersGuard](../../packages/App/Tests/Dashboard/NoAlwaysOnInfoBannersGuard.test.ts).
- **A sample project says what it is on every page.** It is the one bar a project shows on every
  page, because there the project itself is the exception: nobody may take its made-up incidents
  for their own (#6808). One dark bar at the top says "This is a sample project. Nothing here is
  real, and nobody is notified.", with the ways out (back to their own project, Delete Sample
  Project) and How OneUptime works, and it is drawn for a sample alone. Enforced by
  [SampleProjectBar](../../packages/Common/Tests/App/Dashboard/SampleProjectBar.test.tsx) and
  [NoAlwaysOnInfoBannersGuard](../../packages/App/Tests/Dashboard/NoAlwaysOnInfoBannersGuard.test.ts).
- **A button that cannot be pressed looks it,** the same way everywhere: faded, with the not-allowed
  cursor. Enforced by
  [HandDrawnButtonLockedLookGuard](../../packages/Common/Tests/UI/HandDrawnButtonLockedLookGuard.test.ts).
- **Icons and logos are one-colour SVGs,** and an icon means one thing: a timeline is shown with the
  timeline's icon. Enforced by
  [ProviderLogosGuard](../../packages/Common/Tests/UI/Components/ProviderLogo/ProviderLogosGuard.test.ts)
  and [TimelineIconGuard](../../packages/App/Tests/Dashboard/TimelineIconGuard.test.ts).
- **A person has one colour** on every on-call screen. Enforced by
  [OnCallPersonColorGuard](../../packages/Common/Tests/App/Dashboard/OnCallPersonColorGuard.test.ts).
- **Every page works in the dark theme.** Enforced by
  [AccountsDarkModeGuard](../../packages/App/Tests/Accounts/AccountsDarkModeGuard.test.ts) for the
  sign-in pages; look at everything else in both themes before you open a pull request.

## Words

### Names

- **One name per thing.** Use the glossary's name
  ([`introduction/glossary.md`](../../packages/App/FeatureSet/Docs/Content/en/introduction/glossary.md))
  and the name the menu uses. A renamed thing is still found by its old name in Search. Not enforced:
  use judgement.
- **A retired name does not come back.** When one thing had several names, #6817 kept one and retired
  the rest ([`RetiredNames`](../../packages/Common/Types/Docs/RetiredNames.ts)): "On-Call Duty" is
  On-Call, a person's "on-call rules" are How to Reach Me, the project's "Notification Settings" are
  Notification Channels, a "Scheduled Maintenance Event" is a Maintenance Event. A retired name stays
  only where people who learned it look: a Search keyword, the glossary's "Also called", a docs-search
  synonym, and an address, API name or stored value (a model's `apiSingularName`, a workspace rule's
  condition shown through a label), or a name another app keeps (the Slack app's shortcuts, as its
  manifest names them). Enforced by
  [RetiredNamesGuard](../../packages/App/Tests/Dashboard/RetiredNamesGuard.test.ts), which reads the
  Dashboard's words, permission names, emails, every front end's English locale, every string the
  server and the front ends write, the English docs with their diagrams, and the website, and
  [RetiredNamesFindable](../../packages/App/Tests/Dashboard/RetiredNamesFindable.test.ts), which checks
  that each old name still finds the page.
- **At most three words on a page are marked as defined terms, each the first time it is met.** A
  `DefinedTerm` draws the word with a dotted line and shows its definition on hover, focus or tap.
  Enforced by
  [GlossaryTermsPerPage](../../packages/App/Tests/Dashboard/GlossaryTermsPerPage.test.ts).
- **A rule's words are its records' words.** A condition is "Incident Title", not "Incident Title
  Pattern", and a rule asks "All incidents" or "Only incidents that match conditions". Enforced by
  [RuleCriteriaNamesGuard](../../packages/Common/Tests/UI/Components/RuleCriteria/RuleCriteriaNamesGuard.test.ts)
  and
  [RuleCriteriaSubjectGuard](../../packages/Common/Tests/UI/Components/RuleCriteria/RuleCriteriaSubjectGuard.test.ts).
- **What OneUptime AI does reads as what it does:** "Checking SLOs" while it runs, "Checked SLOs" once
  it has. Enforced by
  [ActivityStepLabelsGuard](../../packages/Common/Tests/App/Dashboard/ActivityStepLabelsGuard.test.ts).

### Tone, capitals and buttons

- **Talk to the person as "you".** "Your on-call rules", not "The user's on-call rules". Not enforced:
  use judgement.
- **Titles, menu entries and buttons are in Title Case; descriptions, help and messages are
  sentences.** "Create On-Call Schedule"; "Pages the people on call when an incident is declared." Not
  enforced: use judgement.
- **A button says what it does, with its object.** "Create Monitor", not "Submit" or "OK". "Create"
  makes something that stands on its own (Create Monitor, Create Status Page); "Add" puts something
  into the record you are on (Add Monitors to Group, Add Subscriber). Not enforced: use judgement.
- **A card's description says what the card or list is for,** not "Here is a list of…". Enforced by
  [CardDescriptionBoilerplateGuard](../../packages/App/Tests/Dashboard/CardDescriptionBoilerplateGuard.test.ts).
- **Name the thing, not "it".** "Page this policy for every new incident", not "Page it", where "it"
  could be the person just added. Not enforced: use judgement.

### Numbers, dates and plurals

- **A count goes through the plural forms of the reader's language** (`translatePlural`), and a
  second count beside it, joined by "/", " of " or ":", is written in the reader's digits too
  (`translator.formatNumber`): "۵/۸" and "۳۹ از ۴۰" on a Persian page. Enforced by
  [CountPairsInReadersDigitsGuard](../../packages/Common/Tests/UI/CountPairsInReadersDigitsGuard.test.ts),
  whose list of " of " pairs still to write only shrinks.
- **A figure on its own is written in the reader's digits, decimal sign and percent sign:** a tile's
  "97.5%" is "۹۷٫۵٪" in Persian and "97,5 %" in German, with `formatReaderFigure` (toFixed's
  decimals, English exactly as toFixed writes it) or `translator.formatNumber`; a figure inside a
  sentence takes the sentence's language (`figureInSentence`, `withSentenceDigits`), and a count in
  a list column is a count column (`isCount`). Arabic is written in Latin digits. A name, an id, a
  port or a Kubernetes quantity ("500m") is drawn as written. Checked on the Host and Kubernetes
  pages. Enforced by
  [HostOverviewFiguresInPersian](../../packages/Common/Tests/App/Dashboard/HostOverviewFiguresInPersian.test.tsx)
  and
  [KubernetesOverviewFiguresInPersian](../../packages/Common/Tests/App/Dashboard/KubernetesOverviewFiguresInPersian.test.tsx).
- **A negative number in a right-to-left sentence takes the language's own minus:** in Persian a
  left-to-right mark and a minus sign (U+2212) before the digits, in Arabic the word
  ([ARABIC.md](../../packages/App/FeatureSet/Dashboard/src/Locales/ARABIC.md)),
  never a hyphen that a right-to-left line moves after the number. Enforced by
  [NegativeNumbersInRightToLeftSentences](../../packages/Common/Tests/App/NegativeNumbersInRightToLeftSentences.test.ts).
- **A date is written by `OneUptimeDate` in the reader's language,** never put into an English
  template literal. Enforced by
  [DatesInEnglishTextGuard](../../packages/App/Tests/Dashboard/DatesInEnglishTextGuard.test.ts).
- **A duration in milliseconds is written in the reader's language,** with the Dashboard's
  `formatMilliseconds` ("{{value}} ms", each language's own unit and order, the figure in the
  reader's digits), never a figure joined to " ms": every monitor's Response Time read "ms 411" on
  an Arabic or Persian page (#7224). Enforced by
  [MillisecondsInReadersLanguageGuard](../../packages/Common/Tests/UI/MillisecondsInReadersLanguageGuard.test.ts).
- **A chart of one point a day labels its axis by the day** (`xAxisPrecision={XAxisPrecision.EVERY_DAY}`),
  never by an hour or a step guessed from the window's length. Enforced by
  [ProductAnalyticsDayAxisGuard](../../packages/Common/Tests/App/Dashboard/ProductAnalyticsDayAxisGuard.test.ts).
- **A whole sentence is translated, never a word at a time.** Word by word, German read "Nein monitors
  yet". Use `TranslatedSentence` for a sentence with values in it. Not enforced: use judgement.

### In every language

OneUptime speaks 17 languages, and Arabic and Persian read right to left. New Dashboard words go in
every locale: `npm run i18n:extract` and `npm run i18n:check` in `packages/App/FeatureSet/Dashboard`,
then `npm run i18n:validate` from the root.

- **Every word a person reads is translated.** Enforced by
  [DashboardLocalesGuard](../../packages/App/Tests/Dashboard/DashboardLocalesGuard.test.ts),
  [ArabicLocaleGuards](../../packages/Common/Tests/App/ArabicLocaleGuards.test.ts),
  [DashboardWordsInPersian](../../packages/App/Tests/Dashboard/DashboardWordsInPersian.test.ts),
  [DashboardComponentsAToLHardcodedGuard](../../packages/App/Tests/Dashboard/DashboardComponentsAToLHardcodedGuard.test.ts),
  [DashboardComponentsMRHardcodedGuard](../../packages/App/Tests/Dashboard/DashboardComponentsMRHardcodedGuard.test.ts),
  [DashboardPagesUtilsHardcodedGuard](../../packages/App/Tests/Dashboard/DashboardPagesUtilsHardcodedGuard.test.ts),
  [DashboardSloTopologyWorkspaceHardcodedGuard](../../packages/App/Tests/Dashboard/DashboardSloTopologyWorkspaceHardcodedGuard.test.ts)
  and
  [DashboardTraceViewHardcodedGuard](../../packages/App/Tests/Dashboard/DashboardTraceViewHardcodedGuard.test.ts).
- **A phone number is never printed as it is.** On a page that reads right to left its "+" would go after
  its digits; print it so it keeps its own direction. Enforced by
  [PhoneNumberTextGuard](../../packages/Common/Tests/UI/PhoneNumberTextGuard.test.ts).
- **A right-to-left page reads right to left.** Use start and end, never an inline left or right; a
  canvas's panels are mirrored once, by the page; a name in a table reads the way its words do; a
  sentence in a flex row is one item of it. Enforced by
  [ReadingDirectionGuard](../../packages/Common/Tests/UI/ReadingDirectionGuard.test.ts),
  [CanvasPanelsMirroredOnceGuard](../../packages/Common/Tests/UI/CanvasPanelsMirroredOnceGuard.test.ts),
  [TableNameColumnsLineTextGuard](../../packages/Common/Tests/UI/Components/Table/TableNameColumnsLineTextGuard.test.ts),
  [DashboardListNameCellsGuard](../../packages/Common/Tests/App/Dashboard/DashboardListNameCellsGuard.test.ts)
  and
  [TranslatedSentenceInRowGuard](../../packages/Common/Tests/UI/TranslatedSentenceInRowGuard.test.ts).
- **A path's arrows point the way it is read.** A browser never turns "→" round, so on a page read
  from the right it points each step back at the one before: Arabic and Persian write "←" beside a
  step in their own words (`تنظیمات پروژه ← پیشرفته`), and keep "→" between two steps left in Latin
  letters, which are drawn from the left. ">" and "›" turn round by themselves. Enforced by
  [PathArrowsInRightToLeftSentences](../../packages/Common/Tests/App/PathArrowsInRightToLeftSentences.test.ts).
- **A bare word has one meaning everywhere,** because a label is translated by its English text.
  "Any" is the Match Condition's word. Enforced by
  [MatchConditionAnyWordGuard](../../packages/Common/Tests/UI/Components/Forms/MatchConditionAnyWordGuard.test.ts).
- **A noun the sentences share starts a label with a capital.** Many nouns are worded for the middle
  of a sentence, so Spanish says "clúster de Kubernetes" and French "ressource cloud". Where the same
  key names a row, a chip or a line of a card, draw it through `toLabelTerm`, which starts it with a
  capital in the reader's language: "Clúster de Kubernetes". A key that is only ever a label is worded
  with a capital in every language instead. Enforced by
  [NounKeysDrawnAsLabelsGuard](../../packages/Common/Tests/App/Dashboard/NounKeysDrawnAsLabelsGuard.test.ts)
  and
  [NounLabelsStartWithACapital](../../packages/Common/Tests/App/Dashboard/NounLabelsStartWithACapital.test.tsx).
- **Pick words that translate as you mean them.** "About" read "Regarding" in 13 languages, so the
  button says "How it works"; "Uptime" read "runtime", so a share of time up says "Availability". Not
  enforced: use judgement.

### What never to write

- **Never say something happened when it did not.** "Copied!" only after the copy worked, and "Sent"
  only when it was sent. Enforced by
  [ClipboardWritesGuard](../../packages/Common/Tests/UI/ClipboardWritesGuard.test.ts) for copy buttons;
  for everything else, not enforced: use judgement.
- **Never ask for a click that does nothing where it is drawn.** A dashboard widget is drawn on the
  board being edited, in its settings' Live Preview, on a board out of edit mode and on a public
  dashboard: "Click to configure metric" is true only on the first, so a widget that is not set up
  takes its line for each place from `DashboardWidgetSetupCopy`. Enforced by
  [WidgetSetupLineGuard](../../packages/Common/Tests/App/Dashboard/WidgetSetupLineGuard.test.ts).
- **No jargon, no made-up words, no vendor names in examples.** "Not Operational", not
  "Inoperational"; neutral model names (chat-large), not a vendor's model ids. Not enforced: use
  judgement.

## Asking people

People who are lost leave quietly, so the product asks them, in five seconds, what was hard
(#6832). Answers stay on the server, for its master admins (Admin Dashboard > Feedback).

- **Ask at most one question a week, once per question, and never while something is down.** A
  question OneUptime asks goes through `ProductFeedback.ask` (`Common/UI/Utils/ProductFeedback`),
  and the server decides: never once the person or the server has switched questions off, never
  while the project has an open incident or alert, and never a question the person was asked
  before. The end of every guided setup already asks once, from `GuidedSetupFrame`, so a new setup
  needs no question of its own. A new place that asks is added to the guard's list, with the
  reason. Enforced by
  [FeedbackQuestionsGuard](../../packages/App/Tests/Dashboard/FeedbackQuestionsGuard.test.ts).
- **Ask what to fix, not how much people like OneUptime.** "How easy was that?" at the end of a
  flow says what to fix. A product-wide score, the "how likely are you to recommend" kind, does
  not, so the product asks none. Enforced by
  [FeedbackQuestionsGuard](../../packages/App/Tests/Dashboard/FeedbackQuestionsGuard.test.ts).
- **An answer carries the page as a route with no ids, and the version, and nothing else.** No
  person, no project, no address. Say where it goes where it is given: to the server's admins on a
  self-hosted server, and to the OneUptime team on Cloud. Enforced by
  [FeedbackQuestionsGuard](../../packages/App/Tests/Dashboard/FeedbackQuestionsGuard.test.ts).
- **Before each release, someone who has not seen the changes walks the core jobs as a newcomer**,
  and posts what made them hesitate, guess or go back on the epic #6802:
  [the newcomer walkthrough](newcomer-walkthrough.md). Not enforced: use judgement.

## Before you open a pull request

- **Look at it as a newcomer would.** At 1280 and 390 pixels wide (and at 1024 and 768 beside the side
  menu), in light and dark, in German (a long language) and Persian (right to left), as a brand-new
  project and as a busy one. Put before and after screenshots in the pull request. Not enforced: use
  judgement.
- **Run the guards that read what you changed.** Find them by your files' names in the test folders.
  When you change a menu, run its product's `*SideMenu*` suite; when you change a shared component, run
  every suite that renders it. Not enforced: use judgement.

### Journey budgets

- **A core job does not get longer without a decision.** Seven journeys (create a website monitor, get
  paged, publish a status page and the rest) count the screens, dialogs, clicks and typed fields of a
  whole job on every pull request, and fail when one goes over its budget.
  [`packages/E2E/Journeys/README.md`](../../packages/E2E/Journeys/README.md) says what each measure
  counts, how to read a failure, and what to do when a job gets shorter or longer. The budgets are in
  [`Tests/Ops/JourneyBudgets.json`](../../Tests/Ops/JourneyBudgets.json). Enforced by
  [Journeys.spec](../../packages/E2E/Journeys/Journeys.spec.ts).

## Rules still to come

This guide writes down the rules that exist. The epic adds more, and each arrives with its own guard
in the section where it belongs:

- **A guided setup's shape** (#6804 and the setups after it): under
  [A product's first page](#a-products-first-page).
- **When a word gets a definition** (#6819): under [Names](#names), beside
  [GlossaryTermsPerPage](../../packages/App/Tests/Dashboard/GlossaryTermsPerPage.test.ts).
- **A new journey budget** (#6831): in the journeys' README, linked from
  [Journey budgets](#journey-budgets).

## Adding a rule or a guard

A guard that keeps a page simple is part of this guide. When you write one:

1. Start its file with one line naming the section of its rule:
   `// UX rule: Docs/ux/README.md#<section>`, where `<section>` is the heading's anchor as GitHub
   writes it (`#steps`, `#a-records-overview`).
2. Add the rule to that section as a bullet: the rule in bold, why in a sentence, an example from the
   product, and "Enforced by" with a link to the guard. A rule no test can check ends with
   "Not enforced: use judgement."
3. Run
   [UxRulebookInStep](../../packages/Common/Tests/App/UxRulebookInStep.test.ts):
   `cd packages/Common && npx jest Tests/App/UxRulebookInStep`.

A test named `*Guard*` in `packages/Common/Tests/UI`, `packages/Common/Tests/App` or
`packages/App/Tests/Dashboard` that guards something other than what a person sees (security,
permissions, performance, the build) goes in `NOT_UX_GUARDS` in UxRulebookInStep, with the reason, so
the next person does not have to decide again.
