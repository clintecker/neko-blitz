# Neko Arcade Blitz strategy study

This is the calculation behind the in-game guide. The family game starts with four tokens. A knocker on 22 against 26, 20 and 17 keeps their token and only the 17 pays. Every other active seat has one final turn. A suited 31 immediately charges all rivals. A failed knock costs one, and triples use ordinary suit scoring. In the study the knocker is protected on a low tie. The game lets you change that tie rule.

## Reproduce the results

From the directory containing this README in the downloaded ZIP, run the following in Node 22 or newer. There are no package dependencies. Card IDs are A through K in spades, hearts, clubs and diamonds.

~~~sh
node checks/study/family-openings.mjs 40000 > family-openings.json
node checks/study/survey.mjs 32 600 4,3,2 match lowest > family-match-survey.json
node checks/study/benchmark.mjs 40000 match lowest 4,3,2 > family-match-benchmark.json
node checks/study/verify.mjs 12000 lowest
node checks/study/edge-cases.mjs
node checks/study/discard-reading.mjs 4000 > defensive-throws.json
node checks/study/denial-example.mjs 4000 > denial-example.json
~~~

The opening survey samples 32 visible hands per score and table size, conditional on a face-up card that cannot increase the current score. Every move sees the same 600 possible deals. The named four-player examples compare 40,000 paired deals apiece. The archive includes individual hands and seeds.

## What the numbers measure

The coach holds known public pickups fixed. It samples compatible private hands and stock orders, reverses visible exchanges to check consistency and gives more weight to deals that explain public decisions. It selects continuations on a separate pilot sample. The match estimate uses the remaining lives and future-deal frequencies calibrated on 60,000 fresh arcade-bot rounds per table size.

Win match maximizes predicted match wins. Keep my token minimizes the chance of paying this round. Token edge maximizes expected rival losses averaged across rivals minus your own loss. The current-hand calculation estimates sampling uncertainty. Its predictions also depend on the modeled players and continuation choices. Table-reading bots and people can play differently.

The optional everyone-below-highest scoring variation has its own results. Use the payout argument `highest` for that benchmark or survey.


## Public-information discard example

With 10♠ Q♠ K♦ K♥, either king leaves 20 points. In the reproduced position the next player took A♥ and Q♥ and still holds both. K♥ offers a guaranteed 31 and K♦ cannot make their 31. Switch their public cards to A♦ and Q♦ and the coach reverses its discard. The JSON includes the model estimates for each throw. The script also checks the last turn after a knock and the rule that a freshly taken face-up card must stay in hand.
