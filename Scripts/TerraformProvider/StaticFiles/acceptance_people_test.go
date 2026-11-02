package provider

/*
 * People named by email address, through a real Terraform against a real
 * OneUptime (see acceptance_helpers_test.go for when these run): a team
 * member invited by an address nobody in the project has, then put on call
 * and made an owner by the same address, found again by oneuptime_user, and
 * imported by team and address. After every apply terraform-plugin-testing
 * plans again and fails on any change, so each step also proves the plan
 * settles - which an accepted member's never did before.
 *
 * Each run invites an address of its own (example.com, so nobody is mailed),
 * so runs never share a person, and the invitation limit per address is
 * never reached.
 */

import (
	"fmt"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-testing/helper/acctest"
	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
	"github.com/hashicorp/terraform-plugin-testing/plancheck"
	"github.com/hashicorp/terraform-plugin-testing/terraform"
)

func testAccPersonEmail(name string) string {
	return fmt.Sprintf("tf-acc-%s-%s@example.com", name, strings.ToLower(acctest.RandString(10)))
}

func TestAccPeopleByEmail_teamMemberLifecycle(t *testing.T) {
	const memberAddress = "oneuptime_team_member.test"
	team := testAccName("TF Acc People Team")
	email := testAccPersonEmail("member")

	config := func(address string) string {
		return fmt.Sprintf(`
resource "oneuptime_team" "test" {
  name        = %q
  description = "Created by the provider's acceptance tests"
}

resource "oneuptime_team_member" "test" {
  team_id    = oneuptime_team.test.id
  user_email = %q
}
`, team, address)
	}

	resource.ParallelTest(t, resource.TestCase{
		PreCheck:                 func() { testAccPreCheck(t) },
		ProtoV6ProviderFactories: testAccProtoV6ProviderFactories,
		CheckDestroy: resource.ComposeAggregateTestCheckFunc(
			testAccCheckDestroyed("oneuptime_team_member", "/team-member"),
			testAccCheckDestroyed("oneuptime_team", "/team"),
		),
		Steps: []resource.TestStep{
			// Nobody in the project has the address: invited, as the dashboard does.
			{
				Config: config(email),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttrSet(memberAddress, "id"),
					resource.TestCheckResourceAttrSet(memberAddress, "user_id"),
					resource.TestCheckResourceAttr(memberAddress, "user_email", email),
					resource.TestCheckResourceAttr(memberAddress, "has_accepted_invitation", "false"),
					resource.TestCheckResourceAttrPair(memberAddress, "team_id", "oneuptime_team.test", "id"),
				),
			},
			// The same person in another case: the address changes in place,
			// and nothing else - not the person, not the membership.
			{
				Config:           config(strings.ToUpper(email)),
				ConfigPlanChecks: testAccUpdatesInPlace(memberAddress),
				Check:            resource.TestCheckResourceAttr(memberAddress, "user_email", strings.ToUpper(email)),
			},
			// By team and address, as written: the address stays in its case.
			{
				ResourceName:      memberAddress,
				ImportState:       true,
				ImportStateIdFunc: testAccMembershipImportID(memberAddress, strings.ToUpper(email)),
				ImportStateVerify: true,
			},
			// By its own ID: OneUptime's address, in lower case.
			{
				ResourceName:            memberAddress,
				ImportState:             true,
				ImportStateVerify:       true,
				ImportStateVerifyIgnore: []string{"user_email"},
			},
		},
	})
}

// testAccMembershipImportID is "<team_id>/<address>" of a membership in state.
func testAccMembershipImportID(address string, email string) resource.ImportStateIdFunc {
	return func(state *terraform.State) (string, error) {
		member, ok := state.RootModule().Resources[address]
		if !ok {
			return "", fmt.Errorf("%s is not in state", address)
		}
		return member.Primary.Attributes["team_id"] + "/" + email, nil
	}
}

/*
 * Someone invited in the same configuration takes a turn on call and owns a
 * monitor, named by ID through their membership (so they are invited
 * first) and then by address - the same person, so no change at all - and
 * oneuptime_user finds them by address.
 */
