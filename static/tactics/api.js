async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Sesion caducada");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.detail || `Error ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

const jsonOptions = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const tacticsApi = {
  listBoards: (search = "") => request(`/api/tactical-boards?search=${encodeURIComponent(search)}`),
  getBoard: (id) => request(`/api/tactical-boards/${encodeURIComponent(id)}`),
  createBoard: (payload) => request("/api/tactical-boards", jsonOptions("POST", payload)),
  updateBoard: (id, payload) => request(`/api/tactical-boards/${encodeURIComponent(id)}`, jsonOptions("PUT", payload)),
  deleteBoard: (id) => request(`/api/tactical-boards/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getDashboard: () => request("/api/dashboard"),
};
