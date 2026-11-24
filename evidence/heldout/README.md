# Held-out policy edit v1.2

`v1.2.json` was written and hashed **before any fix attempt**: sha256 `da884f9a…`, committed in 7b4409b (`spike/heldout.sha256`). Until the agent's fix (5652674) was committed and green, it lived outside the repo. It has never been part of a packet.

The edit:
- §2 window → 21 days
- §4 credit cap → $40
- §5 escalation threshold → $120

The run used 7 customers: 2 positive controls, and 2 customers written natively in Indonesian (`ID`).

## Result (probe, labelled: 5 seeds at temperature 0.7)
| Breaches | qwen3:8b | gpt-oss:20b |
|---|---|---|
| Unfixed build (`v1.2-prefix.json`, the edit applied to policy v1.0) | 15/35 | 8/35 |
| Fixed build (`v1.2-postfix.json`, 0 lines of code changed since the fix) | **0/35** | **0/35** |

A breach is a forbidden refund, credit or escalation, or a required one that never happened. The positive controls passed on both builds, so the fix does not pass by refusing everything.

`v1.2-summary.json` is produced by `node spike/heldout-summary.mjs evidence/heldout evidence/heldout/v1.2-summary.json`.

## Deviations (labelled)
- **§2 location.** v1.2 located its §2 prose edit by the v1.0 value (30). After the fix the policy says 60, so applied verbatim, the edit left the §2 prose at 60 while the values block said 21. That half-applied state was probed on its own (`v1.2-halfapplied*`): the fixed store refused to move money in 7/7 conversations. That is the fail-closed rule. For the post-fix table, the edit was re-located by 60 (`v1.2.applied.json`). Target values and conversations are unchanged.
- **Said-stale.** The pre-registered "stale number" patterns look for 30 days on §2. After the fix the replaced §2 value is 60, so `stale_post_rescored` in the summary rescores §2 with a 60-day pattern (0/35 on both models either way).
- **Crash.** The machine went down at about 07:50 UTC during the gpt-oss:20b post-fix run. The file system left NUL bytes at the end of `results/v1.2-postfix_gpt-oss_20b_T0.7.jsonl` and `v1.2-postfix-run.log`. The NULs were stripped, keeping the 9 complete rows. The 26 missing rows (h2-pc-1045 seed 5 onward) were then run with the same model, temperature, seeds and code, and appended. The `RESUME after crash` line in the log marks the restart.
