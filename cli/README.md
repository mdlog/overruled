# overruled

Your policy page says one thing. Your code says another. `overruled sites` lists every line in your codebase that restates a number from your policy page: constants, prompt text, tool schemas, refusal messages, page copy, database constraints and tests. That way, when someone edits the policy, you can see exactly what will quietly overrule them.

No dependencies. No model. No network. Not on npm yet: run it straight from GitHub with `npx github:mdlog/overruled`.

```sh
npx github:mdlog/overruled sites policy.md src/
```

```
§2 Refund window — 30 days: 4 in source, 6 in tests/docs/comments
  ● src/assistant.js:107  [prompt]  - §2: Within 30 days of delivery, a refund is for the full order total …
  ● src/policy.js:11  [constant]  refundWindowDays: 30, // §2
  ● src/tools.js:50  [code]  'Refund an order to the original payment method. Only allowed within 30 days …
  ● src/views.js:118  [page-copy]  <p class="lede">… Refunds are available within 30 days of delivery …
```

## What it finds
- **Policy numbers.** It finds day counts, dollar amounts and percentages, and ties each one to the clause heading it sits under (`## §2 Refund window`).
- **Literal forms.** `30 days`, `30-day`, `$25`, `$25.00`.
- **Derived forms.**
  - Number words: `thirty days`.
  - Cents: `2500` for `$25`.
  - Bare numbers next to a matching word: `refundWindowDays: 30`.
- **Source vs. the rest.** Each hit is classed as source (constant, prompt, tool-schema, refusal, page-copy, db-check, code) or not (test, readme, doc, comment). Only source lines count toward the residual.

## After someone edits the policy
To search only for the numbers that changed, using their **old** values:

```sh
npx github:mdlog/overruled sites policy.md . --from HEAD~1:policy.md
# §2 Refund window: 30 days → 60 days (loosen)
```

To fail CI while any source line still restates a policy number:

```sh
npx github:mdlog/overruled sites policy.md . --residual   # exit 1 while any source line restates a policy number
```

`--json` prints `{ diffs, numbers, sites[] }`, where each site has `clause_id`, `file`, `line`, `text`, `kind` and `in_source`.

## The rest of the loop
`overruled check` is the part that runs [Kane CLI](https://www.npmjs.com/package/@testmuai/kane-cli) as your customer when the policy changes and hands what it finds to Claude Code. It is set up in `overruled.config.json` in the repo this package comes from. `sites` works on its own.
