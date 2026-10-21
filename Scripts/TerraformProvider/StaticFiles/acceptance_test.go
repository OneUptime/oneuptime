package provider

/*
 * The core resources, each through its whole life: create, update in place,
 * import, destroy. After every apply terraform-plugin-testing also plans
 * again and fails on any change, so each step proves the configuration
 * converged, and each update step proves the change is an in-place update,
 * not a replacement. ImportStateVerify then holds what an import reads to
 * what the apply left in state. See acceptance_helpers_test.go for when
 * these run.
 */

import (
	"fmt"
	"testing"

	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
	"github.com/hashicorp/terraform-plugin-testing/plancheck"
)

// An update step's plan: the resource changes in place.
func testAccUpdatesInPlace(address string) resource.ConfigPlanChecks {
	return resource.ConfigPlanChecks{
		PreApply: []plancheck.PlanCheck{
			plancheck.ExpectResourceAction(address, plancheck.ResourceActionUpdate),
		},
	}
}

func TestAccIncidentSeverity_lifecycle(t *testing.T) {
	const address = "oneuptime_incident_severity.test"
	name := testAccName("TF Acc Severity")

	config := func(description string, color string) string {
		return fmt.Sprintf(`
resource "oneuptime_incident_severity" "test" {
  name        = %q
  description = %q
  color       = %q
}
`, name, description, color)
	}

	resource.ParallelTest(t, resource.TestCase{
		PreCheck:                 func() { testAccPreCheck(t) },
		ProtoV6ProviderFactories: testAccProtoV6ProviderFactories,
		CheckDestroy:             testAccCheckDestroyed("oneuptime_incident_severity", "/incident-severity"),
		Steps: []resource.TestStep{
			{
				Config: config("Created by the provider's acceptance tests", "#FFA500"),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttrSet(address, "id"),
					resource.TestCheckResourceAttr(address, "name", name),
					resource.TestCheckResourceAttr(address, "color", "#FFA500"),
				),
			},
			{
				Config:           config("Updated by the provider's acceptance tests", "#E74C3C"),
				ConfigPlanChecks: testAccUpdatesInPlace(address),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr(address, "description", "Updated by the provider's acceptance tests"),
					resource.TestCheckResourceAttr(address, "color", "#E74C3C"),
				),
			},
			{
				ResourceName:      address,
				ImportState:       true,
				ImportStateVerify: true,
			},
		},
	})
}

func TestAccMonitor_lifecycle(t *testing.T) {
	const address = "oneuptime_monitor.test"
	name := testAccName("TF Acc Monitor")

	config := func(description string) string {
		return fmt.Sprintf(`
resource "oneuptime_monitor" "test" {
  name         = %q
  description  = %q
  monitor_type = "Manual"
}
`, name, description)
	}

	resource.ParallelTest(t, resource.TestCase{
		PreCheck:                 func() { testAccPreCheck(t) },
		ProtoV6ProviderFactories: testAccProtoV6ProviderFactories,
		CheckDestroy:             testAccCheckDestroyed("oneuptime_monitor", "/monitor"),
		Steps: []resource.TestStep{
			{
				Config: config("Created by the provider's acceptance tests"),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttrSet(address, "id"),
					resource.TestCheckResourceAttr(address, "name", name),
					resource.TestCheckResourceAttr(address, "monitor_type", "Manual"),
				),
			},
			{
				Config:           config("Updated by the provider's acceptance tests"),
				ConfigPlanChecks: testAccUpdatesInPlace(address),
				Check:            resource.TestCheckResourceAttr(address, "description", "Updated by the provider's acceptance tests"),
			},
			// The worker that tells a new monitor's owners sets
			// is_owner_notified_of_resource_creation (and updated_at) on its
			// own time, after the apply: the import may or may not see it.
			{
				ResourceName:            address,
				ImportState:             true,
				ImportStateVerify:       true,
				ImportStateVerifyIgnore: []string{"is_owner_notified_of_resource_creation", "updated_at"},
			},
		},
	})
}

