/*
 * Where OneUptime writes what an Ask AI code change was proposed on, in
 * the change's own arguments (issue #6313, CodeFileSeen): each file it
 * writes as the branch had it when the card was shown, which the approved
 * change is held to, and what the card said of them. The approval card and
 * the exports leave it out (AIChatTypes). A module of its own, importing
 * nothing, so anything can read the key without loading the code behind it.
 */
export const CODE_CHANGE_PROPOSED_ON_KEY: string = "filesProposedOn";
