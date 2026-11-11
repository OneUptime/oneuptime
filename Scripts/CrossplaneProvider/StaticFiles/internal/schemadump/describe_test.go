package schemadump

import "testing"

func isResource(name string) bool {
	return name != "oneuptime_user" && name != "oneuptime_incoming_call_log"
}

func TestDescribe(t *testing.T) {
	cases := []struct{ terraform, kubernetes string }{
		{
			"Labels to group and filter by. IDs of `oneuptime_label` resources.",
			"Labels to group and filter by. IDs of `Label` resources.",
		},
		{
			"Whats the current status ID of this monitor? The ID of a `oneuptime_monitor_status`.",
			"Whats the current status ID of this monitor? The ID of a `MonitorStatusDefinition`.",
		},
		{
			"User ID who created this object. The ID of a `oneuptime_user` (see the data source).",
			"User ID who created this object. The ID of a OneUptime user.",
		},
		{
			"The user who owns the AI agent. The ID of a `oneuptime_user` (see the data source). Or name them by email address, in `user_email`.",
			"The user who owns the AI agent. The ID of a OneUptime user. Or name them by email address, in `userEmail`.",
		},
		{
			"People to page. IDs of `oneuptime_user` records. Or name them by email address, in `owner_user_emails`.",
			"People to page. IDs of OneUptime user records. Or name them by email address, in `ownerUserEmails`.",
		},
		{
			"The call it came from. The ID of a `oneuptime_incoming_call_log` (see the data source).",
			"The call it came from. The ID of a OneUptime incoming call log.",
		},
		{
			"Custom Fields on this resource. A JSON value: write it with `jsonencode()`.",
			"Custom Fields on this resource. A JSON value, as a string.",
		},
		{
			"Last email data received. A JSON value: read it with `jsondecode()`.",
			"Last email data received. A JSON value, as a string.",
		},
		{
			"Raw JSON escape hatch for the DNS monitor config (queryName, recordType, ...). Write it with `jsonencode()`.",
			"Raw JSON escape hatch for the DNS monitor config (queryName, recordType, ...). Write it as a JSON string.",
		},
		{
			"The URL this step probes. Requires `monitor_destination_type`.",
			"The URL this step probes. Requires `monitorDestinationType`.",
		},
		// Values and words in backticks that are not attribute names stay.
		{
			"Kind of destination: `URL`, `IP` or `Hostname`. HTTP method (`GET`, `POST`). Defaults to `false`.",
			"Kind of destination: `URL`, `IP` or `Hostname`. HTTP method (`GET`, `POST`). Defaults to `false`.",
		},
		{
			"Client certificate (PEM or `{{monitorSecrets.name}}` reference).",
			"Client certificate (PEM or `{{monitorSecrets.name}}` reference).",
		},
		{"", ""},
	}
	for _, c := range cases {
		if got := Describe(c.terraform, isResource); got != c.kubernetes {
			t.Errorf("Describe(%q)\n got  %q\n want %q", c.terraform, got, c.kubernetes)
		}
	}
}
