"""Run the #4241 reproduction against an existing SDK tree without Git or network access."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path, help='Existing harness-sdk source root')
    parser.add_argument('--node', help='Node executable; defaults to node on PATH')
    parser.add_argument('--mode', choices=['baseline', 'contract', 'both'], default='both')
    parser.add_argument('--output', type=Path, help='New results directory; defaults to a temporary directory')
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parent
    source = arguments.source.resolve(strict=True)
    node_name = arguments.node or shutil.which('node')
    if not node_name:
        parser.error('Node was not found; pass --node PATH or add Node to PATH')
    node = Path(node_name).resolve(strict=True)
    tsx = source / 'node_modules/tsx/dist/cli.mjs'
    if not tsx.is_file():
        parser.error('The source tree must already have dependencies installed, including tsx')
    output = arguments.output.resolve() if arguments.output else Path(tempfile.mkdtemp(prefix='strands-4241-results-'))
    if output == source or source in output.parents or output == root or root in output.parents:
        parser.error('Results must be outside both the SDK tree and this reproduction package')
    if output.exists() and any(output.iterdir()):
        parser.error('The output directory must be new or empty, so stale evidence cannot be reused')
    output.mkdir(parents=True, exist_ok=True)
    modes = ['baseline', 'contract'] if arguments.mode == 'both' else [arguments.mode]
    if 'baseline' in modes:
        fingerprints = json.loads((root / 'baseline-files.json').read_text())
        for relative, expected in fingerprints['sha256'].items():
            file = source / relative
            if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
                parser.error(f'Pinned baseline mismatch: {relative}; contract mode may be used on a changed source tree')
        print(f"Pinned baseline fingerprints verified: {len(fingerprints['sha256'])} files", flush=True)
    environment = {
        'PATH': f'{node.parent}:/usr/bin:/bin',
        'TSX_DISABLE_CACHE': '1', 'CI': 'true', 'NO_COLOR': '1',
    }
    failed = False
    records = []
    for mode in modes:
        argv = [str(node), str(tsx), str(root / 'reproduce.mts'),
                '--source', str(source), '--mode', mode, '--output', str(output)]
        completed = subprocess.run(argv, env=environment, cwd=output, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, timeout=120)
        (output / f'{mode}.log').write_text(completed.stdout)
        print(completed.stdout, end='', flush=True)
        result_file = output / f'{mode}-results.json'
        valid = False
        failed_cases = None
        if result_file.is_file():
            result = json.loads(result_file.read_text())
            observations = result.get('observations', [])
            failed_cases = result.get('failedContractCases')
            valid = (result.get('mode') == mode and len(observations) == 4
                     and [item.get('id') for item in observations]
                     == ['missing-reference', 'non-text-pattern', 'full-text', 'no-match'])
            if mode == 'baseline':
                valid = valid and failed_cases == ['missing-reference', 'non-text-pattern']
            else:
                valid = valid and failed_cases == []
        passed = completed.returncode == 0 and valid
        failed = failed or not passed
        records.append({'mode': mode, 'exitCode': completed.returncode,
                        'resultFilePresent': result_file.is_file(), 'passed': passed,
                        'failedContractCases': failed_cases})
    (output / 'checks.json').write_text(json.dumps(records, indent=2) + '\n')
    print(f'Results: {output}', flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
