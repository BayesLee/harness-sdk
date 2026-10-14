# Independent reproduction of Strands #4241

Issue: https://github.com/strands-agents/harness-sdk/issues/4241

This package reproduces the TypeScript retrieval tool's stream result status. It does not change the SDK implementation or contain a proposed fix. It was prepared with AI assistance and reviewed against the original local reproduction.

The baseline is `79cd7356d3947e2f1bdfa65529938f80aad03b87`. It uses the real `createRetrievalTool`, `Stash`, and `InMemoryStorage`; only the `ToolContext` comes from the upstream fixture. No Agent, model, API credentials, or network call is involved when running the reproduction. Python behavior is outside its scope.

| Scenario | Baseline stream status | Proposed status expectation |
| --- | --- | --- |
| Missing reference | `success` | `error` |
| Pattern search on image content | `success` | `error` |
| Full text retrieval | `success` | `success` |
| Search with no matches | `success` | `success` |

The status expectation follows the issue description; the maintainer has not confirmed the preferred `.invoke()` failure semantics. Contract mode records either the raw `.invoke()` return or its exception without prescribing that interface's failure behavior. It checks the complete `.stream()` result, including its content, against the expectations above.

## Run offline against an existing source tree

Requirements: Python 3.9+, Node 22+, and an existing harness-sdk source directory with its npm dependencies already installed. The SDK source need not be inside this package or its parent repository.

```bash
python3 run.py --source /path/to/pinned/harness-sdk --mode baseline
python3 run.py --source /path/to/pinned/harness-sdk --mode contract
```

Pass `--node /path/to/node` if Node is not on `PATH`. Results are written to a new temporary directory, outside both source trees. Optional `--output /path/to/new-empty-results` selects a different new or empty directory. No Git commands, credentials, network downloads, dependency installs, or SDK writes are performed by this runner. TSX's filesystem cache is disabled.

On the pinned baseline, `baseline` exits **0**, confirming all four observed outputs and the two status mismatches. `contract` exits **1**, with a freshly generated JSON result naming the two failing cases. A runtime crash or missing JSON is also a failure and must not be counted as a successful reproduction.

`--mode both` runs both and exits **1** on the pinned baseline. This is intentional: it exposes the failing contract instead of turning the expected nonzero result into a passing regression gate.

For a future fix, run `--mode contract` alone against that source tree. It does not enforce the original bug count or baseline fingerprints; it exits **0** only if all four stream results meet the proposed expectations. The expectation may need to be revised after maintainer guidance.

Baseline mode verifies the 15 hashes in `baseline-files.json`, covering the directly exercised source, wrapper, search helpers, and dependency manifests. These selected fingerprints are not a claim that every file in an arbitrary supplied tree belongs to that commit. Contract mode does not claim the supplied tree is the unchanged baseline.

## Prepare the pinned baseline in a new temporary directory

These are optional, manual setup steps. They require network access and operate entirely in the newly created directory; the runner itself never downloads or installs anything. Do not run them in a company checkout or an existing working tree.

```bash
repro_work=$(mktemp -d)
mkdir "$repro_work/source" "$repro_work/npm-cache"
touch "$repro_work/npm-user.conf" "$repro_work/npm-global.conf"
curl --fail --location --output "$repro_work/source.tar.gz" 'https://codeload.github.com/strands-agents/harness-sdk/tar.gz/79cd7356d3947e2f1bdfa65529938f80aad03b87'
python3 -c 'import hashlib, pathlib, sys; assert hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest() == "d0bdd1b3b6e829e2f4c00d98369ead329e279e408b8455bea25d8dfd6cb99ff7"' "$repro_work/source.tar.gz"
tar -xzf "$repro_work/source.tar.gz" --strip-components=1 -C "$repro_work/source"
env -i PATH="$PATH" npm --prefix "$repro_work/source" ci --ignore-scripts --no-audit --no-fund --userconfig "$repro_work/npm-user.conf" --globalconfig "$repro_work/npm-global.conf" --cache "$repro_work/npm-cache" --git=/usr/bin/false
python3 run.py --source "$repro_work/source" --mode baseline
python3 run.py --source "$repro_work/source" --mode contract
```

The expected archive SHA256 is shown in the assertion. Use a separate reproduction package path when invoking `run.py` if your current directory is elsewhere. Installation uses the pinned upstream lockfile, blank npm user/global configuration, a separate cache, disabled lifecycle scripts, and a disabled Git executable. `env -i` preserves only `PATH`, clearing inherited authentication, proxy, `NODE_OPTIONS`, and `NPM_*` variables; it does not assign or change `HOME`. This prevents those variables from a company shell from reaching the installer. It does not use this package's parent repository for dependencies or authentication.

## Portable package validation, 2026-10-14

The portable package was rerun against the pinned baseline on 2026-10-14. Baseline mode exited **0**; contract mode exited **1**, with fresh JSON recording the two failing status cases and both successful controls. This verifies that the portable runner reproduces the unchanged baseline behavior; it does not verify a fix. No SDK implementation was changed and no Agent/model was invoked. The 105 upstream tests below remain historical results and were not rerun in this validation.

## Historical evidence and limits

`historical-results.json` summarizes the original **2026-10-08 Asia/Shanghai** run: Node 24.19.0, Vitest 4.1.11, TSX 4.22.5, macOS arm64. The reproduction matched all four baseline observations, and the status contract failed in the two cases above.

Four existing upstream unit test files passed: retrieval-tool (8), stash (8), tool (57), and zod-tool (32), totaling **105 tests**, with `unit-node` and `retry=0`. They were not new regression tests and do not establish that the bug was fixed. This historical count is not a fresh run of this portable package or a full repository test/type-check result.

The original source archive's 3,165 regular files were also compared with the local source; zero were changed or missing. Six unrelated archive symlinks were omitted during the original extraction. Generated dependencies and test reports were outside that comparison. This package includes neither the SDK source nor its dependencies, archive, raw logs, authentication configuration, or local screenshots.

The original reproduction was shared on the issue:
https://github.com/strands-agents/harness-sdk/issues/4241#issuecomment-6044149010

The later coordination follow-up is:
https://github.com/strands-agents/harness-sdk/issues/4241#issuecomment-6164554605

This branch is reproduction material, not a pull request or maintainer-approved implementation. The next step is to agree on the failure contract and collaboration scope before changing SDK code.
