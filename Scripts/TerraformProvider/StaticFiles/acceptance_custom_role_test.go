package provider

/*
 * A CUSTOM ROLE THAT WORKFLOWS RUN AS, DESTROYED THROUGH A REAL TERRAFORM
 * AGAINST A REAL ONEUPTIME (#9832).
 *
 * The workflow is made over the API, as one someone built in the Dashboard:
 * no configuration manages it - the usual case, roles in Terraform and
 * workflows in the Dashboard. Then:
 *
 *   - destroying the role without saying what its workflows run as instead
 *     is refused, in the API's words and Terraform's, and the role stays;
 *   - workflows_run_as_on_delete and its role ID, applied, change nothing
 *     on the server: the workflow still runs as the role;
 *   - destroying the role then moves the workflow to the other role;
 *   - destroying the other role, which says "Default", leaves it running
 *     with the default permissions.
 *
 * The test project's API key holds Project Owner, so it may give a
 * workflow any role (#9765) and say what its workflows run as instead. See
 * acceptance_helpers_test.go for when these run.
 */

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
	"github.com/hashicorp/terraform-plugin-testing/terraform"
)

// testAccClient is a client of the OneUptime the acceptance tests run against.
func testAccClient(t *testing.T) *Client {
	t.Helper()

	client, err := NewClient(os.Getenv("ONEUPTIME_URL"), os.Getenv("ONEUPTIME_API_KEY"), "acceptance")
	if err != nil {
		t.Fatalf("creating a client: %s", err)
	}

	return client
}

// testAccAnswer reads an answer of the API: its JSON, or why it failed.
func testAccAnswer(resp *http.Response, doing string) (map[string]interface{}, error) {
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%s: reading the answer: %w", doing, err)
	}

	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s: HTTP %d: %s", doing, resp.StatusCode, body)
	}

	answer := map[string]interface{}{}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &answer); err != nil {
			return nil, fmt.Errorf("%s: the answer is not JSON: %s", doing, body)
		}
	}

	if data, ok := answer["data"].(map[string]interface{}); ok {
		return data, nil
	}

	return answer, nil
}

// testAccID is an ID as the API answers it: a string, or {"value": ...}.
func testAccID(value interface{}) string {
	switch id := value.(type) {
	case string:
		return id
	case map[string]interface{}:
		if inner, ok := id["value"].(string); ok {
			return inner
		}
	}

	return ""
}

// testAccCreateWorkflowRunningAs makes a workflow that runs as the role, as
// someone would in the Dashboard, and deletes it once the test is done.
func testAccCreateWorkflowRunningAs(t *testing.T, client *Client, name string, roleID string) string {
	t.Helper()

	resp, err := client.Post(context.Background(), "/workflow", map[string]interface{}{
		"data": map[string]interface{}{
			"name":              name,
			"description":       "Made by the provider's acceptance tests: runs as a custom role Terraform destroys.",
			"isEnabled":         false,
			"runAs":             "CustomRole",
			"runAsCustomRoleId": roleID,
		},
	})
	if err != nil {
		t.Fatalf("creating the workflow: %s", err)
	}

	created, err := testAccAnswer(resp, "creating the workflow")
	if err != nil {
		t.Fatal(err)
	}

	id := testAccID(created["_id"])
	if id == "" {
		t.Fatalf("the workflow's create answered no id: %v", created)
	}

	t.Cleanup(func() {
		resp, err := client.Delete(context.Background(), "/workflow/"+id)
		if err != nil {
			t.Logf("deleting the workflow %s: %s", id, err)
			return
		}
		resp.Body.Close()
	})

	return id
}

// testAccCheckWorkflowRunsAs checks what the workflow runs as now: the
// default permissions (roleID ""), or a custom role.
func testAccCheckWorkflowRunsAs(client func() *Client, workflowID *string, roleID *string) resource.TestCheckFunc {
	return func(_ *terraform.State) error {
		resp, err := client().Post(context.Background(), "/workflow/"+*workflowID+"/get-item", map[string]interface{}{
			"select": map[string]interface{}{
				"_id":               true,
				"runAs":             true,
				"runAsCustomRoleId": true,
			},
		})
		if err != nil {
			return fmt.Errorf("reading the workflow: %w", err)
		}

		workflow, err := testAccAnswer(resp, "reading the workflow")
		if err != nil {
			return err
		}

		runAs, _ := workflow["runAs"].(string)
		runsAsRole := testAccID(workflow["runAsCustomRoleId"])

		if *roleID == "" {
			if runAs != "Default" || runsAsRole != "" {
				return fmt.Errorf("the workflow runs as %q (custom role %q), not with the default permissions", runAs, runsAsRole)
			}
			return nil
		}

		if runAs != "CustomRole" || !strings.EqualFold(runsAsRole, *roleID) {
			return fmt.Errorf("the workflow runs as %q (custom role %q), not as the custom role %s", runAs, runsAsRole, *roleID)
		}

		return nil
	}
}

