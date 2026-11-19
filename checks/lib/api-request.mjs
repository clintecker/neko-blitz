// One POST /api/table shape for the in-process route test and the built Worker
// smoke test; only the origin and the transport differ. `send` defaults to
// fetch and takes the imported POST when no socket should be opened.
export const postTable =
  (origin, send = fetch) =>
  async (op, fields = {}, token) => {
    const response = await send(
      new Request(origin + "/api/table", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ op, ...fields }),
      }),
    );
    return { status: response.status, data: await response.json() };
  };