func TestAccPeopleByEmail_onCallOwnersAndLookup(t *testing.T) {
	const layerUser = "oneuptime_on_call_schedule_layer_user.test"
	const owner = "oneuptime_monitor_user_owner.test"
	const lookup = "data.oneuptime_user.test"
	team := testAccName("TF Acc People Team")
	schedule := testAccName("TF Acc People Schedule")
	monitor := testAccName("TF Acc People Monitor")
	email := testAccPersonEmail("oncall")

	config := func(layerPerson string) string {
		return fmt.Sprintf(`
resource "oneuptime_team" "test" {
  name = %[1]q
}

resource "oneuptime_team_member" "test" {
  team_id    = oneuptime_team.test.id
  user_email = %[4]q
}

resource "oneuptime_on_call_policy_schedule" "test" {
  name     = %[2]q
  timezone = "UTC"
}

resource "oneuptime_on_call_schedule_layer" "test" {
  on_call_duty_policy_schedule_id = oneuptime_on_call_policy_schedule.test.id
  name                            = "Weekly"
  starts_at                       = "2030-01-07T09:00:00.000Z"
  hand_off_time                   = "2030-01-14T09:00:00.000Z"
}

resource "oneuptime_on_call_schedule_layer_user" "test" {
  on_call_duty_policy_schedule_id       = oneuptime_on_call_policy_schedule.test.id
  on_call_duty_policy_schedule_layer_id = oneuptime_on_call_schedule_layer.test.id
  %[5]s
}

resource "oneuptime_monitor" "test" {
  name         = %[3]q
  monitor_type = "Manual"
}

resource "oneuptime_monitor_user_owner" "test" {
  monitor_id = oneuptime_monitor.test.id
  user_id    = oneuptime_team_member.test.user_id
}

data "oneuptime_user" "test" {
  email = oneuptime_team_member.test.user_email
}
`, team, schedule, monitor, email, layerPerson)
	}

	resource.ParallelTest(t, resource.TestCase{
		PreCheck:                 func() { testAccPreCheck(t) },
		ProtoV6ProviderFactories: testAccProtoV6ProviderFactories,
		CheckDestroy: resource.ComposeAggregateTestCheckFunc(
			testAccCheckDestroyed("oneuptime_on_call_schedule_layer_user", "/on-call-duty-schedule-layer-user"),
			testAccCheckDestroyed("oneuptime_monitor_user_owner", "/monitor-owner-user"),
			testAccCheckDestroyed("oneuptime_team_member", "/team-member"),
		),
		Steps: []resource.TestStep{
			{
				Config: config("user_id = oneuptime_team_member.test.user_id"),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttrPair(layerUser, "user_id", "oneuptime_team_member.test", "user_id"),
					resource.TestCheckResourceAttr(layerUser, "user_email", email),
					resource.TestCheckResourceAttrPair(owner, "user_id", "oneuptime_team_member.test", "user_id"),
					resource.TestCheckResourceAttr(owner, "user_email", email),
					resource.TestCheckResourceAttrPair(lookup, "id", "oneuptime_team_member.test", "user_id"),
					resource.TestCheckResourceAttr(lookup, "has_accepted_invitation", "false"),
					resource.TestCheckTypeSetElemAttrPair(lookup, "team_ids.*", "oneuptime_team.test", "id"),
				),
			},
			// The same person by address instead of by ID: nothing to do.
			{
				Config: config("user_email = oneuptime_team_member.test.user_email"),
				ConfigPlanChecks: resource.ConfigPlanChecks{
					PreApply: []plancheck.PlanCheck{plancheck.ExpectEmptyPlan()},
				},
			},
			{
				ResourceName:      layerUser,
				ImportState:       true,
				ImportStateVerify: true,
			},
			// OneUptime tells the new owner on its own time, after the apply.
			{
				ResourceName:            owner,
				ImportState:             true,
				ImportStateVerify:       true,
				ImportStateVerifyIgnore: []string{"is_owner_notified", "updated_at"},
			},
		},
	})
}
