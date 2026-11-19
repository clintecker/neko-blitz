import { useEffect } from "react";
import { playBotStep } from "../public/game/arcade-bots.mjs";

// Plays one solo bot step per turn, on the same beat as the table animation.
export function useSoloOpponent({ packet, paused, refs, displaySolo }) {
  const { solo, session, live } = refs;
  useEffect(() => {
    const view = packet?.view;
    if (
      paused ||
      !view ||
      packet.code ||
      view.phase === "end" ||
      view.seats[view.turn].human
    )
      return;
    const timer = setTimeout(
      () => {
        if (session.current || !solo.current || live.current?.code) return;
        if (playBotStep(solo.current)) displaySolo();
      },
      view.phase === "throw" ? 1180 : 1080,
    );
    return () => clearTimeout(timer);
  }, [packet, displaySolo, paused]);
}
