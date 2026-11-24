package provider

import (
	"math/big"
	"testing"

	"github.com/hashicorp/terraform-plugin-framework/types"
)

func TestLookupNumber(t *testing.T) {
	if got := LookupNumber(types.NumberValue(big.NewFloat(3))); got != float64(3) {
		t.Errorf("lookupNumber(3) = %v", got)
	}
	if got := LookupNumber(types.NumberValue(big.NewFloat(2.5))); got != 2.5 {
		t.Errorf("lookupNumber(2.5) = %v", got)
	}
	if got := LookupNumber(types.NumberNull()); got != nil {
		t.Errorf("lookupNumber(null) = %v", got)
	}
	if got := LookupNumber(types.NumberUnknown()); got != nil {
		t.Errorf("lookupNumber(unknown) = %v", got)
	}
}

func TestDescribeLookup(t *testing.T) {
	if got := DescribeLookup([]string{`priority = 3`, `name = "Offline"`}); got != `{name = "Offline", priority = 3}` {
		t.Errorf("describeLookup = %s", got)
	}
	if got := DescribeLookup(nil); got != "{}" {
		t.Errorf("describeLookup(nil) = %s", got)
	}

	parts := []string{"b = 1", "a = 2"}
	DescribeLookup(parts)
	if parts[0] != "b = 1" {
		t.Errorf("describeLookup sorted its argument in place")
	}
}
