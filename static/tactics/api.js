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
  createShareLink: (id) => request(`/api/tactical-boards/${encodeURIComponent(id)}/share`, { method: "POST" }),
  deleteBoard: (id) => request(`/api/tactical-boards/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listMatchReports: () => request("/api/match-reports"),
  getMatchReport: (matchId) => request(`/api/match-reports/${encodeURIComponent(matchId)}`),
  upsertMatchReport: (matchId, payload) => request(`/api/match-reports/${encodeURIComponent(matchId)}`, jsonOptions("PUT", payload)),
  listMatchEvents: (matchId) => request(`/api/match-reports/${encodeURIComponent(matchId)}/events`),
  createMatchEvent: (matchId, payload) => request(`/api/match-reports/${encodeURIComponent(matchId)}/events`, jsonOptions("POST", payload)),
  deleteMatchEvent: (matchId, eventId) => request(`/api/match-reports/${encodeURIComponent(matchId)}/events/${eventId}`, { method: "DELETE" }),
  listMatchCallups: (matchId) => request(`/api/match-reports/${encodeURIComponent(matchId)}/callups`),
  upsertMatchCallup: (matchId, payload) => request(`/api/match-reports/${encodeURIComponent(matchId)}/callups`, jsonOptions("PUT", payload)),
  deleteMatchCallup: (matchId, rosterKey) => request(`/api/match-reports/${encodeURIComponent(matchId)}/callups/${encodeURIComponent(rosterKey)}`, { method: "DELETE" }),
  listPlayers: (team = "") => request(`/api/tactical-players${team ? `?team=${encodeURIComponent(team)}` : ""}`),
  createPlayer: (payload) => request("/api/tactical-players", jsonOptions("POST", payload)),
  deletePlayer: (id) => request(`/api/tactical-players/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listLineupTemplates: () => request("/api/tactical-lineup-templates"),
  createLineupTemplate: (payload) => request("/api/tactical-lineup-templates", jsonOptions("POST", payload)),
  deleteLineupTemplate: (id) => request(`/api/tactical-lineup-templates/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listPlayTemplates: () => request("/api/tactical-play-templates"),
  getPlayTemplate: (id) => request(`/api/tactical-play-templates/${encodeURIComponent(id)}`),
  createPlayTemplate: (payload) => request("/api/tactical-play-templates", jsonOptions("POST", payload)),
  deletePlayTemplate: (id) => request(`/api/tactical-play-templates/${encodeURIComponent(id)}`, { method: "DELETE" }),
  uploadFile: (file) => {
    const body = new FormData();
    body.append("file", file);
    return request("/api/files", { method: "POST", body });
  },
  getDashboard: () => request("/api/dashboard"),
};
