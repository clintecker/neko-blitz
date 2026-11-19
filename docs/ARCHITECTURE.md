# Architecture

BLITZ is a React application served by a Vinext Worker. Solo state stays in the browser. Shared rooms are owned by the server and stored as versioned D1 documents.

## State and rules

`public/game/table.mjs` owns the card representation, shuffle, legal actions, scoring, round resolution, and `projectTable()`. IDs 0–51 represent A through K in spades, hearts, clubs, and diamonds. A table stores all private cards. A projected view exposes the requesting player's hand and public game information.

`app/use-table.js` composes the table from focused modules. `table-store.js` owns the storage keys and the read and save helpers. `room-api.js` is the stateless client for `/api/table`. `room-session.js` owns the seat session, boot restore, polling, operation serialization, and entering or leaving a room. `solo-opponent.js` owns the solo bot timer. `use-advice.js` owns the reads-sheet analysis request. The composition hook creates the solo table, seat, live snapshot, and generation refs once and passes them to those hooks rather than letting each keep its own copy.

A solo match is saved in `localStorage`. A room token is held in `sessionStorage`. Ending a solo game clears the saved table and persists the lobby state. Generation checks prevent a stale restore request from reviving an abandoned session.

## Online rooms

`app/api/table/route.js` validates requests, hashes bearer tokens, identifies a seat, applies actions to the server table, and returns a projected view. `blitz_rooms` has four columns.

| Column | Meaning |
| --- | --- |
| `code` | Seven-character room identifier |
| `revision` | Monotonically increasing optimistic-concurrency version |
| `updated` | Last update time in milliseconds |
| `body` | JSON room document, including private table state and hashed seat credentials |

Writes compare the stored revision. When another request wins a race, the route returns a fresh projected snapshot marked stale. Clients retry an exit against the updated version. Game actions remain subject to current turn and card legality.

The host can end a room for all players. The room is marked ended and its active table is removed. Polling clients clear their local room session and return to the lobby. A guest who leaves a running match is removed from room membership and their hand becomes bot-controlled. Leaving a waiting room frees the original seat ID for a later guest.

A room code locates a room. The bearer token grants access to an existing seat. Keep these roles distinct when changing the API.

## Strategy

`reads.mjs` reconstructs public observations. `coach.mjs` samples compatible hidden deals, scores candidate actions, and estimates round and match outcomes. `analyze-position.mjs` provides the UI-facing result. `analyze-worker.mjs` moves that work off the main thread. An in-process fallback allows the coach to recover when a worker cannot start.

`arcade-bots.mjs` implements the standard and table-reading opponent policies. Public inferences can affect both a discard choice and a knock decision. The detailed model and study commands are in the [strategy guide](STRATEGY.md).

## Presentation

`app/arcade.jsx` coordinates the table, tutorial, lobby, tool sheets, and shared actions. `club-lobby.jsx` and its stylesheet own the lobby composition. `turn-motion.jsx` owns the on-screen transfer queue, preventing a repeated room poll from replaying a card flight.

`pieces.jsx` renders reusable cards and sprites. The illustrated table uses nine-slice border artwork so corners keep their proportions across viewport shapes. Responsive rules reserve a single game viewport and let dialogs scroll as needed.

## Audio

`night-score.mjs` produces harmony and cue data. `night-synth.mjs` turns that score into Web Audio oscillators, filters, envelopes, delay, and stereo placement. `app/arcade-audio.js` owns the audio context, mixer preferences, gesture unlocking, background interruptions, and scheduling. React subscribes to the chord label without advancing the musical clock.

Game cues follow the visible motion queue, so card impacts stay synchronized with both local and polled remote turns. Muting and closing release oscillators and delay paths.

## Build and hosting

Vite, Vinext, and the Cloudflare plugin build the client bundle and Worker. D1 is declared under the `DB` binding. `wrangler.jsonc` declares the Worker and its `DB` binding. Numbered SQL migrations in `migrations/` create and evolve the room table. Wrangler tracks their application.

The Worker entry point directly exports Vinext's request handler. Game-room authorization uses seat tokens.
