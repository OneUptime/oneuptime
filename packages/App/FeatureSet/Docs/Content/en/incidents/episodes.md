# Episodes

An episode groups related incidents, or related alerts, so your team works on them as one: one place to see them, one set of owners, one state to acknowledge and resolve. Grouping rules open episodes and add to them as incidents and alerts arrive (see [Incident grouping rules](/docs/incidents/settings#incident-grouping-rules)). You can also put incidents in an episode yourself, several at a time: from the episode, or from the incidents lists.

Everything on this page works the same way for alert episodes: read "alert" where it says "incident". Incident episodes are under **Incidents → Episodes**, alert episodes under **Alerts → Episodes**.

## Adding incidents from an episode

Open the episode and choose **Member Incidents** in its side menu (`/dashboard/{projectId}/incidents/episodes/{episodeId}/incidents`), then click **Add Incidents**. The dialog lists the 50 most recent incidents you can see that are not in the episode yet, each with its number, title, state and severity. To find an older one, search by title or by number: `INC-42`, `42` and `#42` all find incident 42.

- Tick as many as you need, up to 100 at a time. The button counts them: **Add 3 Incidents**.
- An incident that is already in another episode says so under its title, with that episode's number. Adding it here keeps it there too: an incident can be in more than one episode. In a project that allows an incident in only one episode, it cannot be picked: see [One episode per incident](#one-episode-per-incident).
- If some cannot be added, the dialog stays open and lists them with the reason; the rest are added.

## Adding incidents from the incidents lists

Select incidents on the **Incidents** list, or on any other list of incidents such as a monitor's, and open **Bulk Actions**:

| Action | What it does |
| --- | --- |
| **Add to Existing Episode** | Pick one episode. Ongoing episodes come first, newest first, then recently resolved ones; search to find any other by title or number. Before you add, the dialog says how many of the selected incidents are in that episode already, which are left as they are, and how many are in another episode, where they stay. |
| **Add to New Episode** | Creates an episode with the selected incidents in it. It asks only for a title and a severity, both filled in from the most severe selected incident; the title of a private incident is never copied. Add owners, on-call policies and notes on the episode's own page. |

Both take up to 100 selected incidents. The result says how many were added, how many were in the episode already and which were not added and why, with a link that opens the episode.

## What adding does

- **One entry on the episode's feed** names every incident added: the first 20 by number and title, then how many more. It is posted once to the episode's Slack or Microsoft Teams channel, not once per incident. A private incident is named by its number only.
- **Each incident's own feed** says which episode it was added to.
- **The episode's severity** is raised to the most severe incident added to an existing episode, and never lowered. A new episode starts at the severity you pick.
- **A resolved episode stays resolved.** Adding to it does not reopen it, and adding never changes the state of an incident.
- **The episode's owners are told** that incidents were added, as they are when one is added on its own. When the episode is created with them, its own created notification covers them.

## Taking an incident out

On **Member Incidents**, **Remove** on a row, or on the selected rows from **Bulk Actions**, takes the incident out of this episode only. The incident itself is not deleted, and it stays in any other episode it is in.

## One episode per incident

An incident can be in several episodes at once. To keep each incident in one episode at most, turn on **An incident can be in only one episode** in **Incidents → Settings → Episode Membership**. For alerts, the switch is **An alert can be in only one episode**, in **Alerts → Settings → Episode Membership**. Both are off until you turn them on, and only Project Owners and Project Admins can change them.

While it is on, an incident that is in an episode is not added to another one:

- **Add Incidents** lists only the incidents that are in no episode. A search finds the others too, but one that is in another episode cannot be ticked, and says so.
- **Add to Existing Episode** says how many of the selected incidents are in another episode, and adds only the rest. When every one is in an episode already, it says there is nothing to add.
- **Add to New Episode** leaves out the selected incidents that are in an episode already, and says how many. When every one is, it says there is nothing to add.
- **Grouping rules** leave an incident that is in an episode already where it is.
- **The API, workflows and Terraform** are held to the same rule: adding an incident that is in another episode is refused, with the reason.

Turning it on takes no incident out of an episode: an incident that is in several already stays in them. To move an incident, **Remove** it on its episode's **Member Incidents** page, then add it to the other episode.

## Who can add

Adding needs permission to add incidents to an episode, which the Project Owner, Project Admin, Project Member, Incident Admin and Incident Member roles have, as does a custom role with Create Incident Episode Member. You can only add incidents you can see: a private incident can be added only by its owners and by the project's owners and admins. Add to New Episode also needs permission to create an episode. When you cannot use an action, it is locked, and its tooltip names the permission that is missing.

## With the API

Add several incidents to an episode in one request:

```bash
curl -X POST 'https://oneuptime.com/api/incident-episode-member/add-incidents' \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "incidentEpisodeId": "<episode id>",
    "incidentIds": ["<incident id>", "<incident id>"]
  }'
```

The answer names each incident sent, once: added, already in the episode, or not added and why. A request with more than 100 ids is refused.

```json
{
  "added": ["<incident id>"],
  "alreadyInEpisode": ["<incident id>"],
  "notAdded": [
    {
      "id": "<incident id>",
      "reason": "This incident does not exist in this project, or you do not have access to it."
    }
  ]
}
```

In a project that allows an incident in only one episode, an incident that is in another episode comes back in `notAdded`, with `Already in another episode. An incident can be in only one episode in this project.` as its reason.

For alerts, send `alertEpisodeId` and `alertIds` to `/api/alert-episode-member/add-alerts`. To create an episode with incidents in it, send their ids with the episode's create request, `POST /api/incident-episode`, as `{ "data": { "title": "Checkout outage" }, "miscDataProps": { "incidentIdsToAdd": ["<incident id>"] } }`; for an alert episode, `POST /api/alert-episode` with `alertIdsToAdd`. If any of them cannot be added, no episode is created.
