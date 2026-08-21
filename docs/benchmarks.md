---
title: Benchmarks
description: Public Sumi Docs performance methods, thresholds, and reference results.
---

Sumi Docs publishes the method, environment, thresholds, and result together.
A number without its source commit and workload is not accepted as performance
evidence.

## Cold-start contract

The cold-start benchmark measures process spawn to the first valid `tools/list`
response. It interleaves three subjects in a seeded random order so machine
drift affects the product and baselines together:

| Subject                       | Purpose                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| Raw SEA responder             | Measures process and protocol framing overhead only.           |
| Official SDK empty SEA server | Measures the installed official MCP SDK without product tools. |
| Sumi Docs SEA                 | Serves `examples/basic/docs` and advertises all four tools.    |

Each release run performs 100 attempts per subject, sequentially, with a 5 s
timeout and bounded termination. The release gate requires zero errors and
timeouts, product median at most 200 ms, product p95 at most 350 ms, median no
more than 35 ms and 1.30 times above the SDK baseline, and p95 no more than 75
ms above it. P99 and maximum values are diagnostic because host scheduling can
produce isolated outliers.

## Reference run - 2026-08-21

This local reproducibility run used MCP source commit
[`5bc5b15`](https://github.com/starSumi/sumi-docs/commit/5bc5b15a1038cde2745b61d130e6b9f78c7bb4de).
The measured executable was built from that source revision. Later documentation
and repository-policy changes did not alter its MCP runtime bytes, so this result
is a public reference, not accepted release evidence. The release workflow must
run the same command on the exact candidate commit and retain its raw JSON
artifact.

| Environment                | Value                                                              |
| -------------------------- | ------------------------------------------------------------------ |
| Runtime                    | Node.js 25.5.0                                                     |
| Platform                   | Windows 11 x64, OS build 26200                                     |
| CPU                        | 12th Gen Intel Core i5-1235U, 12 logical CPUs                      |
| Memory                     | 25,480,912,896 bytes                                               |
| Iterations                 | 100 per subject, 300 total attempts                                |
| Product executable SHA-256 | `5be6dbf1ad40177d9c6c8a427217dc2d68dc66cc65966cd86862d0ad8c86cf50` |

Gate metrics:

| Subject                |   Minimum |    Median |       p95 |
| ---------------------- | --------: | --------: | --------: |
| Raw SEA                |  69.53 ms |  80.91 ms | 103.71 ms |
| Official SDK empty SEA | 126.38 ms | 141.27 ms | 179.59 ms |
| Sumi Docs SEA          | 151.80 ms | 167.10 ms | 214.50 ms |

Diagnostic metrics:

| Subject                |       p99 |   Maximum |
| ---------------------- | --------: | --------: |
| Raw SEA                | 114.17 ms | 564.30 ms |
| Official SDK empty SEA | 214.75 ms | 685.79 ms |
| Sumi Docs SEA          | 238.59 ms | 698.93 ms |

All 300 attempts completed with zero errors and zero timeouts.

The product-to-SDK median delta was 25.83 ms, the median ratio was 1.1828, and
the p95 delta was 34.91 ms. Every current E-X02 threshold passed.

## Reproduce

Use the pinned runtime and build the executable before measuring:

```powershell
volta run --node 25.5.0 -- pnpm run build:sea
volta run --node 25.5.0 -- pnpm run benchmark:cold-start --docs examples/basic/docs --iterations 100 --executable artifacts/bin/sumi-docs-mcp.exe --output ../../artifacts/cold-start.json
```

The output contains the full schedule, seed, executable and source digests,
environment, every sample, and policy evaluation. `artifacts/` remains ignored;
candidate workflows upload the raw report as immutable run evidence rather
than committing mutable measurements to the documentation corpus.
