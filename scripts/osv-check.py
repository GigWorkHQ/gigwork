#!/usr/bin/env python3
"""Fail if any package pinned in the given bun.lock files has a known OSV advisory.

Usage: python3 scripts/osv-check.py [--report-only] LOCKFILE...
Queries api.osv.dev directly, so CI needs no extra binary.
"""
import json
import re
import sys
import urllib.request

PACKAGE = re.compile(r'"((?:@[^"/\s]+/)?[^"@\s]+)@(\d+\.\d+\.\d+[^"]*)"\s*,\s*"')


def advisories(lockfile):
    text = open(lockfile, encoding="utf-8").read()
    packages = sorted(set(PACKAGE.findall(text)))
    queries = [{"package": {"name": name, "ecosystem": "npm"}, "version": version} for name, version in packages]
    hits = []
    for start in range(0, len(queries), 500):
        chunk = queries[start:start + 500]
        request = urllib.request.Request(
            "https://api.osv.dev/v1/querybatch",
            data=json.dumps({"queries": chunk}).encode(),
            headers={"content-type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            results = json.load(response)["results"]
        for query, result in zip(chunk, results):
            if result.get("vulns"):
                hits.append((query["package"]["name"], query["version"], [v["id"] for v in result["vulns"]]))
    return len(packages), hits


def main(argv):
    report_only = "--report-only" in argv
    failed = False
    for lockfile in [a for a in argv if not a.startswith("--")]:
        count, hits = advisories(lockfile)
        print(f"{lockfile}: {count} packages, {len(hits)} with advisories")
        for name, version, ids in hits:
            print(f"  {'::warning::' if report_only else '::error::'}{name}@{version} {' '.join(ids)}")
        failed = failed or bool(hits)
    return 0 if report_only or not failed else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
