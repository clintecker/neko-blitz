// The friends'-table HTTP client.

export async function fetchRoom(op, fields = {}, userSession = null, signal) {
  const r = await fetch("/api/table", {
    method: "POST",
    cache: "no-store",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(userSession
        ? { Authorization: "Bearer " + userSession.token }
        : {}),
    },
    body: JSON.stringify({ op, code: userSession?.code, ...fields }),
  });
  let d;
  try {
    d = await r.json();
  } catch {
    throw new Error("Could not reach the friends’ table.");
  }
  if (!r.ok && !d.stale) {
    const e = new Error(d.error || "Could not reach the table.");
    e.status = r.status;
    throw e;
  }
  return d;
}
