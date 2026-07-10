# P4NR Agent Pipeline — node-red-contrib-modbus v5 (Open Source)

**Public LTS** — `node-red-contrib-modbus` v5.x on GitHub.

For **v6 closed (TLS)**, see `P4NR/modbus/node-red-contrib-modbus/docs/p4nr/README.md`.

## Repository Matrix

| | **v5 OSS (this repo)** | **v6 closed** |
|---|------------------------|-----------------|
| Path | `BIANCO-ROYAL/node-red-contrib-modbus` | `P4NR/modbus/node-red-contrib-modbus` |
| Version | `5.x` | `6.0.0-beta.x` |
| Visibility | Open Source | `private: true` |
| TLS | — | yes |
| Server | in-package | separate pkg |

## Teams

| # | Agent | Output |
|---|-------|--------|
| 1 | `p4nr-spec-author` | `capabilities/`, `plans/` |
| 2 | `p4nr-spec-reviewer` | `reviews/` (APPROVE/REJECT) |
| 3 | `p4nr-developer` | `src/`, `test/` |

## Flow

```
Feature/Bug → Team 1 → Team 2 → GATE 1 → Team 3 → GATE 2 → PR/commit
```

## OSS Notes

- Prefer non-breaking changes in v5
- CHANGELOG for user-visible work
- Community PRs: spec optional for trivial fixes if you explicitly waive GATE 1