func TestAccStatusPage_lifecycle(t *testing.T) {
	const address = "oneuptime_status_page.test"
	name := testAccName("TF Acc Status Page")

	config := func(pageTitle string) string {
		return fmt.Sprintf(`
resource "oneuptime_status_page" "test" {
  name                  = %q
  description           = "Created by the provider's acceptance tests"
  page_title            = %q
  is_public_status_page = false
}
`, name, pageTitle)
	}

	resource.ParallelTest(t, resource.TestCase{
		PreCheck:                 func() { testAccPreCheck(t) },
		ProtoV6ProviderFactories: testAccProtoV6ProviderFactories,
		CheckDestroy:             testAccCheckDestroyed("oneuptime_status_page", "/status-page"),
		Steps: []resource.TestStep{
			{
				Config: config("Acceptance Status"),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttrSet(address, "id"),
					resource.TestCheckResourceAttr(address, "name", name),
					resource.TestCheckResourceAttr(address, "is_public_status_page", "false"),
				),
			},
			{
				Config:           config("Acceptance Status (Updated)"),
				ConfigPlanChecks: testAccUpdatesInPlace(address),
				Check:            resource.TestCheckResourceAttr(address, "page_title", "Acceptance Status (Updated)"),
			},
			// As for a monitor: the worker that tells a new status page's
			// owners sets is_owner_notified_of_resource_creation (and
			// updated_at) on its own time, after the apply.
			{
				ResourceName:            address,
				ImportState:             true,
				ImportStateVerify:       true,
				ImportStateVerifyIgnore: []string{"is_owner_notified_of_resource_creation", "updated_at"},
			},
		},
	})
}

func TestAccOnCallPolicy_lifecycle(t *testing.T) {
	const address = "oneuptime_on_call_policy.test"
	name := testAccName("TF Acc On-Call Policy")

	config := func(description string, repeat bool) string {
		return fmt.Sprintf(`
resource "oneuptime_on_call_policy" "test" {
  name                                 = %q
  description                          = %q
  repeat_policy_if_no_one_acknowledges = %t
}
`, name, description, repeat)
	}

	resource.ParallelTest(t, resource.TestCase{
		PreCheck:                 func() { testAccPreCheck(t) },
		ProtoV6ProviderFactories: testAccProtoV6ProviderFactories,
		CheckDestroy:             testAccCheckDestroyed("oneuptime_on_call_policy", "/on-call-duty-policy"),
		Steps: []resource.TestStep{
			{
				Config: config("Created by the provider's acceptance tests", false),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttrSet(address, "id"),
					resource.TestCheckResourceAttr(address, "name", name),
					resource.TestCheckResourceAttr(address, "repeat_policy_if_no_one_acknowledges", "false"),
				),
			},
			{
				Config:           config("Updated by the provider's acceptance tests", true),
				ConfigPlanChecks: testAccUpdatesInPlace(address),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr(address, "description", "Updated by the provider's acceptance tests"),
					resource.TestCheckResourceAttr(address, "repeat_policy_if_no_one_acknowledges", "true"),
				),
			},
			{
				ResourceName:      address,
				ImportState:       true,
				ImportStateVerify: true,
			},
		},
	})
}

/*
 * A schedule and two of its layers, as its docs page writes them: weekday
 * working hours above an around-the-clock layer, created together.
 *   - The layer times have no milliseconds, as timeadd() writes them; the
 *     server answers with them (OneUptime/terraform-provider-oneuptime#11).
 *   - The two layers are created in parallel, each at its own order
 *     (OneUptime/terraform-provider-oneuptime#12).
 * The top-level timestamps carry milliseconds, the way the server answers,
 * so that an import reads back exactly what the apply stored. An import
 * reads the JSON attributes in the server's full form while the apply keeps
 * the configuration's, equal in meaning but not in text, so ImportStateVerify,
 * which compares text, leaves those two out.
 */
