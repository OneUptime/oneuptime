# Workflow usability: browser evidence

These screenshots show the actual workflow components from the implementation worktree in an isolated component preview. The canvas, component picker, settings forms, validation indicator, and issues panel use the product code. Changes remain in local React state. The only API stub returns an empty workflow-variable list. The shared development API returned HTTP 502, so this evidence does not verify server persistence or workflow execution.

Browser checks covered 1440 × 1000 and 900 × 760 viewports:

- Open the trigger and component pickers; select results with the mouse and keyboard.
- Verify Enter and Space activation, slash to focus search, and Escape to close.
- Search and filter results, inspect no-match guidance, clear search, and confirm hidden selections cannot be added.
- Add a trigger and component, confirm settings open immediately, save Sleep with Seconds set to 30, and reopen the card to confirm that value remains.
- Add repeated steps, verify separate positions and unique identifiers, and connect nodes manually.
- Inspect layout and scrolling at both viewport sizes, including picker details and empty results.

## Screenshots

- [Keyboard search](screenshots/keyboard-search.png)
- [Step settings with 30 seconds](screenshots/step-settings.png)
- [Separated repeated steps](screenshots/spaced-steps.png)
- [Canvas at a smaller viewport](screenshots/canvas-small.png)
- [Empty search at a smaller viewport](screenshots/empty-search-small.png)
