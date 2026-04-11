import { useState } from "react";
import Icon from "../ui/Icon.jsx";
import { useAppLocation, useLocationBoundary } from "../../hooks/index.js";
import { api } from "../../utils/api.js";
import { safeLocationLabel } from "../../tokens/index.js";

const NAV = [
  { id: "home", label: "Home", icon: "home" },
  { id: "insights", label: "Insights", icon: "info" },
  { id: "explore", label: "Explore", icon: "explore" },
  { id: "alerts", label: "Alerts", icon: "bell" },
  { id: "trends", label: "Trends", icon: "trends" },
];

export default function AppLayout({ page, onNavigate, theme, onThemeToggle, children }) {
  const location = useAppLocation();
  const locationBoundary = useLocationBoundary(location.lat, location.lon);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const region = locationBoundary.data?.region || null;
  const resolvedLabel = [
    safeLocationLabel(region?.district, ""),
    safeLocationLabel(region?.city, ""),
    safeLocationLabel(region?.state, ""),
  ].filter(Boolean).join(", ") || safeLocationLabel(location.label, "WCTM College, Gurugram");
  const locationModeLabel =
    location.hasSelectedLocation ? "searched" : location.mode === "device" ? "live GPS" : location.mode === "demo" ? "campus fallback" : "default";

  async function handleSearch(event) {
    event?.preventDefault?.();
    const q = String(query || "").trim();
    if (q.length < 2) {
      setError("Enter a city, area, district, or lat,lon.");
      setResults([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await api.searchLocations(q, 6);
      const items = Array.isArray(res?.data) ? res.data : [];
      setResults(items);
      if (!items.length) setError("No location found.");
    } catch (err) {
      setResults([]);
      setError(err?.message || "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  function applyLocation(item) {
    if (!item) return;
    location.setSelectedLocation({
      lat: Number(item.lat),
      lon: Number(item.lon),
      label: String(item.display_name || "Selected location"),
      source: "search",
    });
    setQuery(String(item.display_name || ""));
    setResults([]);
    setError("");
  }

  function clearLocation() {
    location.clearSelectedLocation();
    location.refreshCurrentLocation?.();
    setResults([]);
    setError("");
    setQuery("");
  }

  function useCurrentLocation() {
    location.clearSelectedLocation();
    location.refreshCurrentLocation?.();
    setResults([]);
    setError("");
  }

  return (
    <div className="app-layout">
      <aside className="desktop-sidebar" aria-label="Sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark" aria-hidden="true">
            <Icon name="mapPin" size={18} color="white" />
          </div>
          <div>
            <div className="sidebar-logo-text">Hyperlocal AQI</div>
            <div className="sidebar-logo-sub">WCTM College, Gurugram</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`sidebar-nav-btn ${page === n.id ? "active" : ""}`}
              onClick={() => onNavigate(n.id)}
              aria-current={page === n.id ? "page" : undefined}
            >
              <Icon name={n.icon} size={18} />
              {n.label}
            </button>
          ))}
          <button className="sidebar-nav-btn" onClick={() => onNavigate("officer")}>
            <Icon name="building" size={18} /> Officer
          </button>
        </nav>

        <div className="sidebar-footer">
          <button className="btn btn-sm" onClick={onThemeToggle} aria-label="Toggle theme" style={{ width: "100%" }}>
            <Icon name={theme === "dark" ? "sun" : "moon"} size={14} />
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </aside>

      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, background: "var(--accent)", borderRadius: "var(--radius-md)", display: "grid", placeItems: "center" }}>
            <Icon name="mapPin" size={18} color="white" />
          </div>
          <div style={{ fontWeight: 650 }}>Hyperlocal AQI</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end", minWidth: 0 }}>
          <div style={{ position: "relative", width: "min(520px, 100%)" }}>
            <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search location"
                style={{
                  width: "100%",
                  minHeight: 36,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  color: "var(--text-primary)",
                  padding: "0 12px",
                }}
              />
              <button className="btn btn-sm" type="submit">{loading ? "..." : "Search"}</button>
              <button className="btn btn-sm" type="button" onClick={useCurrentLocation}>My location</button>
              <button className="btn btn-sm" type="button" onClick={clearLocation}>
                {location.hasSelectedLocation ? "Clear" : "Reset"}
              </button>
            </form>
            <div className="muted" style={{ fontSize: "0.8125rem", marginTop: 6, textAlign: "right" }}>
              Current: {resolvedLabel} | {locationModeLabel}
            </div>
            {(results.length || error) ? (
              <div style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                left: 0,
                zIndex: 20,
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 12,
                boxShadow: "0 16px 40px rgba(0,0,0,0.18)",
                padding: 10,
                display: "grid",
                gap: 8,
              }}>
                {error ? <div className="muted" style={{ fontSize: "0.8125rem" }}>{error}</div> : null}
                {results.map((item, idx) => (
                  <button
                    key={`${item.lat}-${item.lon}-${idx}`}
                    type="button"
                    className="tag"
                    onClick={() => applyLocation(item)}
                    style={{ textAlign: "left", padding: "10px 12px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
                  >
                    {String(item.display_name || "Selected location")}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button className="btn btn-sm" onClick={() => onNavigate("officer")}>
            <Icon name="building" size={14} /> Officer
          </button>
          <button className="btn btn-sm" onClick={onThemeToggle} aria-label="Toggle theme">
            <Icon name={theme === "dark" ? "sun" : "moon"} size={14} />
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="page-content">{children}</div>
      </main>

      <nav className="mobile-nav" aria-label="Primary">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`mobile-nav-btn ${page === n.id ? "active" : ""}`}
            onClick={() => onNavigate(n.id)}
            aria-current={page === n.id ? "page" : undefined}
          >
            <Icon name={n.icon} size={18} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

