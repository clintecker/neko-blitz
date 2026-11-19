# Strategy and the coach

The default objective is to win the match. The coach can also prioritize keeping your token in the current round or maximizing your expected token advantage over rivals.

## Why an early knock can work

With lowest-only payouts, you need to finish above at least one rival to avoid paying, subject to the configured low-tie rule. An opening hand can already make that likely. Waiting gives rivals more chances to improve, and a discard can help the next player directly.

The threshold depends on player count, remaining lives, visible cards, payout and tie settings, and the opponents' behavior. The coach evaluates those inputs. A score-only threshold is a rough summary of a particular situation.

## What is observable

The model sees your cards, the public discard history, visible pickups, the opening discard, active seats, lives, stock count, and the knock state. Known face-up pickups stay assigned to a player until visibly discarded. Private stock draws remain unknown.

Visible choices are evidence about a player's intended suit. A player repeatedly taking hearts is more likely to be collecting hearts. Passing on a card is weaker evidence because the stock may offer something better.

## Defensive discards

With 10♠, Q♠, K♦, and K♥, either king can leave you with 20. If the next player visibly took and retained A♥ and Q♥, throwing K♥ gives them 31. Throwing K♦ preserves the same personal score and avoids that immediate gift.

The model weighs the next player's potential improvement as part of the discard evaluation. Table-reading bots use the same category of public evidence. They do not inspect the hidden cards they are trying to infer.

## Model boundaries

The coach samples compatible hidden deals and stock orders, retains hard public-card constraints, and weights plausible choices under its opponent policy. It uses a separate pilot to select continuations before evaluating outcomes. Match estimates additionally use calibrated future-deal outcomes and remaining tokens.

A displayed probability estimates the model's outcome for the current public position. Sampling error and assumptions about opponent behavior both matter. Humans and table-reading bots can behave differently from the calibration opponents. Strategy changes should be checked against paired scenarios and full matches.

## Reproduce the research

The source study runs with Node alone. From the repository root, for example, generate a smaller opening survey and verify edge cases.

```sh
node checks/study/family-openings.mjs 1000 > family-openings.json
node checks/study/edge-cases.mjs
node checks/study/denial-example.mjs 4000 > denial-example.json
```

Larger paired surveys and benchmarks take substantially longer. The source study README lists the full commands, objectives, scoring variants, and sample sizes. The app's guide uses the included `app/study-data.json`. The downloadable `public/strategy-study.zip` is a bundled research snapshot. Source scripts are the maintained entry point for new experiments.

See [the complete study instructions](../checks/study/README.md).
