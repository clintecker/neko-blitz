import { cardText } from "../public/game/table.mjs";

// One vocabulary for the event kinds the table speaks in.
// Moves animate on the felt; the rest only narrate in the feed.
export const moveKinds = ["stock", "take", "throw", "knock"];
export const logKinds = ["deal", "blitz", "showdown", "play"];
export const eventKinds = [...moveKinds, ...logKinds];

// Caption and status copy for each move. `text` reads in the second person
// on your own turn.
export const moveCopy = {
  stock: {
    status: "Drawing from stock…",
    detail: "Face down",
    text: (who, self) => `${who} ${self ? "draw" : "draws"} from stock`,
  },
  take: {
    status: "Taking the face-up card…",
    detail: "From discard",
    text: (who, self, card) =>
      `${who} ${self ? "take" : "takes"} ${cardText(card)}`,
  },
  throw: {
    status: "Discarding from hand…",
    detail: "From hand",
    text: (who, self, card) =>
      `${who} ${self ? "discard" : "discards"} ${cardText(card)}`,
  },
  knock: {
    status: "Knocked. Final turns begin.",
    detail: "One last turn",
    text: (who, self) => `${who} ${self ? "knock" : "knocks"}`,
  },
};
