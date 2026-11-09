/*
 * WHAT THE PEOPLE A PAGE REACHES ARE ASKED TO DO (OnCallObserverPage).
 *
 * Responders take the incident or alert on: answering their page
 * acknowledges it and stops every other page about it, as every page always
 * has. Observers are kept informed while somebody else responds: answering
 * their page only says they have seen it.
 *
 * An on-call rule says which for the policies it pages, a workflow's page
 * step for the people it pages, and a page from Slack or Microsoft Teams
 * for the people it names. Responders is the default everywhere, so every
 * rule, step and page there is goes on paging as it did.
 */
enum OnCallPageAs {
  Responders = "Responders",
  Observers = "Observers",
}

export default OnCallPageAs;
