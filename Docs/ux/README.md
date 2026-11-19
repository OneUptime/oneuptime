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
- **While a new project's quickstart shows, it is all of Home.** The question "What do you want to do
  first?" and the steps its goals bring are the one thing a new person meets: a new project's Home was
  a banner to create a monitor, five zeros, the Welcome card and two empty lists, all asking for the
  same first click (#8897). Only what cannot wait shows above it: an open incident or anything else
  that needs someone, and an unfinished server, to its admin. Hiding the checklist or finishing it
  brings the rest of Home back, with the line that shows it again; once finished, "More to set up" is
  one card among Home's others while core steps no goal brought are left (#7986). Enforced by
  [HomePage](../../packages/Common/Tests/App/Dashboard/HomePage.test.tsx).
- **Do not ask for what is already done.** "Send your first logs" never sits above a page of logs, and
  there is one button for one job on a page, not the explanation's and the empty state's for the same
  setup: Home's headline leaves out "Create your first monitor" while the Welcome card offers that
  step (#7759). Enforced by
  [HomePage](../../packages/Common/Tests/App/Dashboard/HomePage.test.tsx) for Home; elsewhere, not
  enforced: use judgement.
- **A job that crosses products is a guided setup, on one page.** "Know when my website is down" needs a
  monitor, who is told and a test page; three products would leave the person to find the chain. A
  guided setup draws its steps in `Components/GuidedSetup/GuidedSetupFrame`: each step saves real
  records, coming back opens the first step not done, and it ends with a summary read from the
  records and what to do next (`/monitors/setup`, #6804; `/on-call-duty/setup`, #6805). Beside its
  steps it lists what the setup sets up, ticked as each step is done, and about how long it takes,
  the minutes Home's checklist says beside its step (#8897). Its journey gets a budget of its own, with
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
  sections. A status page's subscribers are one Subscribers page with a tab per channel (Email, SMS,
  Slack, Microsoft Teams, Webhook), where they were five pages, and the old addresses open their tab
  (#9125). Its sign-on providers are one Single Sign-On page with a SAML and an OIDC tab, where "SSO"
  and "OIDC" were two entries with the same icon, and the old OIDC address opens its tab (#9130).
  Enforced by
  [OnCallRulesOnePageGuard](../../packages/App/Tests/Dashboard/OnCallRulesOnePageGuard.test.ts) and
  [StatusPageSubscribersOnePageGuard](../../packages/App/Tests/Dashboard/StatusPageSubscribersOnePageGuard.test.ts).
- **Red is for what broke, never for a choice.** A state someone chose (a monitor they disabled, a
  record they archived or paused) gets a grey count and a calm icon, and sits with the records, not
  under Attention Required. Monitors filed Disabled there with the error icon and a red count beside
  Not Operational, and a red count that never went away taught people to ignore red (#9126). The
  same state is grey wherever it shows: a monitor's row, its badge and an SLO's list of monitors.
  A chip that says Disabled, Archived or Paused is the `Paused` tone, grey with a hollow dot, and a
  rule's on or off is `EnabledPill`: about ninety rule lists, from owner rules to drop filters and
  workflows, drew a rule someone switched off as a red "Disabled" (#9184). Enforced by
  [DeliberateStatesNotDangerGuard](../../packages/App/Tests/Dashboard/DeliberateStatesNotDangerGuard.test.ts).
- **A section with one entry does not repeat that entry's name.** A heading that says what its only
  entry says doubles the menu's height and, folded, hides the page behind a click that tells nothing
  new: User Settings read "On-Call Logs › On-Call Logs", Admin Settings "Data Retention › Data
  Retention", Project Settings "Danger Zone › Danger Zone" and seven resource pages "Settings ›
  Settings" (#9134). Put the entry in a section of related pages (a resource's Settings sits in
  Advanced, beside Owners and Audit Logs), or name the entry for what the page does (Danger Zone ›
  Delete Project). Nor does it nearly repeat it: a heading whose every word is in its only entry
  ("Logs › Call Logs", "Calendar › Maintenance Calendar", "Notes › Private Notes", "Rules › Monitor
  Rules") says nothing the entry does not (#9216). Call Logs went to its policy's Basic, the
  maintenance calendar to Overview, a runbook's Executions to Advanced. A page that is the only
  entry of the only section has no side menu (an AI insight, Send Email). A product's own list
  ("Users › All Users") and a status page's folded Rules section, which the maintainer asked for,
  are allowed, with their reasons in the guard. Enforced by
  [OneEntryMenuSectionsGuard](../../packages/App/Tests/OneEntryMenuSectionsGuard.test.ts).
- **A setting only the public link reads says what it is for.** A dashboard's Branding and Custom
  Domains change only its public link, and showed on every dashboard as if they did more. They sit
  under "Public Link", folded, and while the dashboard is shared with the project only, each page
  opens on one notice that says so, with Change sharing, and folds its settings under it (#9134).
  Enforced by
  [DashboardPublicOnlySettings](../../packages/Common/Tests/App/Dashboard/DashboardPublicOnlySettings.test.tsx).
- **Every entry in the More menu has an icon.** Enforced by
  [MoreMenuItemIconsGuard](../../packages/App/Tests/MoreMenuItemIconsGuard.test.ts).

### Finding a page

- **Every page has a breadcrumb trail.** The trail says where a page is and is the way back up. A new
  routed page gets one. Enforced by
  [EveryPageHasATrail](../../packages/Common/Tests/App/Dashboard/EveryPageHasATrail.test.tsx).
- **Search (Cmd/Ctrl+K) finds every page a menu links to,** by the menu's name for it, and says where
  it lives the way the menu does. Add a new page to `PageSearchIndex.ts`. Enforced by
  [PageSearchIndexCoversMenus](../../packages/Common/Tests/App/Dashboard/PageSearchIndexCoversMenus.test.tsx).
- **Search finds a record's own pages too.** On a record's page, "sso" opens that status page's Single
  Sign-On. Anywhere, a page's name with the record's name or its kind ("status page sso", "acme
  subscribers") offers it for the matching records. A renamed page keeps its old title in
  `formerTitles`. Add a new page of a record's menu to `RecordPageSearchIndex.ts`. Enforced by
  [RecordPageSearchIndexCoversMenus](../../packages/Common/Tests/App/Dashboard/RecordPageSearchIndexCoversMenus.test.tsx).
- **A setting is found by the name on its card.** Searching "require sso to sign in" finds that switch
  on the SSO page. Add a new settings card or switch to its page's settings list in
  `PageSearchIndex.ts`, or to `NOT_A_SETTING`. Enforced by
  [SettingsFoundByName](../../packages/App/Tests/Dashboard/SettingsFoundByName.test.ts).
- **Search matches only words the page shows.** A key that names its meaning, such as `"Insights
  (explorer analytics)"`, is searched as the word the Dashboard draws ("Insights"). Its note to
  translators finds nothing, in any language. Enforced by
  [PageSearchMeaningKeysAsEnglish](../../packages/App/Tests/Dashboard/PageSearchMeaningKeysAsEnglish.test.ts).

### A record's overview

A record's overview answers "what is this, and is it all right?" first. What it is connected to comes
next, and how to change it last.

- **The hero is laid out one way.** Every resource's Overview opens with its icon, name and badges,
  when it was last seen, and the page's controls in one top row (`ResourceHeroLayout`). Enforced by
  [ResourceHeroLayoutGuard](../../packages/App/Tests/Dashboard/ResourceHeroLayoutGuard.test.ts).
- **A count or a state that says something is wrong opens what failed and why.** "3 Failed" on a
  Kubernetes cluster's hero and "Degraded" beside a host's name said something was wrong and nothing
  else: the reasons were a card further down, or nowhere (#9537). Pressed, each opens the list of
  exactly what it counts (`ResourceAttentionDialog`), the most urgent first: why, in the resource's
  own words (a container's reason and exit code, the scheduler's message), which one it is (its
  namespace, its owner, its node), since when, what it reported lately, and View, a step from its
  page. A hero's health is `ResourceHealthPill`, handed what needs attention; a count is
  `ResourceAttentionPill`, which reads its parts only when it is pressed. Enforced by
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
- **A setting that does nothing yet says so where it is set,** with the way to what would make it
  count. A public status page lets every visitor in, so its private users, single sign-on and SCIM
  do nothing there, and none of their pages said so: a person could add a SAML provider to a public
  page and wait for a sign-in page that never came (#9130). While the page is public, each of those
  pages opens on one notice, "This status page is public, so these settings do nothing until you
  make it private.", with Change access, and folds its settings under it, still there to set up
  before the page goes private. Enforced by
  [StatusPagePrivateOnlySettingsGuard](../../packages/App/Tests/Dashboard/StatusPagePrivateOnlySettingsGuard.test.ts).
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
- **One picker.** A choice from a list is the shared `Dropdown` (`Common/UI/Components/Dropdown`),
  never a raw `<select>`. Some forty raw selects each had their own size, border, focus ring and
  dark look: small grey boxes on the topology maps, another size in RUM User Flows, borderless
  text in every footer. No two pickers on a page matched (#9194, #9294). A value that must always
  be set has no clear control (`isClearable={false}`). A choice that can be empty, such as "All
  devices" or "None", is the placeholder, and clearing the picker picks it. A `<label htmlFor>`
  names the picker through `inputId`. The `DropdownChoices` helpers build a fixed list's options.
  A picker in a bar of small controls, such as a list's rows per page or a query builder's fields,
  is `isCompact`: 28px tall, 44px under a finger, and otherwise the same picker (#9310).
  Enforced by
  [RawSelectGuard](../../packages/Common/Tests/UI/Components/RawSelectGuard.test.ts).
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
- **Nothing is pressed with a mouse alone.** Anything that does something on a click is a
  `<button type="button">` or a link, which Tab reaches, Enter and Space press, and which shows the
  focus ring. A `div` or `li` with only a click is out of a keyboard's reach and is read as text:
  a keyboard could open the header's notification bell but choose nothing in it, and could not go
  back to a finished step of a form (#9136). Enforced by
  [ClickOnlyControlsGuard](../../packages/Common/Tests/UI/Components/ClickOnlyControlsGuard.test.ts).
- **A finger can hit it.** Under a finger (`[@media(pointer:coarse)]:min-h-11`) a control is at
  least 44px across, or 24px with room around it: the list's page buttons were 28px, 24px in a
  compact list, with nothing larger for touch (#9136). A mouse keeps the compact size. Not enforced:
  use judgement.
- **A button keeps its words from a tablet to a wide screen.** A bell alone, named only by its
  tooltip, is found by hovering: the Logs and Traces explorers drew Create monitor so from 768px
  until their toolbars were 77rem wide, a service's Logs tab at 1280px too (#9455). A row with no
  room for a button's words wraps, as the explorers' toolbars do, or folds its lesser actions into
  ⋯, as a table's header does; it never hides the words at the middle widths to show them again
  wider. On a phone a button may keep its icon alone beside what says what it does
  (`isTitleHiddenOnPhone`). Enforced by
  [ButtonWordsAtEveryWidthGuard](../../packages/Common/Tests/UI/ButtonWordsAtEveryWidthGuard.test.ts).
- **One button.** An action is the shared `Button` (`Common/UI/Components/Button`), never a
  `<button>` drawn by hand in the primary colours: 34 of them each had their own size and corners,
  and their focus ring, locked look and phone layout had drifted from the shared one (#9128). Every
  style is drawn in one frame, the same height, padding, words and alignment, and carries no width
  or margin of its own: the box that holds the buttons spaces them with a gap, and a dialog's
  footer stacks them across a phone. A style used to decide that instead, so two buttons that
  looked alike filled a phone's width or did not, and a card's two test buttons took a line each
  on a 390px phone (#9100). Enforced by
  [HandMadePrimaryButtonGuard](../../packages/Common/Tests/UI/HandMadePrimaryButtonGuard.test.ts).
- **One chip.** A coloured status or label chip is the shared `Pill`
  (`Common/UI/Components/Pill`), never a `<span>` drawn by hand. The same idea was drawn four
  ways: the Pill, a `StatusBadge` with a gradient and bold text, a menu's `Badge` with a shadow,
  and some three hundred hand-written spans, `rounded-full` in one file and `rounded-md` in the
  next, so one page showed "Active" in two shapes and two greens, and the dark theme handled each
  its own way (#9137). A status chip names its `tone` (`PillTone`), and the Pill works out a text
  shade that reads at 4.5:1 or better on both themes; a colour someone picked (a label's, a
  state's) is passed as `color`. `isDotHidden` draws a tag or a count without the dot, `icon` puts
  an icon in its place, and words too long for the room end in "..." with the whole of them on
  hover. `StatusBadge` is a Pill underneath; `Badge` is only for a count beside a menu's entry, in
  the same tones. Enforced by
  [HandWrittenChipGuard](../../packages/Common/Tests/UI/HandWrittenChipGuard.test.ts).

  | Tone | Use it for |
  | --- | --- |
  | `Success` | It works: Enabled, Connected, Passed. |
  | `Info` | Worth knowing, needs nothing: Running, Scheduled. |
  | `Warning` | Needs a look soon: Expiring, Degraded, Not connected. |
  | `Danger` | It broke: Failed, Offline, Error. |
  | `Paused` | Someone chose to switch it off: Disabled, Paused, Archived. Grey with a hollow dot, never red ([Red is for what broke](#side-menus)). |
  | `Neutral` | A plain fact or a tag: Default, Beta, 3 rules. |
- **Each button style has one job,** and every style `ButtonStyleType` has is in the table below.
  There were six more: a pale indigo `SECONDARY`, a green `SUCCESS` and a yellow `WARNING` and
  `WARNING_OUTLINE` (#9195), then `ICON_LIGHT` and `HOVER_SUCCESS_OUTLINE` (#9296). One page used
  `SUCCESS`, a playbook run's Approve, which is now `PRIMARY`, and nothing used the rest. They were
  more looks for jobs the styles below already do. A new
  style needs a job no style here does, and a row here. Enforced by
  [ButtonStyleTableGuard](../../packages/Common/Tests/UI/Components/ButtonStyleTableGuard.test.ts).

  | Style | Use it for |
  | --- | --- |
  | `PRIMARY` | The one thing the screen or dialog exists to do. At most one in view. |
  | `NORMAL` | A plain action the person came for. A table row or header keeps it in view when its other actions fold into More. |
  | `OUTLINE` | The same plain button, for a lesser action: one a table folds into More first, or one that adds a row to a builder. |
  | `HOVER_PRIMARY_OUTLINE`, `HOVER_DANGER_OUTLINE` | The same plain button in a row of them, tinted under the pointer with what it does: indigo for View or Edit, red for Remove. |
  | `SUCCESS_OUTLINE` | Proving or accepting something: Verify a number or a domain, Accept an invitation, Run Workflow. |
  | `DANGER`, `DANGER_OUTLINE` | Deleting or anything that cannot be undone: filled in its confirmation, outlined beside other actions. |
  | `LINK`, `SECONDARY_LINK` | An action inside a sentence, or a quiet one such as Show more or a picker's Clear. |
  | `ICON` | An icon with no box, named by its aria label. |

  A button that needs more than its style still uses `Button`. It does not need to be drawn by
  hand. `onMouseDown` keeps the focus in a search field above an open list (a label picker's
  Apply). `shortcutHint` puts its keys in a chip after its words (a note's Post). `isTitleHiddenOnPhone`
  hides its words on a phone and keeps them for a screen reader (a composer's Send beside its
  pickers). `dataState` names its state (a player's Play). A `MoreMenu` takes a `Button` as its
  trigger (the paging ladder's first step).

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
- **A folded line never cuts off the choice it names.** Folded on a type it holds, More monitor types
  names it after its words: "More monitor types · Selected: Kubernetes". The choice goes on the
  words' line when it fits, under them, whole, when it does not, and wraps between its words when it
  is wider than a line by itself. It is never cut off with an ellipsis and a tooltip, which a phone
  cannot show. German's "Ausgewählt: Benutzerdefinierter JavaScript-Code" takes two lines on a 390px
  phone, and that is right (#8380). Enforced by
  [FoldedChoiceNamedWholeGuard](../../packages/Common/Tests/UI/Components/FoldedChoiceNamedWholeGuard.test.tsx).

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
- **A metric's description draws its code as code, never as backticks.** The metric catalogs write
  what a person types in backticks ("fanned out by the `status` datapoint attribute"), and the
  VMware, OpenStack and Kubernetes pickers drew them as text, backticks and all. Draw a description
  through `MetricPickerDescription`: each name is code, read from the left on an Arabic or Persian
  page too. A catalog whose descriptions are shown as text anywhere (a criteria line, a chart card, a
  stored metric description) writes its names without backticks. Enforced by
  [MetricDescriptionCodeGuard](../../packages/Common/Tests/App/Dashboard/MetricDescriptionCodeGuard.test.ts)
  and
  [MetricPickerDescriptionCode](../../packages/Common/Tests/App/Dashboard/MetricPickerDescriptionCode.test.tsx).

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
  failure into one of five sentences (`Common/Types/Exception/UnexplainedError`): the server failed,
  the server did not answer, OneUptime could not be reached, the page failed, or what was sent was
  too large (a proxy's 413 page, which read as a failure the server could not explain, #8278, or
  the App's own 50 MB limit, which it answers with that sentence and a 413, #8419); never
  a TypeError's words, a URL or a proxy's page. A form's alert, a list or table that did not load, a dialog and the
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
- **An error drawn on its own is said in the reader's language too.** A line under a button, a red
  paragraph in a card or a tooltip that shows `API.getFriendlyMessage`'s answer draws it with
  `ErrorInSentence` (`showWhereToLook` where it stands alone), or hands it to a place that explains
  it: an `Alert`'s title, `ErrorMessage`, `ErrorLine`, `TableEmptyState`. Drawn as it came
  (`<p>{error}</p>`), a gateway's 502 read "Error connecting to server. Please try again in few
  minutes." in English on a German or a Persian page, and a server failure's reference had no copy
  button (#7537). A message the server wrote in any script is kept as written; only an empty or
  generic one becomes the sentence for a failure nobody explained (#7536). Where no sentence of the
  page's surrounds it, a message that reads the other way from the page (the server's English on an
  Arabic or Persian page) is set apart, so its full stop stays at its end (#8279), and a refusal
  with a value in it is said in the reader's language around its value in every one of these
  places (#8280). Enforced by
  [FriendlyMessageDrawnGuard](../../packages/Common/Tests/App/Dashboard/FriendlyMessageDrawnGuard.test.ts).
- **A dashboard widget says why it has nothing to draw with the one error line,** in the reader's
  words: `DashboardWidgetError` (and its line, `DashboardWidgetErrorLine`), a public dashboard's
  `WidgetPlaceholder`, or a view that draws one of them. Each widget drew it its own way: the set
  sentence in English on every board, pale gray in a 160 or 192px column, or a page's
  `ErrorMessage` with a page's margins (#7330). A widget hands its error on (`error={error}`),
  never draws it as it is, and every sentence it sets as its error is worded in every Dashboard
  language. Enforced by
  [WidgetErrorLineGuard](../../packages/Common/Tests/App/Dashboard/WidgetErrorLineGuard.test.ts).

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
- **A phone's card keeps what the list is read for.** A phone draws each row as a card and leaves
  out the columns marked `hideOnMobile`: labels, owners, a second date. Never the fact people open
  the list for: an incident's card had no severity, beside an alert's that has one, and a maintenance
  event's card never said when it starts (#9011). Enforced by
  [PhoneCardsKeepTriageFactsGuard](../../packages/App/Tests/Dashboard/PhoneCardsKeepTriageFactsGuard.test.ts).
- **A column sorts the whole list by what it shows.** A column that shows one related record sorts by
  it: a severity, a state or a monitor status by its place in the project's list, worst first
  descending, where its first click goes (as the dashboard's list widgets sort it); anything else by
  the name it shows. A column of many records (labels, owners) does not sort (#8134). Enforced by
  [RelationColumnSort](../../packages/Common/Tests/UI/Components/ModelTable/RelationColumnSort.test.tsx).
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
  darker hyphen of its own, so one row could show both marks for the same nothing (#7264). So did
  some six hundred dashes pages wrote by hand: `<span className="text-gray-400">—</span>`, or
  `{team.name || "-"}`, which a phone's card showed as "Team: -" where it leaves every other empty
  field out (#7603, #8209). Draw `<TableEmptyValue />` or `<EmptyValue />` where the dash was
  (`{team.name || <TableEmptyValue />}`, `isSmall` in a line of `text-xs`); a monitor summary's
  fact is handed no value and draws it itself. A page that wants words writes words ("Never", "No
  labels attached."). A stat tile's figure (`text-lg` and up) draws `EmptyFigure`: the same light
  grey dash at the figure's size, read out as "Not set", where tiles drew bare dashes of their own
  in several greys that a screen reader heard as "dash" (#8264). Every tile draws it for a value
  that is missing, blank or a dash, so a tile is handed no value. A formatter never writes a dash
  of its own for nothing (`return "—"`, `host || "-"`): pages drew some five hundred of those
  straight into their cells (#8262). A component that draws a value is handed nothing, and plain
  text (a chart's label, an export, a sentence) gets the shared mark `EMPTY_VALUE_MARK`. A page
  that draws a formatter's text in an element of its own draws it through `getValueOrQuietDash`
  (or `getFigure` in a figure), which turns that mark into the quiet dash. A dash between two
  values, a minus sign and code are not empty values. Enforced by
  [TableEmptyValueDashGuard](../../packages/Common/Tests/UI/Components/Table/TableEmptyValueDashGuard.test.ts)
  and
  [HandWrittenEmptyValueGuard](../../packages/Common/Tests/UI/Components/Table/HandWrittenEmptyValueGuard.test.ts).

### Empty states and suggestions

- **An empty list says "No X yet", what the list is for, and offers its Create button.** Never "No X
  found." with "Refresh?", which reads as a failed load on a new project. A product's own list explains
  the product while the project has none. Enforced by
  [CoreListEmptyStates](../../packages/Common/Tests/App/Dashboard/CoreListEmptyStates.test.tsx).
- **A list's own empty sentence never says "found".** The table heads its empty state with the
  page's `noItemsMessage`, so some fifty Dashboard lists greeted a new project with "No ingestion
  keys found", "No custom domains found" (#9124, #9060). Write "No X yet." and leave what the list
  is for to the card's description, which the empty state takes over, or add the one sentence that
  says when rows arrive ("Pods appear here a few minutes after the agent starts scraping"). A
  search or filter that hides every row is told apart by the table itself. A list that only ever
  shows the answer to a query the reader set (the traces explorer) is listed in the guard with its
  reason. A monitor's Logs says when its first check runs and links to Probes & Interval; its SLOs
  offer Create with the monitor already attached. The Admin Dashboard's lists read their sentence
  from a locale key, so the guard there looks each key up ("No projects found." sat in its locale
  until #9044). Enforced by
  [EmptyListsSayYetGuard](../../packages/App/Tests/Dashboard/EmptyListsSayYetGuard.test.ts)
  and
  [AdminEmptyListsSayYetGuard](../../packages/App/Tests/AdminDashboard/AdminEmptyListsSayYetGuard.test.ts).
- **A search or filter that finds nothing never offers Create.** It says nothing matched. Not
  enforced: use judgement.
- **An empty state says each thing once.** An embedded logs list's empty state has one line from the
  page that embeds it. Enforced by
  [LogsEmptyHintsGuard](../../packages/App/Tests/Dashboard/LogsEmptyHintsGuard.test.ts).
- **A dashboard widget that read and found nothing says so under its icon, as its setup and error
  lines are drawn.** A time range or filters with nothing in them was bare gray-400 words (2.5:1 on
  white) with no icon, so a Log Chart that found nothing looked like no other state on its board
  (#8038). Draw it with `DashboardWidgetEmpty`: the widget's own icon (the one its error shows) over
  one gray-500 line, centred and balanced, in the reader's words. A list or table that keeps its
  column headers draws a no-data row in the same gray (`DASHBOARD_WIDGET_EMPTY_ROW_CLASS_NAME`).
  Enforced by
  [WidgetEmptyLineGuard](../../packages/Common/Tests/App/Dashboard/WidgetEmptyLineGuard.test.ts).
- **A suggestion shows only when it applies,** decided by one helper per kind in
  `Common/Utils/Suggestions`, never in a page. Enforced by
  [SuggestionRulesGuard](../../packages/Common/Tests/App/Dashboard/SuggestionRulesGuard.test.ts).
- **An empty state takes the room of where it sits, from a preset.** `EmptyState` takes `size`:
  `EmptyStateSize.Inline` in a panel, a form's step or a short list inside a card, `Card` (the
  default) for a card's or a list's body, `Page` for a page with nothing else on it. It used to pad
  itself by 13rem above and below, so in a card on a 390px phone "No X yet" began a quarter of the
  way down the screen; pages then passed a dozen paddings of their own, and two wrapped it in
  negative margins to take the room back (#9135). Never hand it a padding or pull it back with a
  margin: pick the preset. Enforced by
  [EmptyStateSizeGuard](../../packages/Common/Tests/UI/Components/EmptyState/EmptyStateSizeGuard.test.ts).

### Loading

- **Nothing jumps when content arrives.** A page's content area loads as a card-shaped skeleton
  where its first card will be (`PageSkeleton`, drawn by `Page` and every `ModelPage`); a table
  draws its rows' skeleton, a list its items', a detail card its fields'. A page used to draw a
  thin bar 208px down an empty area and a card one of three bars in two greys at three heights, so
  the page moved under the reader as each card filled in (#9135). A bar that is still drawn is the
  shared one, `LOADER_COLOR` (gray-500), centred in `LOADER_BOX_CLASS_NAME`, a box as tall as an
  empty card: `PageLoader` and `ComponentLoader` draw it, so a card that loads into "No X yet"
  keeps its height. No screen pushes its content 13rem down (`mt-52`, `pt-52`). A bar for an action
  in progress (a test being sent) is drawn in the action's colour, listed in the guard with its
  reason. Enforced by
  [LoadingStatesGuard](../../packages/Common/Tests/UI/Components/Loader/LoadingStatesGuard.test.ts).
- **A card that loads its own data draws the shape it will have, not a bar.** Prefer the shared
  components (a table, a list, a detail card), which already do. A card drawn by hand draws the
  shared skeleton of its content: `PageSkeleton` for a page's content area (`shape="table"` or
  `"chart"` when the page opens with one), `TableSkeleton` for rows, `DetailListSkeleton` for names
  and values, `ChartSkeleton` for a chart (at the chart's height), `StatTilesSkeleton` for a row
  of figures (in the tiles' own grid), `CardListSkeleton` for a list of cards,
  `InlineValueSkeleton` for a value inside a field (a row of pills, a name) and
  `AuthPageSkeleton` for a sign-in page's column and card. Each is a busy
  status named "Loading" that pulses only without reduced motion. `PageLoader` and
  `ComponentLoader` drew one grey bar whatever the card would show, so a card that loaded into rows
  or a chart still grew when they arrived (#9220). A spinner that shows an action in progress (a
  key being touched, a query being run, a session ending) is not content loading: it keeps its
  loader and is listed in the guard with how many it draws and why. Every other `PageLoader` and
  `ComponentLoader` is gone. Enforced by
  [LoadingStatesGuard](../../packages/Common/Tests/UI/Components/Loader/LoadingStatesGuard.test.ts),
  whose baseline of hand-drawn loaders (`HandDrawnLoadersBaseline.json`) is empty: a new one fails.

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
- **An action that changes something says it worked, without blocking the page.** A save, a
  create, a delete or a test that went out says so in a toast (`Toast.success`,
  `Common/UI/Utils/Toast`), which goes by itself; a failure says so in an error toast or a dialog,
  and stays until it is closed. The shared model components already do it: a card's Edit says
  "Changes saved", a list says "Nightly Backup deleted". Before, a change said nothing, or opened a
  dialog to click away: "Saved", "Runbook steps saved successfully.", Got it (#9120). A dialog with
  one way out (a `ConfirmModal` without `onClose`) stays only for what the person must read or act
  on: what failed, a value shown once, a run's report, details they opened. Enforced by
  [SuccessDialogsGuard](../../packages/Common/Tests/UI/SuccessDialogsGuard.test.ts).
- **Leaving unsaved work asks first.** While a page holds work it has not saved (a dashboard being
  edited), a step to another page waits for its answer: a link, the side menu, the breadcrumbs, a
  button, the project picker, the browser's Back and Forward. Closing or reloading the tab asks with
  the browser's own dialog (`useLeaveGuard`, #7173). With nothing unsaved, nothing asks. Every
  editor asks with one question, `LeaveWithoutSavingQuestion`, and hands it its own save: Save
  Changes saves, then goes on only once the save worked, and a refusal keeps the person on the
  page, still asked, and says why; Keep Editing, where the focus starts, stays; Discard Changes
  goes on without saving. The Layers page drew a copy of its own (#7973), and keeping your work
  took Keep Editing, the page's Save and the link again (#7402). While it holds unsaved work, the
  page says so where its title is: a dashboard's toolbar says Unsaved changes (#7403). Enforced by
  [LeaveGuard](../../packages/Common/Tests/UI/Utils/LeaveGuard.test.ts),
  [UseLeaveGuard](../../packages/Common/Tests/UI/Utils/UseLeaveGuard.test.tsx),
  [NavigationLeaveGuard](../../packages/Common/Tests/UI/Utils/NavigationLeaveGuard.test.ts),
  [LinkLeaveGuard](../../packages/Common/Tests/UI/Components/LinkLeaveGuard.test.tsx),
  [AppLinkLeaveGuard](../../packages/Common/Tests/App/Dashboard/AppLinkLeaveGuard.test.tsx),
  [ProjectPickerLeaveGuard](../../packages/Common/Tests/UI/Components/ProjectPickerLeaveGuard.test.tsx)
  and
  [LeaveWithoutSavingQuestionGuard](../../packages/Common/Tests/App/Dashboard/LeaveWithoutSavingQuestionGuard.test.ts).

### Help dialogs

A list's help (?) and a product's "how it works" guide open one dialog, `HelpModal`
(`Common/UI/Components/Help`): what the thing is in short, then its topics, each opened on its own,
with its documentation one click away and "Was this clear?" under it (#8889). "How SLOs Work" was a
page of markdown as wide as the screen, six headings and a rule between each, with nothing to say
what was further down.

- **A help document says what the thing is first, then its topics.** Its lead, one to three
  sentences, is what everybody reads, and the dialog shows it as "In short"; each `##` heading is a
  topic the dialog lists, and the one a person needs to act comes first. No heading repeats the
  dialog's title, and nothing draws a line between the topics: the dialog sets them apart itself.
  Write it in `HelpContent`'s shape, on the page or with a shared builder (`Utils/Help/ResourceRuleHelp`
  writes every resource's label and owner rule help). Enforced by
  [HelpDialogsGuard](../../packages/Common/Tests/App/Dashboard/HelpDialogsGuard.test.ts).
- **Help says what the product does, checked against the code.** When a rule runs, what it changes,
  what it never does, and the words the form shows ("Which Incidents", "More fields"): the help that
  listed three log processors of five, or a severity no filter can match, sent people the wrong way.
  Not enforced: use judgement.
- **Help about a form describes the form, never a syntax it cannot take.** Logs and Traces pick
  records with a filter builder of dropdowns, and their help taught a query language nobody could
  type there (`kind = 'SPAN_KIND_CLIENT' AND statusCode != 2`, status codes `0`, `1` and `2`). It
  now writes a condition as the builder draws it, "**Span Name** · contains · `healthcheck`", with
  a value the builder lists by its label (**Error**, not `2`) (#9133). Enforced by
  [TelemetryFilterHelpGuard](../../packages/App/Tests/Dashboard/TelemetryFilterHelpGuard.test.ts).

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
- **A chart's title is the one thing its row must say.** The zoom hint beside it is the shared
  `TimeRangeZoomHint`, never drawn on a phone's width or on a screen that is only touched, where no
  finger drags or double-clicks, and a title row wraps, so a hint that does not fit beside the title
  goes under it. A Russian hint that never gave way cut the Kubernetes Control Plane's etcd titles to
  "Размер…" on a 390px phone (#8048). The hint's words keep a length budget in every language.
  Enforced by
  [ChartTitleRowZoomHint](../../packages/Common/Tests/UI/Components/Charts/ChartTitleRowZoomHint.test.tsx),
  [ChartTitleRowTailwind](../../packages/Common/Tests/UI/Components/Charts/ChartTitleRowTailwind.test.tsx)
  and
  [ZoomHintWordsFitBesideATitle](../../packages/Common/Tests/App/Dashboard/ZoomHintWordsFitBesideATitle.test.ts).
- **A details card lays its fields out by its own width,** not by a share of the page's. Enforced by
  [DetailCardsSourceGuard](../../packages/Common/Tests/UI/Components/Detail/DetailCardsSourceGuard.test.ts)
  and
  [MonitorSummaryViewsLayoutGuard](../../packages/App/Tests/Dashboard/MonitorSummaryViewsLayoutGuard.test.ts).
- **Text people read is readable: at least 4.5:1.** A label, a description, a value, a hint or a
  timestamp is `text-gray-500` or darker (`text-gray-600` for body text), and `text-xs` (12px) or
  larger for small print. 11px (`text-[11px]`) is kept only for a short label whose shape carries
  it: an eyebrow in capitals (`uppercase`), or a chip, a badge or a key that frames its word (rounded,
  on a ground or in a border of its own; a `kbd`), still at 4.5:1. A hint, a value, a count or a
  sentence at 11px is `text-xs`, and nothing is smaller than 11px. `text-gray-400` is 2.5:1 on white
  and `text-gray-300` 1.5:1: the logs'
  saved views said "No saved views yet." in it, a More menu's section headings, a drop filter's "Not
  configured" and an on-call schedule's "No upcoming shifts" were all drawn in it (#9127). The dark
  theme paints gray-400 and gray-500 the same, so the change holds there. gray-400 stays for what
  nobody reads as words: an icon beside a label, a separator, a placeholder, a disabled control, and
  the quiet empty-value dash. The guard reads every app, and a class held in a const of the same
  file (#9192). Enforced by
  [ReadableTextContrastGuard](../../packages/Common/Tests/UI/ReadableTextContrastGuard.test.ts).
- **Banners are for exceptions the person must act on,** never for the default state. Enforced by
  [NoAlwaysOnInfoBannersGuard](../../packages/App/Tests/Dashboard/NoAlwaysOnInfoBannersGuard.test.ts).
- **A button that cannot be pressed looks it,** the same way everywhere: faded, with the not-allowed
  cursor. Enforced by
  [HandDrawnButtonLockedLookGuard](../../packages/Common/Tests/UI/HandDrawnButtonLockedLookGuard.test.ts).
- **A button that adds a row to a builder never looks like the form's action.** Add condition, Add
  filter and Add row put one more line into what the person is building; the form's own action is
  elsewhere. Draw them as outline buttons (`ButtonStyleType.OUTLINE`), never filled or tinted: a
  rule's Applies to step drew Add condition in tinted indigo, the one coloured button on a screen
  whose Next is not primary, and it read as the dialog's main action (#9116). Enforced by
  [AddRowButtonsNotPrimaryGuard](../../packages/Common/Tests/UI/Components/AddRowButtonsNotPrimaryGuard.test.ts).
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
- **Signing in is "Sign in" and signing out is "Sign out", never "log in", "login" or "log out".**
  One flow once said "Log Out" in the status page's nav, "Log out" and "Sign Out" in the Dashboard,
  and "Please login again" from the server (#9212). Now it is **Sign Out** in every menu, and
  "Session expired. Please sign in again." A database's or another system's "login" (a credential),
  "logged in this window" (written to a log) and another product's own label stay, each listed with its
  reason. Enforced by
  [SignInWordsGuard](../../packages/Common/Tests/App/SignInWordsGuard.test.ts), which reads every
  front end's English locale, the server's sign-in messages, the mobile app's labels and the bold
  labels in the English docs.
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
- **A permission is named after the record it guards.** A feed's permissions read "Create Incident
  Feed" and "Read Scheduled Maintenance Feed", as the feed calls itself, so a search of the permission
  picker for "feed" finds every one, and a refusal names the same thing the permission does. They
  read "Scheduled Maintenance Log" until #8451. Enforced by
  [FeedPermissionTitles](../../packages/Common/Tests/Types/FeedPermissionTitles.test.ts).
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
- **A card's description says what the card or list is for,** not "Here is a list of…". A details
  card whose title says it all ("Project", "Team Details") has no description, not "Project
  details" or "Details about this team.". The guard reads the Admin Dashboard's English locale too,
  where its pages keep their words. Enforced by
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
  port or a Kubernetes quantity ("500m") is drawn as written. A figure a helper wrote in English
  ("2.5k", "3.5 TiB") is put in the reader's language with `writeFigureInLanguage`, its scale letter
  and unit kept. Checked on the Host and Kubernetes pages, on a database's Runtime charts, on the
  Storage Arrays pages (a volume read "۳٫۵ TiB" on a dashboard and "3.5 TiB" on its page, #8272) and
  on a status page's uptime ("99.95٪ زمان کارکرد", #8292). The telemetry helpers (`formatCompact`,
  `formatPercent`, `formatBytes`) take the reader's translator, and every Overview tile passes it: a
  service's, a function's, a site's and a cloud app's Requests, Error rate and Memory read "1.2k" in
  Latin digits beside a p95 tile in Persian (#8481). A figure's unit word is the reader's too: a
  database's and a queue's engine metric tile counts in a plural sentence of the locale, its noun
  agreeing with the number by the language's rules ("1 Verbindung", "24 Verbindungen",
  "۲۴ اتصال"), never "۲۴ connections" (#8482). Enforced by
  [HostOverviewFiguresInPersian](../../packages/Common/Tests/App/Dashboard/HostOverviewFiguresInPersian.test.tsx),
  [KubernetesOverviewFiguresInPersian](../../packages/Common/Tests/App/Dashboard/KubernetesOverviewFiguresInPersian.test.tsx),
  [DatabaseRuntimeChartsInReadersLanguage](../../packages/Common/Tests/App/Dashboard/DatabaseRuntimeChartsInReadersLanguage.test.tsx),
  [StorageArrayPageFiguresInReadersLanguage](../../packages/Common/Tests/App/Dashboard/StorageArrayPageFiguresInReadersLanguage.test.ts),
  [TelemetryOverviewTileFiguresInReadersLanguage](../../packages/Common/Tests/App/Dashboard/TelemetryOverviewTileFiguresInReadersLanguage.test.tsx),
  [EngineMetricTileUnitsInReadersLanguage](../../packages/Common/Tests/App/Dashboard/EngineMetricTileUnitsInReadersLanguage.test.ts)
  and
  [StatusPageUptimeFiguresInLanguage](../../packages/Common/Tests/App/StatusPage/StatusPageUptimeFiguresInLanguage.test.ts).
- **A chart's value axis, its legend and its tooltip write a figure as the tiles beside it do:** in
  the reader's digits, decimal sign and percent sign, as its time axis always has. A duration in
  milliseconds is `formatMilliseconds` with the reader's translator and a longer or shorter one
  `formatDurationInUnit` ("۴۲ میلی‌ثانیه", "1,50 Sek."); a metric's unit goes through `ValueFormatter`
  with the reader's language, which writes a unit by its symbol ("23,5 °C", "50 Hz", "1,5 MB/s"),
  never its English name; a count keeps its scale letter ("1,5K", `formatChartCount`); a metric
  query's own `yAxisValueFormatter` writes English, and the metric chart words it
  (`writeFigureInLanguage`), as it does the resource pages' byte and rate charts (#8428). The value
  axis is as wide as its widest tick: the shared charts measure it, and a chart drawn with recharts
  asks `getYAxisWidthForValuesInPx`, which counts no mark that is never drawn. A Persian chart's
  time axis was in Persian digits and the tile above it said "۴۲ میلی‌ثانیه", while its value axis
  and tooltip said "42 ms" in English on purpose, and a German metric chart read "23,5 Celsius"
  (#8349, #8284). Only the AI chat's PDF export writes English (`formatMillisecondsInEnglish`): its
  Latin-1 font holds no Persian digit. The words stay where there is room for them: the unit chip
  and the metric's details. Enforced by
  [ChartValueAxesInReadersLanguageGuard](../../packages/Common/Tests/UI/ChartValueAxesInReadersLanguageGuard.test.ts),
  whose list of charts still to write only shrinks, and
  [ChartFiguresInReadersLanguage](../../packages/Common/Tests/App/Dashboard/ChartFiguresInReadersLanguage.test.ts).
- **A rate on a chart keeps its slash:** "100 req/s", as "1.5 MB/s" always read, on the value axis,
  in the legend and in the tooltip, and the value axis is as wide as its widest tick. Written out,
  "100 req per Second" broke over two lines on a 64px axis and was cut at the card's edge, with
  "Second" in English in every language (#8049). The words stay where there is room for them, in
  the reader's language: the unit chip and the metric's details. Enforced by
  [RateUnitsOnChartAxes](../../packages/Common/Tests/UI/Components/Charts/RateUnitsOnChartAxes.test.tsx).
- **A negative number in a right-to-left sentence takes the language's own minus:** in Persian a
  left-to-right mark and a minus sign (U+2212) before the digits, in Arabic the word
  ([ARABIC.md](../../packages/App/FeatureSet/Dashboard/src/Locales/ARABIC.md)),
  never a hyphen that a right-to-left line moves after the number. Enforced by
  [NegativeNumbersInRightToLeftSentences](../../packages/Common/Tests/App/NegativeNumbersInRightToLeftSentences.test.ts).
- **A date is written by `OneUptimeDate` in the reader's language,** never put into an English
  template literal. Enforced by
  [DatesInEnglishTextGuard](../../packages/App/Tests/Dashboard/DatesInEnglishTextGuard.test.ts).
- **A time of day writes its hour the way its clock does:** no zero on a 12-hour clock ("5:14 AM",
  "오전 5:14", "5:14 ص"), the zero on a 24-hour one ("05:14"), in every component and the mobile app.
  A feed and a status timeline read "5:14" in German beside a table's "05:14" (#7649), and the
  mobile app "Nov 5, 05:14 AM" (#7650). An Intl options object asks `getHourOption` for its hour
  (`Common/Types/DateLanguage`, or the mobile app's own in `src/utils/date`), or
  `getLocaleClockHourOption` for a language's own clock, and names `"numeric"` or `"2-digit"` only
  beside the clock it is right on. Enforced by
  [TwelveHourClockLeadingZeroGuard](../../packages/Common/Tests/Types/TwelveHourClockLeadingZeroGuard.test.ts)
  and
  [TwentyFourHourClockLeadingZeroGuard](../../packages/Common/Tests/Types/TwentyFourHourClockLeadingZeroGuard.test.ts).
- **A date and a time are the reader's, never the browser's:** in the zone they picked in User
  Settings, on their 12- or 24-hour clock, written by `OneUptimeDate` or
  `Common/UI/Utils/ReaderMoments` (a moment, a day, a time of day). `toLocaleString`,
  `toLocaleDateString` and `toLocaleTimeString` with no options write the browser's zone and the
  language's own clock, with seconds: Topology's "Last refreshed" read "05:14:00" in the browser's
  zone beside a table's "5:14 AM" in the zone the reader picked (#8231). Enforced by
  [DatesOnTheReadersClockGuard](../../packages/Common/Tests/Types/DatesOnTheReadersClockGuard.test.ts).
- **A chart of days names whose days they are when they are not the reader's:** an Ask AI chart is
  a snapshot, cut in the asker's zone or in UTC, and read later anywhere, so it draws each day where
  it counted and says "Days are in America/New_York." A New York day sat under the day before in Los
  Angeles (#8206). Enforced by
  [AskAiChartDaysWhereTheyWereCut](../../packages/Common/Tests/App/Dashboard/AskAiChartDaysWhereTheyWereCut.test.tsx).
- **A date and time people fill in shows and keeps hours and minutes, never seconds.** Add User
  Override's Starts read "13/11/2026 11:15:52", and nobody schedules a shift to the second (#7593).
  Draw the field with the shared Input. Only a field read against telemetry's own timestamps, like a
  time range's From and To, opts in to seconds (`showSecondsForDateTime`), with its reason listed.
  Enforced by
  [MinutePickersGuard](../../packages/Common/Tests/UI/MinutePickersGuard.test.ts).
- **A duration in milliseconds is written in the reader's language,** with the Dashboard's
  `formatMilliseconds` ("{{value}} ms", each language's own unit and order, the figure in the
  reader's digits), never a figure joined to " ms" or written before "ms" in a template or JSX:
  every monitor's Response Time read "ms 411" on an Arabic or Persian page (#7224), and a trace's
  p95 "۱۲٫۴ ms" (#7418). `minimumFractionDigits` keeps the decimals toFixed wrote, `showsSign` an
  offset's sign. Its other units are `formatDurationInUnit` (microseconds, seconds, minutes,
  hours, days, each language's own short unit), never `${x} s`, `${x}µs`, `${x}ns` or `${x} min`
  by hand: a Persian row read "1.25 s" under "۴۲ میلی‌ثانیه" (#8348). A chart's value axis and its
  tooltip write it so too; only the AI chat's PDF export writes it in English
  (`formatMillisecondsInEnglish`). A compact duration ("12s", "4m 05s", "2d 5h", "3mo") is
  `formatCompactDuration`, and an age ("5m ago") `formatCompactDurationAgo`: the Dashboard's compact
  keys, worded by every language, each figure in the reader's digits ("۴ دقیقه ۰۵ ثانیه"), never
  `${diffSec}s`, `${minutes}m ${rest}s` or `{minutes}m {seconds}s` by hand - a Kubernetes object's
  age, an uptime and an SLA's countdown read English letters and Latin digits on every page
  (#8455). A span's humanized duration (`getHumanizedDurationFromNanoseconds`) and the on-call
  schedule timeline's lengths (`ScheduleTimelineLayout.formatDuration`) take the reader's
  translator for the same reason (#8617). A token the code parses back or a file's name keeps its compact English, listed with its
  reason. Enforced by
  [MillisecondsInReadersLanguageGuard](../../packages/Common/Tests/UI/MillisecondsInReadersLanguageGuard.test.ts).
- **A number keeps its unit on its line.** English writes "Uptime ({{hours}}h)", German
  "Verfügbarkeit ({{hours}} Std.)", and on a phone the network site hero's title broke as
  "Verfügbarkeit (24" over "Std.)" (#8043). Wherever the English writes a number beside a unit's
  symbol ("{{minutes}} min", "{{percent}}%", "24h"), the space a translation puts after that number
  is drawn as a no-break space (`withNumbersKeptWithUnits` in `Common/Types/NoBreakSpaces`), and so
  is the space English itself writes there ("Every 5 min", #8302). A unit a language writes in two
  words, Arabic's "ملي ث", is held together after its number too (#8304). Write the unit as its
  symbol after the number in the English, so the rule finds it. Code that joins a figure and a unit
  itself joins them with a no-break space (`` `${size}\u00A0MB` ``, #8303), or goes through a key
  as `formatMilliseconds` does, and so does code that holds the unit in a variable or a property
  (`` `${figure}\u00A0${reading.unit}` ``, `ValueFormatter`, `Common/Types`, #8457) or writes them
  as JSX text (`` {`${figure}\u00A0dBm`} ``, in the Admin Dashboard, the Status Page and the
  server's forms too, #8720): a holder
  named `unit` or `symbol` holds a unit's symbol, and a word is named for what it holds (`word`,
  `noun`, `unitName`) and keeps its plain space ("2,340 groups"), unless it is a duration's word
  (below). Text that is no page's - a prompt, a Markdown export, a stored name, an API's answer
  the docs quote - keeps its plain space, listed with its reason, and a CSV export writes a plain
  one (`TableColumnsToCsv`). Intl writes a plain space there too ("5 Min.", "vor 5 Minuten", "2
  Tage, 3 Stunden", #8456), so ask Intl for a unit or a relative time only through
  `Common/Types/DateLanguage` (`formatDurationUnit`, `formatDurationText`, `formatUnitAmount`,
  `getUnitAmountParts`, `formatRelativeAmount`), which holds the number to its unit in every
  language, English included, and keeps French's own no-break spaces; never with `style: "unit"`
  or `Intl.RelativeTimeFormat` yourself. English OneUptime writes in words holds its number too
  ("5 hours ago", "1 min 47 secs", "10 days, 23 hours", #8669): code joins a figure to a
  duration's word with `NO_BREAK_SPACE` (`` `${count}${NO_BREAK_SPACE}minutes` ``), and English it
  did not join itself, such as moment's, goes through `withDurationWordsHeld`. So does a sentence
  built in code (#8695): "Rescan Interval must be at least 15 minutes.", "Every 6 hours", a guide's
  "the last 10 minutes", and a word chosen by its count (`` `${n} ${n === 1 ? "hour" : "hours"}` ``).
  A sentence looked up whole by its English keeps its plain spaces in the code, so the key still
  matches, and the page holds the English it draws (`withDurationWordsHeld`). A duration's word
  is a unit to the Translator too (#8770): wherever the English writes a number and a space before
  one ("Every {{count}} minutes", "between 15 minutes and 14 days"), each language's wording holds
  the figure to whatever word it names the unit with ("Alle 5 Minuten"), and so does a page's
  English (a translator made with `drawsOnPage`, as the front ends' are). English that may become a
  record's text - the server's, or a translator no page made - holds a unit's symbol only, so what
  is stored still matches what reads it back by its English; a sentence that becomes a value - the
  name a form fills in - is written with plain spaces (`withPlainSpaces`). English drawn without a
  page's translator holds it too (#8811): a module's own English fallback that draws is a page's, an
  English key drawn as written holds its figure (a page's `translateText`, `useTranslateValue`),
  and so does an email's English - a mail client draws a no-break space as a browser does
  (`getServerTranslator(language, { readByAPerson: true })`). Danish and Norwegian hold a count
  written as an ordinal too ("Hvert 5. minut"). A helper handed the word
  (`plural(count, "minute", "minutes")`, `pluralize(count, "day")`) holds what it writes on a page
  (`withDurationWordsHeld`, #8823), and a unit's symbol a formatter writes beside a figure is held
  however short it is: a disk's "12.5 ms", "ops/s", a transceiver's "V" and "mA" (#8803), an
  amount of money ("20 USD") and a span's English duration ("12 ms", #8826); a CSV cell and a log
  line keep their plain space. Enforced by
  [NumbersKeepTheirUnitsGuard](../../packages/Common/Tests/App/NumbersKeepTheirUnitsGuard.test.ts),
  [NumbersKeepTheirUnitsInCodeGuard](../../packages/Common/Tests/App/NumbersKeepTheirUnitsInCodeGuard.test.ts),
  [NumbersKeepTheirUnitsInIntlGuard](../../packages/Common/Tests/App/NumbersKeepTheirUnitsInIntlGuard.test.ts),
  [DurationWordsHeldInSentences](../../packages/Common/Tests/App/DurationWordsHeldInSentences.test.ts)
  (a sentence built in code, #8695),
  [TranslatedDurationWordsHeld](../../packages/Common/Tests/App/TranslatedDurationWordsHeld.test.ts)
  (a wording and a page's English, #8770),
  [TranslationHoldsEnglishDurations](../../packages/Common/Tests/UI/Utils/TranslationHoldsEnglishDurations.test.tsx)
  (an English key a page draws as written, #8811) and
  [PageEnglishDurationsHeld](../../packages/App/Tests/Notification/PageEnglishDurationsHeld.test.ts)
  (a module's own English fallback, and an email's English, #8811).
- **A probe's message on a monitor's summary reads in the reader's language.** The probe stores why
  a check failed in English, and the summaries drew it as it came: "Request was tried 3 times and
  it timed out." stayed English on every page, and on an Arabic or Persian page an English message
  lost its full stop and its brackets to the line's other end (#7422, #7424). The timeout sentence,
  its count in the reader's plural forms, is written only by its template
  (`Common/Utils/Monitor/ProbeFailureReading`), and so is what a failed request means, its Error
  Details ("DNS resolution failed. ...", `Common/Utils/Monitor/RequestFailureDescriptions`, #8001),
  and so is every cause with values in it (`Common/Utils/Monitor/ProbeFailureCauses`): an NTP
  server that did not answer, or answered but is not synchronized; a probe with no IPv6 or no
  route; a connect that failed on every address; the Ping and Traceroute checks' own sentences; an
  attempt's "Server returned 503" (#8267, #8656). Their values stay as the probe found them, and a
  timeout or a count is written in the reader's digits. A summary draws a probe's message with
  `ProbeMessageLine`, which words those sentences and keeps any other message whole in a
  right-to-left line, and so do a network device's diagnostics (a ping's Reason, a traceroute's
  note, #8675). An incident's root cause words its figures the same way: a response time, the
  attempts and an NTP server's facts in the reader's digits and units (#8268), and a metric
  criteria's Time Window, Data Arrives and Forecast lines with a duration as the reader's
  language says one in a sentence (#8674). A Database
  Health check's collection issues read
  the same way (`Common/Utils/Monitor/DatabaseCollectionIssueReading`, #8609): the group by its
  Metric Groups switch's name, OneUptime's own sentence in the reader's words, and a database's own
  error kept as written after a sentence that says what kind of failure it is. Enforced by
  [ProbeMessagesInReadersLanguageGuard](../../packages/Common/Tests/UI/Monitor/ProbeMessagesInReadersLanguageGuard.test.ts)
  and
  [DatabaseCollectionIssuesInReadersLanguage](../../packages/Common/Tests/App/Dashboard/DatabaseCollectionIssuesInReadersLanguage.test.tsx).
- **A chart of one point a day labels its axis by the day** (`xAxisPrecision={XAxisPrecision.EVERY_DAY}`),
  never by an hour or a step guessed from the window's length. Enforced by
  [ProductAnalyticsDayAxisGuard](../../packages/Common/Tests/App/Dashboard/ProductAnalyticsDayAxisGuard.test.ts).
- **A whole sentence is translated, never a word at a time.** Word by word, German read "Nein monitors
  yet", and a sentence joined from translated pieces keeps English's order, punctuation and digits
  whatever each piece says: every table row's ⋯ button read "More actions for" and then the row's
  name, where Japanese puts the name first, and the Correlate builder's "Remove condition 2" kept a
  Latin 2 on a Persian page (#8076). A sentence with a value in it is one key with a
  `{{placeholder}}` (`translateTemplate("Remove condition {{number}}", { number:
  translator.formatNumber(index + 1) })`), a `translatePlural` for a count, or a `TranslatedSentence`
  around an element. Two whole sentences side by side, a label that carries its own colon and its
  value, facts set apart by " · ", a path and an aside in brackets are no sentence built from
  pieces. The same goes for JSX: `{t("Showing")} {n} {t("of")} {total}` read "Page 2 of 5" in
  English's order in Japanese, and a status page's "posted on" sat before its date in every
  language (#8290). A label whose colon the code wrote (`{t("Capabilities")}:`) takes it from a key
  instead, `LABEL_WITH_COLON` ("{{label}}:", "Statut :" in French, "状态：" in Chinese). A sentence
  around an element is one too: a pill, a name, a date, a bold count, or a link around a phrase
  (`{t("Read the")} <Link>{t("docs")}</Link>`) goes in a `TranslatedSentence` slot, and so do words
  only a screen reader reads ("Connect" before a product's name, "AWS Security Hub verbinden" in
  German). The status page's "Incident state changed to" and its state's pill kept English's
  order until #8290, and the schedule timeline's bold counts sat before "covered now" (#8483). An
  icon, a badge after its word, a block, a link to act on after a sentence ("Read the guide") and
  what is drawn for the eye only are no word of a sentence. Enforced by
  [SentencesFromTranslatedPiecesGuard](../../packages/Common/Tests/UI/SentencesFromTranslatedPiecesGuard.test.ts),
  which reads template literals, `+`, `join()` and an element's children, each child element as
  what it draws, and follows a name that holds a translation (`const label = t("Key")`), a page's
  own translation helper (`text(COPY.openSettings)`), a lookup in a constant table and a nested
  key's English. A colon written after an element that holds a label
  (`<span>{t("Logo Alt Text")}</span>{": "}`) is English's too, and comes from `LABEL_WITH_COLON`
  (#8571); an element's key or id is never read, and is no sentence.

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
  [DashboardSloTopologyWorkspaceHardcodedGuard](../../packages/App/Tests/Dashboard/DashboardSloTopologyWorkspaceHardcodedGuard.test.ts),
  [DashboardTraceViewHardcodedGuard](../../packages/App/Tests/Dashboard/DashboardTraceViewHardcodedGuard.test.ts),
  for the service map and the infrastructure explorer, whose cards built "3 active incidents"
  and "10.0% errors" in English at run time (#7725),
  [TopologyScreensWordsGuard](../../packages/App/Tests/Dashboard/TopologyScreensWordsGuard.test.ts),
  for the import screens (the label rule import, the CSV upload, the JSON import's editor,
  Network's Auto Import Rules) and the docs that name their buttons,
  [ImportScreensInEveryLanguage](../../packages/App/Tests/Dashboard/ImportScreensInEveryLanguage.test.ts),
  for the metric query form (the metric picker, its attribute filter, the series and group
  colour pickers, a formula's row), which was English in twelve languages (#8310),
  [MetricQueryFormInEveryLanguage](../../packages/App/Tests/Dashboard/MetricQueryFormInEveryLanguage.test.ts),
  for a tab's name however a page builds its tabs (`const tabs: Array<Tab> = [...]`), which
  the extraction missed, so "Env Vars" on a pod read English in every language (#8367),
  [TabNamesAreKeys](../../packages/App/Tests/Dashboard/TabNamesAreKeys.test.ts),
  for every word of a built-in workflow step (its card, its settings form, its Outputs and
  Returns lists), which read English in most languages because the step catalogue was never
  extracted (#8359),
  [WorkflowStepWordsInEveryLanguage](../../packages/App/Tests/Dashboard/WorkflowStepWordsInEveryLanguage.test.ts),
  for a monitor's type and a security event's severity wherever they are drawn as text (#8294,
  #8295),
  [MonitorTypeAndEventSeverityInReadersLanguage](../../packages/Common/Tests/App/Dashboard/MonitorTypeAndEventSeverityInReadersLanguage.test.tsx),
  for a picker's label with an English word glued on, an archived SLO's "(archived)" and an
  unnamed ingestion key's "Unnamed Key" (#8297),
  [PickerLabelsInReadersLanguage](../../packages/Common/Tests/App/Dashboard/PickerLabelsInReadersLanguage.test.tsx),
  for the topology screens' "Unnamed resource", a browser service's "Browser" and the entity
  drawer's screen-reader line (#8260),
  [TopologyUnnamedBrowserAndDrawerInLanguages](../../packages/Common/Tests/App/Dashboard/TopologyUnnamedBrowserAndDrawerInLanguages.test.tsx),
  and, for the Admin Dashboard's own pages (Feedback, Health, the SMS and call provider, global SSO),
  whose 186 texts had no entry in its locales and read English in every language (#8227),
  [AdminOwnPagesStringsLocales](../../packages/App/Tests/AdminDashboard/AdminOwnPagesStringsLocales.test.ts),
  with the texts those pages drew as written, which no lookup read (#8555),
  [AdminOwnPagesDrawnAsWrittenGuard](../../packages/App/Tests/AdminDashboard/AdminOwnPagesDrawnAsWrittenGuard.test.ts),
  and the sentences the extractor could not see there, kept in a variable or handed to a prop it
  does not know (#8636),
  [AdminUnseenTextsGuard](../../packages/App/Tests/AdminDashboard/AdminUnseenTextsGuard.test.ts).
- **A filter or a rule is summed up one sentence per condition, in the reader's language.** The
  filter bar's chip, a metric query's chips and a chart's details drew an attribute filter's
  operator as its English symbol between the key and the value ("http.route matches /api/*" under a
  German form that said "stimmt überein"), and every rule table's Match Criteria glued `IP Address is
  in "10.16.0.0/16"` in English, its quotes jumping on a Persian page (#7931, #7958). Draw an
  attribute filter with `DictionaryFilterSentence` and a rule with `RuleCriteriaSummary`: each
  condition is one sentence with its field and value as slots, the value set apart as typed, inside
  the language's own quotes; an operator that is a symbol (=, >) stays one. A log monitor's criteria
  chips and a monitor's detail page said "contains web" in every language through
  `formatDictionaryValueForDisplay`, which glues the operator's English label before the value
  (#8309): a locked chip whose filter holds an operator carries its stored value (`filterValue`) and
  says the sentence, and the detail page is handed the filters as stored. That formatter's text is
  a key, never a line a person reads. A monitor's criteria list words each filter the same way,
  every part of it a sentence of the locale around the part it holds: it read `Check if "Response
  Time (in ms)" is greater than 500ms and,` under a Persian form (#8350). Whether all of the filters
  must match or any one is said once, above them, never as an "and," left at the end of each line
  (#8533). And an empty dropdown
  says so in the reader's words ("No matches found", "No options available"), never react-select's
  English "No options" (#7805). Enforced by
  [AttributeFilterSymbolGuard](../../packages/Common/Tests/UI/Components/AttributeFilterSymbolGuard.test.ts),
  [AttributeFilterSentencesInEveryLanguage](../../packages/Common/Tests/UI/Components/AttributeFilterSentencesInEveryLanguage.test.tsx),
  [LockedFilterChipSentencesInReadersLanguage](../../packages/Common/Tests/UI/Components/LockedFilterChipSentencesInReadersLanguage.test.tsx),
  [MetricAttributeFiltersInReadersLanguage](../../packages/Common/Tests/App/Dashboard/MetricAttributeFiltersInReadersLanguage.test.tsx),
  [RuleCriteriaSummary](../../packages/Common/Tests/UI/Components/RuleCriteria/RuleCriteriaSummary.test.tsx),
  [CriteriaFilterSummaryInLanguages](../../packages/Common/Tests/App/Dashboard/CriteriaFilterSummaryInLanguages.test.tsx),
  [CriteriaListSaysHowFiltersCombine](../../packages/Common/Tests/App/Dashboard/CriteriaListSaysHowFiltersCombine.test.tsx)
  and
  [DropdownEmptyMenuInReadersLanguage](../../packages/Common/Tests/UI/Components/Dropdown/DropdownEmptyMenuInReadersLanguage.test.tsx).
- **A chart's words reach it in the reader's language.** A page hands each metric chart its title,
  description and legend, and the chart draws them as handed: the Kubernetes resource pages, Docker,
  Proxmox and the other resource pages handed English, so "CPU Utilization" read English under a
  German description (#8047). A page that writes its chart words as English literals hands its
  queries through `chartWordsInReadersLanguage`, once, where they go to the chart; a page that words
  a chart itself (a description built around a node's name) looks each literal up where it writes
  it. Never both: a translation looked up again can itself be an English key. A word a shared
  utility writes in English (a monitor's, an incident's, an alert's or an SLO's metric title, legend
  or description) is a key (`translationKey`), and the page hands it through the helper or its
  builder looks it up with the reader's translator: the monitor's Metrics tab said "Response Time"
  under a German heading (#8282). The line over an incident's or an alert's scoped charts says a
  group with no value in the reader's word, "(nicht gesetzt)", worked out as the page is drawn so it
  follows a change of language (#8269). Enforced by
  [ChartWordsInReadersLanguageGuard](../../packages/Common/Tests/App/Dashboard/ChartWordsInReadersLanguageGuard.test.ts),
  [ResourcePageChartWords](../../packages/Common/Tests/App/Dashboard/ResourcePageChartWords.test.tsx),
  [MonitorAndSloChartWordsInEveryLanguage](../../packages/App/Tests/Dashboard/MonitorAndSloChartWordsInEveryLanguage.test.ts),
  [MonitorAndSloChartsInReadersLanguage](../../packages/Common/Tests/App/Dashboard/MonitorAndSloChartsInReadersLanguage.test.tsx),
  [ScopedChartsLineInReadersWords](../../packages/App/Tests/Dashboard/ScopedChartsLineInReadersWords.test.ts)
  and
  [ScopedChartsLineFollowsTheLanguage](../../packages/Common/Tests/App/Dashboard/ScopedChartsLineFollowsTheLanguage.test.tsx).
- **A metric's description reads in the reader's language, its code and names as written.** Every
  monitor metric catalog marks its descriptions as keys (`translationKey`), written out whole: one
  glued together at run time is no key, and read English in every language (#8014). So are the
  descriptions the server stores with a monitor's series, the SLO Burn Rate's among them, written
  out whole for the window they name (#8356). Each place that draws one looks it up once: a metric
  picker's line, a Database Health criteria's line, a Database monitor's charts and summary, a
  metric a monitor stored, and a chart the metrics explorer builds from a metric: it marks the
  description it copies (`isMetricTypeDescription`) and keeps the English in the chart's
  configuration, so a description a person typed is drawn as written (#8572). A translation keeps
  each piece of code between backticks exactly and as
  often, since the picker draws it as code, and the metric, attribute and product names, unit
  symbols, printed values and numbers the English gives. Enforced by
  [MonitorMetricDescriptionsInLocales](../../packages/App/Tests/Dashboard/MonitorMetricDescriptionsInLocales.test.ts),
  [MonitorStoredMetricDescriptionsInLocales](../../packages/App/Tests/Dashboard/MonitorStoredMetricDescriptionsInLocales.test.ts)
  and
  [ExplorerChartDescriptionInReadersLanguage](../../packages/Common/Tests/App/Dashboard/ExplorerChartDescriptionInReadersLanguage.test.tsx).
- **A product's Help > Documentation page reads in the reader's language, its code as written.** A
  page that is one Markdown text holds a text per language (`DocumentationInReadersLanguage`, as Data
  Observability's does, #7531). A page that is a setup guide holds each language's words for every
  piece of its markdown in `Pages/<Product>/DocumentationTranslations/<code>.ts`
  (`SetupGuideTranslation`), one chunk per language: Docker's guide read "Replace `my-docker-host`
  with a name for this host" under a German step title (#8341). Commands, code spans, field names
  and product names stay as the English writes them; what the Dashboard draws (a tab, a page, a
  guide's own topic) is named as the locale words it. A change to a guide's English changes every
  language's words in the same pull request. Enforced by
  [SetupGuideDocumentationInLocale](../../packages/Common/Tests/App/Dashboard/SetupGuideDocumentationInLocale.test.ts)
  and
  [DocumentationPagesInEveryLanguage](../../packages/Common/Tests/App/Dashboard/DocumentationPagesInEveryLanguage.test.ts).
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
- **A path's arrows point the way it is read, and a link's the way it leads.** A browser never turns
  "→" round, so on a page read from the right it points each step back at the one before: Arabic and
  Persian write "←" beside a step in their own words (`تنظیمات پروژه ← پیشرفته`), and keep "→"
  between two steps left in Latin letters, which are drawn from the left. ">" and "›" turn round by
  themselves. A link that leads on ends with "←" there ("All metrics →" is `همهٔ متریک‌ها ←`), and
  one that leads back starts with "→" ("← Back" is `→ بازگشت`). Enforced by
  [PathArrowsInRightToLeftSentences](../../packages/Common/Tests/App/PathArrowsInRightToLeftSentences.test.ts).
- **An arrow a component draws points the way its line is read.** Between two values ("Declared →
  Acknowledged", "12.5% → 15.0%") or after a link's words, never write "→" into a component: draw
  `DirectionArrow`, or take `getArrowOn` or `joinWithArrowsOn` from `Common/Types/DirectionArrow`.
  On a page read from the right the arrow is "←", the first value is drawn at the right, and each
  value is set apart so the arrow stays the line's. A line that reads one way on every page, like
  the names of the user flow map's bands (drawn from the left everywhere), takes
  `joinWithArrowsInDirection`, and its box takes that way too (`getOneWayLineDirection`), whatever
  letters its values are in. Enforced by
  [ComponentArrowsInRightToLeftPages](../../packages/Common/Tests/App/ComponentArrowsInRightToLeftPages.test.ts)
  and
  [DirectionArrowsInReadersLanguage](../../packages/Common/Tests/App/Dashboard/DirectionArrowsInReadersLanguage.test.tsx).
- **A bare word has one meaning everywhere,** because a label is translated by its English text.
  "Any" is the Match Condition's word. A word that means something else in one place takes a key
  that names its meaning, the word then what it means in brackets: "View (database object)", a
  database's view beside the View buttons' verb. A Spanish catalog named a view "Ver" ("see it")
  and headed its schema changes "Cambiar" ("change it", #8078), and named an explorer's Insights tab
  and OneUptime AI's findings both "Análisis" (#8629: the tab is "Insights (explorer analytics)"). List the key in
  [`Common/Types/MeaningKeys`](../../packages/Common/Types/MeaningKeys.ts), so English reads it as
  the word alone, "View", wherever it is drawn: a column's or a filter's title, an option, a pill.
  Look such a key up as any key, and never write its English by hand: no `hasTranslation` check,
  no constant holding "Created", no lookup that falls back to the word, no options translated up
  front to get the English right (#8180). A word one list words for its own noun takes such a key
  too: an invoice's Deleted is "Eliminada" beside its "Pagada", where the Dashboard's shared
  "Deleted" is "Eliminado" (#8181). Enforced by
  [MatchConditionAnyWordGuard](../../packages/Common/Tests/UI/Components/Forms/MatchConditionAnyWordGuard.test.ts),
  [OneMeaningPerKey](../../packages/App/Tests/Dashboard/OneMeaningPerKey.test.ts),
  [MeaningKeys](../../packages/Common/Tests/Types/MeaningKeys.test.tsx)
  and
  [MeaningKeyFallbacksGuard](../../packages/Common/Tests/Types/MeaningKeyFallbacksGuard.test.ts).
- **A thing has one name in each language: the one its menus say.** The side menu, the Products menu
  and a page's title name a thing, and every count, sentence and button on its pages says the same
  noun, in every app and in the docs that quote them. French said "Archiver ce workflow" under a list
  called "Flux de travail", Swedish counted "övervakare" under "Monitorer", and Russian named a
  status page three ways (#8029, #8030, #8031). The Products menu says a product's page title word for
  word: Danish "Overvågninger" opened a page titled "Monitorer", and German "Status-Seiten" one titled
  "Statusseiten" (#8229). A string whose English names the thing says that word too, even where the
  other word has a meaning of its own: Korean said 알림, its word for a notification, for an alert in
  600 strings beside 경고 in 1,100, and Danish said "overvågning" (monitoring) for a monitor (#8628).
  The docs prose says it on every line whose English line names the thing (#8692), and so do
  the docs titles, with the headings, anchors and links that name them (#8705), and the Admin
  Dashboard (#8740).
  A word that names another product's thing keeps that
  product's name, such as a GitHub Actions workflow or a BI tool's dashboards: list it with its reason
  in [`OneNamePerThing`](../../packages/App/Tests/Dashboard/OneNamePerThing.ts). A probe is the
  Dashboard's word too, in the apps and every docs page: the Danish docs said "probes" over a list
  of Sonder, the Chinese 探针 beside 探测器, the Persian کاوشگر, its explorer's word (#7976); a cloud's
  own startup probe keeps its name, in
  [`ProbeWords`](../../packages/App/Tests/Dashboard/ProbeWords.ts). And Persian names a port پورت:
  درگاه is a gateway's or a portal's, and the docs told a reader to free "gateway 443" (#7932).
  Enforced by
  [OneNamePerThingGuard](../../packages/App/Tests/Dashboard/OneNamePerThingGuard.test.ts),
  [OneWordInSentencesPerThing](../../packages/App/Tests/Dashboard/OneWordInSentencesPerThing.test.ts),
  [ProbeWordPerLanguage](../../packages/App/Tests/FeatureSet/Docs/ProbeWordPerLanguage.test.ts)
  and
  [PersianPortWordDocs](../../packages/App/Tests/FeatureSet/Docs/PersianPortWordDocs.test.ts).
- **Two things never share one name in a language.** Arabic called the collector an agent runs
  and a Ceph pool both المجمّع, and a Ceph cluster's pages and its setup guide name the two side by
  side: "the collector reads `CEPH_MGR_ENDPOINTS`" beside the **Pool** row of what it collects
  (#8581). A pool is التجمّع now, in the locale and every setup guide, and a new row of a
  language's glossary takes a word no other row gives. Enforced by
  [ArabicTermsApart](../../packages/Common/Tests/App/ArabicTermsApart.test.ts).
- **The states a page draws for one thing agree with each other.** A state is worded once for
  every place that draws it, so in a language whose adjectives take a gender two states of one
  thing can disagree: Russian's infrastructure list said "Активно" on one row and "Неактивен" on
  the next (#8588). Word a state as the locale words the others it is drawn with (Russian words a
  state on its own in the neuter: "Неактивно", "Выведено из работы"), and list a new set of states
  a page draws together, with the files that draw it. Where a shared word cannot agree with every
  page, the page takes a key of its own in
  [`Common/Types/MeaningKeys`](../../packages/Common/Types/MeaningKeys.ts), read in English as
  the bare word: a threat indicator's Expired is Russian "Истекло" while a token's stays "Истёк"
  (#8659). Enforced by
  [StatesDrawnTogetherAgree](../../packages/Common/Tests/App/StatesDrawnTogetherAgree.test.ts).
- **A noun the sentences share starts a label with a capital.** Many nouns are worded for the middle
  of a sentence, so Spanish says "clúster de Kubernetes" and French "ressource cloud". Where the same
  key names a row, a chip or a line of a card, draw it through `toLabelTerm`, which starts it with a
  capital in the reader's language: "Clúster de Kubernetes". A key that is only ever a label is worded
  with a capital in every language instead. Enforced by
  [NounKeysDrawnAsLabelsGuard](../../packages/Common/Tests/App/Dashboard/NounKeysDrawnAsLabelsGuard.test.ts)
  and
  [NounLabelsStartWithACapital](../../packages/Common/Tests/App/Dashboard/NounLabelsStartWithACapital.test.tsx).
- **A cloud's product name is written as the cloud writes it.** A kind of cloud resource is named by
  the catalog's label, a product's name ("Virtual Machine", "Cloud Run"), in every language and on
  every page: the rows, the cards, the overview, Topology, a Type filter's menu and its chip. The docs'
  tables of supported resources write them so too. Never look a label up: some are also Dashboard
  words, and a Spanish menu said "Máquina virtual" over rows that said "Virtual Machine". A kind the
  catalog only names in words reads in the reader's words ("Subred"), through
  `getCloudResourceTypeText`; a Type filter takes its options from `getCloudResourceTypeOptions`.
  Enforced by
  [CloudResourceTypeNamesGuard](../../packages/Common/Tests/App/Dashboard/CloudResourceTypeNamesGuard.test.ts)
  and
  [CloudResourceTypeNamesInSpanish](../../packages/Common/Tests/App/Dashboard/CloudResourceTypeNamesInSpanish.test.tsx).
- **French sets its colon and semicolon apart,** as it does its question and exclamation marks:
  "Étape {{number}} : {{fields}}", with a space before the mark, as the Dashboard's French writes it
  thousands of times. One text did not ("... depuis une analyse IA: {{label}}", #7679). Only a mark
  that belongs to the English, as written, stays next to its word: a field a search is typed with
  ("user:"), or a setting in a vendor's console. Enforced by
  [DashboardFrenchPunctuation](../../packages/App/Tests/Dashboard/DashboardFrenchPunctuation.test.ts).
- **French keeps each mark on the line of its words.** A line may break at a plain space, and the
  empty Archived Workflows page started a line with "»" (#8032). The locale files keep the plain
  space their translators type, and OneUptime draws it as French typography writes it: a narrow
  no-break space (U+202F) before ; ! and ?, a no-break space (U+00A0) before : and » and after «.
  The Translator sets every sentence it fills, the server's messages too, and the docs set their
  French pages (`Common/Types/NoBreakSpaces`). A frontend hands i18next its locales through
  `withNoBreakSpacesInLocale`, so a string read with `t()` holds them as well. Enforced by
  [FrenchNoBreakSpacesGuard](../../packages/Common/Tests/App/FrenchNoBreakSpacesGuard.test.ts).
- **An option reads the same in a filter's menu and in its chip.** An option's label is either the
  product's words, a key looked up in the reader's language wherever the option is drawn, or a name
  marked `isUserContent` and drawn as written: a record's ("Network"), a value read from data, a
  product's own ("Google Cloud", "Resend"). A Spanish Health filter read "Con problemas" in its menu
  and "Unhealthy" in its chip; a monitor named "Network" read "Red" in a menu over rows that said
  "Network"; the email provider Resend read "Reenviar". Draw an option through
  `getDropdownOptionText`. A stored value is offered in the words its rows draw it in, never as it
  is stored: a runbook run waiting on a manual step read "Esperando" in its pill and
  "WaitingForManualStep" in the Status filter (#7781). A name the API takes is no reason to
  draw it as stored: a subscriber template's event type read "Subscriber Incident Note
  Created" in every language, in the filters, the form's field and the cells. It is a key
  whose English is the stored name, so English reads what the API and Terraform take and
  every other language its own words ("Vorfallsnotiz erstellt", #8179). Enforced by
  [FilterOptionLabelsGuard](../../packages/Common/Tests/App/Dashboard/FilterOptionLabelsGuard.test.ts),
  [FilterChipAndMenuInSpanish](../../packages/Common/Tests/App/Dashboard/FilterChipAndMenuInSpanish.test.tsx),
  [FilterOptionKeysInSpanish](../../packages/Common/Tests/App/Dashboard/FilterOptionKeysInSpanish.test.tsx)
  and
  [SubscriberNotificationEventTypesInReadersLanguage](../../packages/Common/Tests/App/Dashboard/SubscriberNotificationEventTypesInReadersLanguage.test.tsx).
- **A name reads as written, in a badge, a menu, a picker, a sentence and a line of text.** A label,
  a monitor or a state is named by its project, and a name is never looked up: in Spanish a label
  named "Network" read "Red", and a state a project named "Open" read "Abrir", the verb, in its badge,
  in Mark as and in the incident page's "Abrir en". Only the names a new project starts with, such as
  "Resolved", "Operational" or "Critical Incident", are OneUptime's words, read in the reader's
  language - in every place the name is drawn, not only its badge: a German page read "Critical
  Incident" in Needs attention and a chart's marker beside a badge that said "Kritischer Vorfall". A
  badge, a menu's item or an option that draws a record's name takes `isRecordNameAsWritten`, a line
  of text `translateRecordName` and a sentence's value `recordNameInSentence`, all from
  `Common/Utils/DefaultRecordNames`, which know those names list by list. An option built by hand
  says how its label reads (`isUserContent`), and an `EntityDropdown` reads each entry of a record's
  table by that table's list. A severity is set in brackets where its name could repeat the word
  beside it: "opens an incident (Critical Incident)", never "a Critical Incident incident". A status
  page, an on-call page and a status page's messages decide by the same rule, each handed its
  record's list: an incident state a project named "Degraded" read "Beeinträchtigt" on a German
  status page and in its emails, because Degraded is a default monitor status, while the Dashboard
  drew it as written. A label's description, in its hover tip, reads as written too. And a badge or
  a menu's item is never handed words already in the reader's language without saying so: a plain
  English word goes over in English, for the badge to look up once, and a sentence, a plural or a
  front end's own keyed text the page has worded is marked as written (`isUserContent`,
  `isTooltipUserContent`), with none of its words left in English. Looked up again, a translation
  that is itself a key read as another word: Spanish "Red" (Network) read "Rojo" (#8067), in a
  row's ⋯ menu too. Enforced by
  [StatusPageNamesByTheirList](../../packages/Common/Tests/App/StatusPage/StatusPageNamesByTheirList.test.ts),
  [RecordNamesInPillsGuard](../../packages/Common/Tests/App/Dashboard/RecordNamesInPillsGuard.test.ts),
  [RecordNamesInOptionsGuard](../../packages/Common/Tests/App/Dashboard/RecordNamesInOptionsGuard.test.ts),
  [RecordNamesInTextGuard](../../packages/Common/Tests/App/Dashboard/RecordNamesInTextGuard.test.ts),
  [RecordNamesReadAsWrittenInSpanish](../../packages/Common/Tests/App/Dashboard/RecordNamesReadAsWrittenInSpanish.test.tsx),
  [RecordNamesInPickersInSpanish](../../packages/Common/Tests/App/Dashboard/RecordNamesInPickersInSpanish.test.tsx),
  [RecordNamesInEntityPickersInSpanish](../../packages/Common/Tests/App/Dashboard/RecordNamesInEntityPickersInSpanish.test.tsx),
  [RecordNamesInSentencesInSpanish](../../packages/Common/Tests/App/Dashboard/RecordNamesInSentencesInSpanish.test.tsx),
  [RecordNamesAsTextInGerman](../../packages/Common/Tests/App/Dashboard/RecordNamesAsTextInGerman.test.tsx),
  [RecordNamesReadAsWrittenInEveryLanguage](../../packages/Common/Tests/App/Dashboard/RecordNamesReadAsWrittenInEveryLanguage.test.tsx),
  [MoreMenuItemWordsAsGiven](../../packages/Common/Tests/UI/Components/MoreMenuItemWordsAsGiven.test.tsx)
  and
  [BadgeWordsLookedUpOnce](../../packages/Common/Tests/App/Dashboard/BadgeWordsLookedUpOnce.test.tsx).
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
(#6832). Answers stay on the server, for its master admins (Admin Dashboard > Feedback), and what a
person writes in Give Feedback also reaches whoever can answer it.

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
  person, no project, no address: the row kept names nobody. Say where it goes where it is given: to
  the server's admins on a self-hosted server, and to the OneUptime team on Cloud. Enforced by
  [FeedbackQuestionsGuard](../../packages/App/Tests/Dashboard/FeedbackQuestionsGuard.test.ts).
- **Give Feedback is a message, and reaches someone who can answer it.** The person writes to a team
  and wants a reply, so the server emails it with their name and email address, their project, the
  page and the version, copying them, and a reply goes to them (#8893): to the OneUptime team
  (support@oneuptime.com) on Cloud, and to the server's Admin Notification Email on a self-hosted
  server, never to OneUptime. A self-hosted server with none emails nothing, and the answer names
  nobody. The dialog says to whom and with what before anything is sent, names the page as its
  breadcrumbs do ("SLOs", never the route it sends, "/dashboard/:projectId/slos"), and once sent says
  only what the server did: "A copy is on its way to you@example.com". Enforced by
  [FeedbackQuestionsGuard](../../packages/App/Tests/Dashboard/FeedbackQuestionsGuard.test.ts).
- **Once an answer is given, say where it went before offering anything else.** On a self-hosted
  server the thanks says "This server's admins can read it in the Admin Dashboard, under Feedback.",
  and only then offers the GitHub issue, which says it is public and that nothing is posted until
  the person posts it (#7462). "Nothing leaves this server" is said before an answer is given, never
  under a link to a public issue, and a self-hosted server's thanks never says "us". Enforced by
  [FeedbackQuestionsGuard](../../packages/App/Tests/Dashboard/FeedbackQuestionsGuard.test.ts).
- **Answers are kept a set time, said where they are read.** A year, then the daily purge deletes
  them; Admin Dashboard > Feedback says so over the answers, and a master admin can delete one after
  a question that quotes its words (#7366). Enforced by
  [FeedbackQuestionsGuard](../../packages/App/Tests/Dashboard/FeedbackQuestionsGuard.test.ts).
- **The docs keep "Was this page helpful?" only once a server's admin switches it on, and say so
  under the question.** A self-hosted server's docs keep nothing until a master admin switches on
  Docs Feedback in Admin Dashboard > Feedback; then each page says its answers go to this server's
  admins, and nothing is sent anywhere else (#7209). On Cloud, docs answers, searches that find
  nothing (with any word that could name someone dropped) and docs links opened from the product
  go to product analytics only with consent (#7207). Enforced by
  [DocsSearchAndFeedbackRoutes](../../packages/App/Tests/FeatureSet/Docs/DocsSearchAndFeedbackRoutes.test.ts).
- **How Ask AI's answers were rated is counts, never words, and only for whom may read it.** A
  project's owners and admins see its answers' ratings and what the answers rated down read (a
  product, the docs, nothing), never a question or an answer: a conversation stays its person's
  (#7365). Enforced by
  [AskAiRatingsRoute](../../packages/Common/Tests/Server/API/AskAiRatingsRoute.test.ts).
- **Before each release, someone who has not seen the changes walks the core jobs as a newcomer**,
  and posts what made them hesitate, guess or go back on the epic #6802:
  [the newcomer walkthrough](newcomer-walkthrough.md). Not enforced: use judgement.

## Before you open a pull request

- **Look at it as a newcomer would.** At 1280 and 390 pixels wide (and at 1024 and 768 beside the side
  menu), in light and dark, in German (a long language) and Persian (right to left), as a brand-new
  project and as a busy one. Put before and after screenshots in the pull request's description with
  [Scripts/PR/PublishScreenshots.js](../../Scripts/PR/PublishScreenshots.js), which puts them on the
  `pr-assets` branch and prints the Markdown to paste; committed to your branch, they would be in
  every CI job's checkout. Not enforced: use judgement.
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
