"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { dailyShareText } from "./daily.js";

// A long streak stops drawing hearts so the row stays on one line. The number
// printed beside them is the truth.
const GLYPHS = 10;

export function DailyCard({ date, won, lives, streak }) {
  const [copied, setCopied] = useState(false),
    [manual, setManual] = useState(false);
  const text = dailyShareText({ date, won, lives, streak });
  async function share() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission: show the text so the player can select it.
      setManual(true);
    }
  }
  return (
    <>
      <p>
        <b className={won ? "mint-text" : "pink-text"}>
          {won
            ? `Survived with ${lives} ${lives === 1 ? "life" : "lives"}`
            : "Knocked out"}
        </b>{" "}
        on the {date} daily deal.
      </p>
      <p>
        <span className="pink-text" aria-hidden="true">
          {"♥".repeat(Math.min(streak, GLYPHS))}
        </span>{" "}
        {streak}-day streak
      </p>
      <div className="lobby-actions">
        <button className="action primary" onClick={share}>
          {copied ? <Check size={17} /> : <Copy size={17} />}
          {copied ? "Copied" : "Share result"}
        </button>
      </div>
      {manual && (
        <input
          className="copy-url"
          readOnly
          value={text}
          onFocus={(e) => e.target.select()}
          aria-label="Daily result text"
        />
      )}
    </>
  );
}
