package provider

/*
 * oneuptime_on_call_schedule_layers through a real Terraform against a real
 * OneUptime (see acceptance_helpers_test.go for when these run): a schedule's
 * two layers given their people in one apply, then a new turn order, with a
 * person moved from one layer to the other, in the next - one save-layers
 * call each - then imported by the schedule's ID. After every apply
 * terraform-plugin-testing plans again and fails on any change, so each step
 * also proves the layers read back as they were saved.
 *
 * The people are invited by addresses of this run's own (example.com, so
 * nobody is mailed): invited people can take turns.
 */

import (
	"fmt"
	"testing"

	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
)

func TestAccOnCallScheduleLayers_turnOrder(t *testing.T) {
	const address = "oneuptime_on_call_schedule_layers.test"
	team := testAccName("TF Acc Layers Team")
	schedule := testAccName("TF Acc Layers Schedule")
	first := testAccPersonEmail("layers-first")
	second := testAccPersonEmail("layers-second")
	third := testAccPersonEmail("layers-third")

	config := func(layers string) string {
		return fmt.Sprintf(`
resource "oneuptime_team" "test" {
  name = %[1]q
}

resource "oneuptime_team_member" "first" {
  team_id    = oneuptime_team.test.id
  user_email = %[3]q
}

resource "oneuptime_team_member" "second" {
  team_id    = oneuptime_team.test.id
  user_email = %[4]q
}

resource "oneuptime_team_member" "third" {
  team_id    = oneuptime_team.test.id
  user_email = %[5]q
}

resource "oneuptime_on_call_policy_schedule" "test" {
  name     = %[2]q
  timezone = "UTC"
}

resource "oneuptime_on_call_schedule_layer" "primary" {
  on_call_duty_policy_schedule_id = oneuptime_on_call_policy_schedule.test.id
  name                            = "Primary"
  starts_at                       = "2030-01-07T09:00:00.000Z"
  hand_off_time                   = "2030-01-14T09:00:00.000Z"
}

# Made after the primary layer, so it is the second in the schedule too.
resource "oneuptime_on_call_schedule_layer" "secondary" {
  on_call_duty_policy_schedule_id = oneuptime_on_call_policy_schedule.test.id
  name                            = "Secondary"
  starts_at                       = "2030-01-07T09:00:00.000Z"
  hand_off_time                   = "2030-01-14T09:00:00.000Z"

  depends_on = [oneuptime_on_call_schedule_layer.primary]
}

resource "oneuptime_on_call_schedule_layers" "test" {
  on_call_duty_policy_schedule_id = oneuptime_on_call_policy_schedule.test.id
%[6]s
}
`, team, schedule, first, second, third, layers)
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
				Config: config(`
  layers = [
    {
      layer_id = oneuptime_on_call_schedule_layer.primary.id
      user_ids = [oneuptime_team_member.first.user_id, oneuptime_team_member.second.user_id]
    },
    {
      layer_id = oneuptime_on_call_schedule_layer.secondary.id
      user_ids = [oneuptime_team_member.third.user_id]
    },
  ]`),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttrPair(address, "id", "oneuptime_on_call_policy_schedule.test", "id"),
					resource.TestCheckResourceAttr(address, "layers.#", "2"),
					resource.TestCheckResourceAttrPair(address, "layers.0.layer_id", "oneuptime_on_call_schedule_layer.primary", "id"),
					resource.TestCheckResourceAttr(address, "layers.0.user_ids.#", "2"),
					resource.TestCheckResourceAttrPair(address, "layers.0.user_ids.0", "oneuptime_team_member.first", "user_id"),
					resource.TestCheckResourceAttrPair(address, "layers.0.user_ids.1", "oneuptime_team_member.second", "user_id"),
					resource.TestCheckResourceAttrPair(address, "layers.1.layer_id", "oneuptime_on_call_schedule_layer.secondary", "id"),
					resource.TestCheckResourceAttrPair(address, "layers.1.user_ids.0", "oneuptime_team_member.third", "user_id"),
				),
			},
			// A new turn order, and the first person moved to the other layer, in one apply.
			{
				Config: config(`
  layers = [
    {
      layer_id = oneuptime_on_call_schedule_layer.primary.id
      user_ids = [oneuptime_team_member.second.user_id, oneuptime_team_member.third.user_id]
    },
    {
      layer_id = oneuptime_on_call_schedule_layer.secondary.id
      user_ids = [oneuptime_team_member.first.user_id]
    },
  ]`),
				ConfigPlanChecks: testAccUpdatesInPlace(address),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr(address, "layers.0.user_ids.#", "2"),
					resource.TestCheckResourceAttrPair(address, "layers.0.user_ids.0", "oneuptime_team_member.second", "user_id"),
					resource.TestCheckResourceAttrPair(address, "layers.0.user_ids.1", "oneuptime_team_member.third", "user_id"),
					resource.TestCheckResourceAttr(address, "layers.1.user_ids.#", "1"),
					resource.TestCheckResourceAttrPair(address, "layers.1.user_ids.0", "oneuptime_team_member.first", "user_id"),
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
