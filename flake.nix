# Model-output: Claude Opus 5
#
# Development shell for building beszel from source.
#
#   nix develop        # then: make build, make build-agent OS=windows ARCH=amd64, make test, ...
{
  description = "beszel development shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      for_all_systems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = for_all_systems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.go_1_27 # go.mod requires 1.27; pkgs.go still lags behind it
            pkgs.bun # builds internal/site for the hub
            pkgs.dotnet-sdk_9 # agent/lhm, the net48 sensor helper embedded in the Windows agent
            pkgs.golangci-lint # make lint
            pkgs.entr # optional, but the make dev-* targets hot-reload only when it is present
          ];

          DOTNET_CLI_TELEMETRY_OPTOUT = 1;
          DOTNET_NOLOGO = 1;
        };
      });
    };
}