func TestAccOnCallScheduleAndLayers_lifecycle(t *testing.T) {
	const scheduleAddress = "oneuptime_on_call_policy_schedule.test"
	const businessHours = "oneuptime_on_call_schedule_layer.business_hours"
	const aroundTheClock = "oneuptime_on_call_schedule_layer.around_the_clock"
	name := testAccName("TF Acc Schedule")

	config := func(handOffEvery string) string {
		return fmt.Sprintf(`
resource "oneuptime_on_call_policy_schedule" "test" {
  name        = %[1]q
  description = "Created by the provider's acceptance tests"
  timezone    = "UTC"
}

resource "oneuptime_on_call_schedule_layer" "business_hours" {
  on_call_duty_policy_schedule_id = oneuptime_on_call_policy_schedule.test.id
  name                            = "Business hours"
  order                           = 1
  starts_at                       = "2026-01-05T09:00:00.000Z"
  hand_off_time                   = "2026-01-12T09:00:00.000Z"

  rotation = jsonencode({
    _type = "Recurring"
    value = {
      intervalType  = %[2]q
      intervalCount = { _type = "PositiveNumber", value = 1 }
    }
  })

  restriction_times = jsonencode({
    _type = "RestrictionTimes"
    value = {
      restictionType = "Weekly"
      weeklyRestrictionTimes = [
        for day, date in {
          Monday    = "2026-01-05"
          Tuesday   = "2026-01-06"
          Wednesday = "2026-01-07"
          Thursday  = "2026-01-08"
          Friday    = "2026-01-09"
          } : {
          startDay  = day
          endDay    = day
          startTime = { _type = "DateTime", value = "${date}T09:00:00Z" }
          endTime   = { _type = "DateTime", value = "${date}T17:00:00Z" }
        }
      ]
    }
  })
}

resource "oneuptime_on_call_schedule_layer" "around_the_clock" {
  on_call_duty_policy_schedule_id = oneuptime_on_call_policy_schedule.test.id
  name                            = "Nights and weekends"
  order                           = 2
  starts_at                       = "2026-01-05T09:00:00.000Z"
  hand_off_time                   = "2026-01-06T09:00:00.000Z"

  rotation = jsonencode({
    _type = "Recurring"
    value = {
      intervalType  = "Day"
      intervalCount = { _type = "PositiveNumber", value = 1 }
    }
  })

  restriction_times = jsonencode({
    _type = "RestrictionTimes"
    value = { restictionType = "None" }
  })
}
`, name, handOffEvery)
	}

	resource.ParallelTest(t, resource.TestCase{
		PreCheck:                 func() { testAccPreCheck(t) },
		ProtoV6ProviderFactories: testAccProtoV6ProviderFactories,
		CheckDestroy: resource.ComposeAggregateTestCheckFunc(
			testAccCheckDestroyed("oneuptime_on_call_schedule_layer", "/on-call-duty-schedule-layer"),
			testAccCheckDestroyed("oneuptime_on_call_policy_schedule", "/on-call-duty-policy-schedule"),
		),
		Steps: []resource.TestStep{
			{
				Config: config("Week"),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttrSet(scheduleAddress, "id"),
					resource.TestCheckResourceAttr(scheduleAddress, "timezone", "UTC"),
					resource.TestCheckResourceAttrPair(businessHours, "on_call_duty_policy_schedule_id", scheduleAddress, "id"),
					resource.TestCheckResourceAttr(businessHours, "order", "1"),
					resource.TestCheckResourceAttr(aroundTheClock, "order", "2"),
				),
			},
			{
				Config:           config("Day"),
				ConfigPlanChecks: testAccUpdatesInPlace(businessHours),
				Check:            resource.TestCheckResourceAttr(businessHours, "order", "1"),
			},
			// A layer change bumps its schedule's shift_config_version (and
			// updated_at) on the server, after the apply that made it has read
			// the schedule: step 2's layer update leaves the schedule's state
			// one version behind until the next refresh.
			{
				ResourceName:            scheduleAddress,
				ImportState:             true,
				ImportStateVerify:       true,
				ImportStateVerifyIgnore: []string{"shift_config_version", "updated_at"},
			},
			{
				ResourceName:            businessHours,
				ImportState:             true,
				ImportStateVerify:       true,
				ImportStateVerifyIgnore: []string{"rotation", "restriction_times"},
			},
			{
				ResourceName:            aroundTheClock,
				ImportState:             true,
				ImportStateVerify:       true,
				ImportStateVerifyIgnore: []string{"rotation", "restriction_times"},
			},
		},
	})
}