func TestAccCustomRole_deleteSaysWhatItsWorkflowsRunAs(t *testing.T) {
	const deletedAddress = "oneuptime_custom_role.deleted"
	const otherAddress = "oneuptime_custom_role.other"

	deletedName := testAccName("TF Acc Deleted Role")
	otherName := testAccName("TF Acc Other Role")
	workflowName := testAccName("TF Acc Runs As Role")

	var deletedID, otherID, workflowID string
	noRole := ""

	var client *Client
	clientOf := func() *Client {
		if client == nil {
			client = testAccClient(t)
		}
		return client
	}

	// The other role says its workflows run with the default permissions.
	other := fmt.Sprintf(`
resource "oneuptime_custom_role" "other" {
  name                       = %q
  workflows_run_as_on_delete = "Default"
}
`, otherName)

	both := func(deletedChoices string) string {
		return fmt.Sprintf(`
resource "oneuptime_custom_role" "deleted" {
  name = %q
%s}
%s`, deletedName, deletedChoices, other)
	}

	keep := func(into *string) resource.CheckResourceAttrWithFunc {
		return func(value string) error {
			*into = value
			return nil
		}
	}

	resource.Test(t, resource.TestCase{
		PreCheck:                 func() { testAccPreCheck(t) },
		ProtoV6ProviderFactories: testAccProtoV6ProviderFactories,
		CheckDestroy: resource.ComposeAggregateTestCheckFunc(
			testAccCheckDestroyed("oneuptime_custom_role", "/custom-role"),
			// Its last role deleted with "Default": the default permissions.
			testAccCheckWorkflowRunsAs(clientOf, &workflowID, &noRole),
		),
		Steps: []resource.TestStep{
			{
				Config: both(""),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttrWith(deletedAddress, "id", keep(&deletedID)),
					resource.TestCheckResourceAttrWith(otherAddress, "id", keep(&otherID)),
					resource.TestCheckNoResourceAttr(deletedAddress, "workflows_run_as_on_delete"),
					resource.TestCheckResourceAttr(otherAddress, "workflows_run_as_on_delete", "Default"),
				),
			},
			{
				// A workflow someone built in the Dashboard runs as the role.
				PreConfig: func() {
					workflowID = testAccCreateWorkflowRunningAs(t, clientOf(), workflowName, deletedID)
				},
				// Destroyed without saying what it runs as instead: refused.
				Config: other,
				// Terraform wraps the error's lines between any two words.
				ExpectError: regexp.MustCompile(`(?s)runs\s+as\s+the\s+custom\s+role.*set\s+workflows_run_as_on_delete\s+on\s+this\s+oneuptime_custom_role`),
			},
			{
				// Said, and applied: the role is changed in place, in state only.
				Config: both(`  workflows_run_as_on_delete                = "CustomRole"
  workflows_run_as_custom_role_id_on_delete = oneuptime_custom_role.other.id
`),
				ConfigPlanChecks: testAccUpdatesInPlace(deletedAddress),
				Check: resource.ComposeAggregateTestCheckFunc(
					resource.TestCheckResourceAttr(deletedAddress, "workflows_run_as_on_delete", "CustomRole"),
					resource.TestCheckResourceAttrPair(deletedAddress, "workflows_run_as_custom_role_id_on_delete", otherAddress, "id"),
					// Nothing changed on the server: it still runs as the role.
					testAccCheckWorkflowRunsAs(clientOf, &workflowID, &deletedID),
				),
			},
			{
				// Destroyed now: the workflow runs as the other role.
				Config: other,
				Check:  testAccCheckWorkflowRunsAs(clientOf, &workflowID, &otherID),
			},
		},
	})
}
