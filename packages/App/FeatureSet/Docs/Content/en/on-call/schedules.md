# On-Call Schedules

An on-call schedule decides who is on call at any moment. People take turns in it: each is on call for a while, then the next one takes over. Add a schedule to an on-call policy's escalation rules, and the policy pages whoever is on call in it when that level runs.

## Who takes turns

When you create a schedule on the **On-Call Schedules** page, the form asks for its **Name** and **Who takes turns?**. Click **Add user** and pick the people, in the order they take turns: they are on call one at a time, and the first one is on call as soon as the schedule is created. They become the schedule's first layer, **Layer 1**, on call around the clock. The new schedule then opens on its **Layers** page, where you can change the rotation or add more layers.

**Who takes turns?** is optional. Leave it empty and the schedule starts without layers: it puts nobody on call until you add a layer on its **Layers** page. The question is asked only of people who may add layers.

Everything else waits under **More fields**, folded until you open it:

- **Each turn lasts**: **1 day**, **1 week**, **2 weeks** or **1 month**, and **1 week** unless you change it. It is asked once somebody takes turns. Each person is on call that long, then the next one takes over, at the time of day the schedule was created.
- **Timezone**: the timezone hand-off times and on-call hours are kept in. It starts at yours.
- **Description** and **Labels**.

While somebody takes turns and nothing under **More fields** is changed, its folded header says what will happen: each person is on call for a week, then the next one takes over.

## Layers

A schedule's rotation is made of layers, on its **Layers** page. Layers are read from the top down: the highest layer with someone on call is the one that pages, so put the main rotation on top and fall-back cover below it.

**Add Layer** adds a layer that starts the way the first one does: on call from now, each person for a week, around the clock. Expand a layer to add people to it, and to change when it starts, how often it hands off, when it first hands off and the hours it is on call.

## Creating schedules with the API or Terraform

On-call schedules are the `/api/on-call-duty-policy-schedule` resource; their layers and the people in them are the `/api/on-call-duty-schedule-layer` and `/api/on-call-duty-schedule-layer-user` resources.

- Creating a schedule with `firstLayerUsers` (a list of user ids, in the order they take turns) in its `miscDataProps` gives it its first layer, as the dashboard does: **Layer 1**, on call from now, around the clock. `firstLayerRotation` says how long each turn lasts, as a rotation such as `{"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}`; without it, a week. Every user must be a member of the project and the caller must be allowed to create layers, or the schedule is not created.
- A schedule created without them has no layers, as before; Terraform's schedule resource does not send them.
- A layer created without a `rotation` hands off daily, as it always has.
