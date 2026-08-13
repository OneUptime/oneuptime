These triggers start a run when a record changes. There is one per operation — created, updated, deleted — and only records in this project fire them.

## Select Fields decides what you get

The trigger hands the changed record to the rest of the workflow, but only the columns named in **Select Fields**. A column you did not select is absent downstream, even though it exists on the record. If a later step reads an empty value, check here first.

## On Update: Listen on

**Listen on** narrows the trigger to updates that touch particular columns. Leave it blank to fire on any change.

It is a filter, not a guarantee: when a change arrives without a record of which fields moved, the filter is skipped and the workflow runs anyway. Treat it as a way to cut noise, not as a promise that one of those columns definitely changed.

## Running one by hand

**Run Workflow** asks for the ID of a record and runs the graph against it. That is the fastest way to test a trigger without waiting for the real event.

## Deletes

**On Delete** fires after the record is gone. The values it hands on are the last ones the record had — you cannot go and read the record again from a later step.
