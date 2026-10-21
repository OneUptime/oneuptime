package provider

/*
 * Acceptance tests drive the provider through a real Terraform against a real
 * OneUptime, with HashiCorp's terraform-plugin-testing: the harness HashiCorp
 * asks the providers it lists as Partner to pass. They create, plan, update,
 * import and destroy the core resources in the project of a project API key
 * (acceptance_test.go).
 *
 * They run only with TF_ACC=1, and then need ONEUPTIME_URL and
 * ONEUPTIME_API_KEY, the variables the provider itself reads. CI sets all
 * three in .github/workflows/terraform-provider-e2e.yml, against the stack and
 * test project its end-to-end suite uses, on every pull request, every night
 * and before every release. Everywhere else, `go test ./...` skips them.
 */

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"
	"github.com/hashicorp/terraform-plugin-go/tfprotov6"
	"github.com/hashicorp/terraform-plugin-testing/helper/acctest"
	"github.com/hashicorp/terraform-plugin-testing/helper/resource"
	"github.com/hashicorp/terraform-plugin-testing/terraform"
)

// The provider under test, served in-process to the Terraform the tests run.
var testAccProtoV6ProviderFactories = map[string]func() (tfprotov6.ProviderServer, error){
	"oneuptime": providerserver.NewProtocol6WithError(New("acceptance")()),
}

// testAccPreCheck fails a test that TF_ACC turned on without a OneUptime to
// run against.
func testAccPreCheck(t *testing.T) {
	t.Helper()

	for _, name := range []string{"ONEUPTIME_URL", "ONEUPTIME_API_KEY"} {
		if os.Getenv(name) == "" {
			t.Fatalf("%s must be set to run acceptance tests", name)
		}
	}
}

// testAccName is a name no other run in the project has used: a run that
// failed half-way leaves its records behind, and some names must be unique.
func testAccName(prefix string) string {
	return fmt.Sprintf("%s %s", prefix, acctest.RandString(8))
}

// testAccCheckDestroyed checks that OneUptime no longer has any resource of
// resourceType that the test's state held, by reading each one by id the way
// the provider does. A record that is gone answers 404; a server from before
// that answered an empty 200, which carries no _id.
func testAccCheckDestroyed(resourceType string, apiPath string) resource.TestCheckFunc {
	return func(state *terraform.State) error {
		client, err := NewClient(os.Getenv("ONEUPTIME_URL"), os.Getenv("ONEUPTIME_API_KEY"), "acceptance")
		if err != nil {
			return fmt.Errorf("creating a client to check that %s is gone: %w", resourceType, err)
		}

		for _, rs := range state.RootModule().Resources {
			if rs.Type != resourceType {
				continue
			}

			resp, err := client.Post(context.Background(), apiPath+"/"+rs.Primary.ID+"/get-item", map[string]interface{}{
				"select": map[string]interface{}{"_id": true},
			})
			if err != nil {
				return fmt.Errorf("reading %s %s after destroy: %w", resourceType, rs.Primary.ID, err)
			}

			body, readErr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if readErr != nil {
				return fmt.Errorf("reading %s %s after destroy: %w", resourceType, rs.Primary.ID, readErr)
			}

			switch {
			case resp.StatusCode == http.StatusNotFound:
				continue
			case resp.StatusCode >= 200 && resp.StatusCode < 300 && !strings.Contains(string(body), `"_id"`):
				continue
			default:
				return fmt.Errorf("%s %s is still there after destroy: HTTP %d: %s", resourceType, rs.Primary.ID, resp.StatusCode, body)
			}
		}

		return nil
	}
}
