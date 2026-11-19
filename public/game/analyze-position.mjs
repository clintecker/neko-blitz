import { analyze, analyzeDiscard, readOpponents } from "./coach.mjs";

// A caller synthesises this phase to ask for reads while another seat decides.
export const WATCH_PHASE = "watch";

// A viewer can request public reads while another player is deciding. Callers
// that pass WATCH_PHASE must also restore the pre-draw discard and stockCount
// (app/use-advice.js does).
export function analyzePosition(view, options) {
  if (view.phase === WATCH_PHASE)
    return { reads: readOpponents(view, options) };
  return (view.phase === "throw" ? analyzeDiscard : analyze)(view, options);
}
