// Model-output: Claude Fable 5
// Model-output: Claude Opus 5.5

//go:build testing

package systems

import (
	"context"
	"testing"

	"github.com/henrygd/beszel/internal/entities/system"
)

func TestCombinedData_MigrateDeprecatedFields(t *testing.T) {
	t.Run("Migrate Info fields to Details struct", func(t *testing.T) {
		cd := &system.CombinedData{
			Stats: system.Stats{
				Mem: 16.0, // 16 GB
			},
			Info: system.Info{
				Hostname:      "test-host",
				KernelVersion: "6.8.0",
				Cores:         8,
				Threads:       16,
				CpuModel:      "Intel i7",
				Podman:        true,
				Os:            system.Linux,
			},
		}
		migrateDeprecatedFields(cd, true)

		if cd.Details == nil {
			t.Fatal("expected Details struct to be created")
		}
		if cd.Details.Hostname != "test-host" {
			t.Errorf("expected Hostname 'test-host', got '%s'", cd.Details.Hostname)
		}
		if cd.Details.Kernel != "6.8.0" {
			t.Errorf("expected Kernel '6.8.0', got '%s'", cd.Details.Kernel)
		}
		if cd.Details.Cores != 8 {
			t.Errorf("expected Cores 8, got %d", cd.Details.Cores)
		}
		if cd.Details.Threads != 16 {
			t.Errorf("expected Threads 16, got %d", cd.Details.Threads)
		}
		if cd.Details.CpuModel != "Intel i7" {
			t.Errorf("expected CpuModel 'Intel i7', got '%s'", cd.Details.CpuModel)
		}
		if cd.Details.Podman != true {
			t.Errorf("expected Podman true, got %v", cd.Details.Podman)
		}
		if cd.Details.Os != system.Linux {
			t.Errorf("expected Os Linux, got %d", cd.Details.Os)
		}
		expectedMem := uint64(16 * (1 << 30)) // pre-Details agents sent GiB
		if cd.Details.MemoryTotal != expectedMem {
			t.Errorf("expected MemoryTotal %d, got %d", expectedMem, cd.Details.MemoryTotal)
		}

		if cd.Info.Hostname != "" || cd.Info.KernelVersion != "" || cd.Info.Cores != 0 || cd.Info.CpuModel != "" || cd.Info.Podman != false || cd.Info.Os != 0 {
			t.Errorf("expected Info fields to be reset, got %+v", cd.Info)
		}
	})

	t.Run("Do not migrate if Details already exists", func(t *testing.T) {
		cd := &system.CombinedData{
			Details: &system.Details{Hostname: "existing-host"},
			Info: system.Info{
				Hostname: "deprecated-host",
			},
		}
		migrateDeprecatedFields(cd, true)

		if cd.Details.Hostname != "existing-host" {
			t.Errorf("expected Hostname 'existing-host', got '%s'", cd.Details.Hostname)
		}
		if cd.Info.Hostname != "deprecated-host" {
			t.Errorf("expected Info.Hostname to remain 'deprecated-host', got '%s'", cd.Info.Hostname)
		}
	})

	t.Run("Do not create details if migrateDetails is false", func(t *testing.T) {
		cd := &system.CombinedData{
			Info: system.Info{
				Hostname: "deprecated-host",
			},
		}
		migrateDeprecatedFields(cd, false)

		if cd.Details != nil {
			t.Fatal("expected Details struct to not be created")
		}

		if cd.Info.Hostname != "" {
			t.Errorf("expected Info.Hostname to be reset, got '%s'", cd.Info.Hostname)
		}
	})
}

func TestSetDownAfterContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	// manager is nil on purpose: setDown must bail out before touching the app
	sys := &System{Status: up, ctx: ctx}

	if err := sys.setDown(nil); err != context.Canceled {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
	if sys.Status != up {
		t.Fatalf("status should be untouched, got %q", sys.Status)
	}
}
