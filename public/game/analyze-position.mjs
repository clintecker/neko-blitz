import { analyze, analyzeDiscard, readOpponents } from "./coach.mjs";

// A viewer can request public reads while another player is deciding.
export function analyzePosition(view, options) {
  if (view.phase === "watch") return { reads: readOpponents(view, options) };
  return (view.phase === "throw" ? analyzeDiscard : analyze)(view, options);
}
