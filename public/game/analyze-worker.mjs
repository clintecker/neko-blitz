import { analyzePosition } from "./analyze-position.mjs";

// This worker receives only the seated player's public view. It never receives the actual deck.
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      result: analyzePosition(data.view, {
        samples: 1800,
        seed: data.seed,
        objective: data.objective,
      }),
    });
  } catch {
    self.postMessage({
      id: data.id,
      error: "The coach could not read this deal.",
    });
  }
};
