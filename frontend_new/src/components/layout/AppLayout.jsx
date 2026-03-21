import Icon from "../ui/Icon.jsx";

const NAV = [
  { id: "home", label: "Home", icon: "home" },
  { id: "explore", label: "Explore", icon: "explore" },
  { id: "alerts", label: "Alerts", icon: "bell" },
  { id: "trends", label: "Trends", icon: "trends" },
];

export default function AppLayout({ page, onNavigate, theme, onThemeToggle, children }) {
  return (
    <div className="app-layout">
      <aside className="desktop-sidebar" aria-label="Sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark" aria-hidden="true">
            <Icon name="mapPin" size={18} color="white" />
          </div>
          <div>
            <div className="sidebar-logo-text">Hyperlocal AQI</div>
            <div className="sidebar-logo-sub">Delhi demo</div>
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
