# webSSHadmin — Roadmap

## Übersicht

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Favicon | 1 | erledigt |
| 2 | Suche/Filter Verbindungsliste | 1 | erledigt |
| 3 | Doppelklick Tab-Rename | 1 | erledigt |
| 4 | Fullscreen-Modus (Button) | 1 | erledigt |
| 8 | Bookmarks/Links (Header-Dropdown) | 1 | erledigt |
| 5 | Theme-System (Hell/Dunkel/Farben) | 2 | erledigt |
| 6 | Port Dashboard (Host-Ports + Anwendungen) | 3 | erledigt |
| 9 | Einstellungen-Dropdown (Zahnrad) | 3 | erledigt |
| 7 | Multi-User-System (Admin/User/Viewer) | 4 | erledigt |

---

## Phase 1 — Schnelle Verbesserungen

### 1. Favicon
- SVG-Favicon im Neon-Stil erstellen
- `<link rel="icon">` in `app.html` und `index.html`
- Statische Route in `server/index.js`

### 2. Suche/Filter Verbindungsliste
- Suchfeld im Header der linken Sidebar
- `conmen.js`: Filter auf Name und Host in `render()`
- CSS-Styling passend zum Theme

### 3. Doppelklick Tab-Rename
- `tabs.js`: `dblclick`-Handler auf Tab-Label
- Inline-Input mit Enter/Escape/Blur-Handling
- Name in `sessions`-Map als `customName` speichern

### 4. Fullscreen-Modus
- Button im Header-Right-Bereich
- CSS-Klasse `body.fullscreen` blendet Sidebars, Stats, Footer aus
- Header bleibt (für Tab-Wechsel), Fullscreen-Exit-Button sichtbar
- Escape / Button zum Verlassen
- Terminal refit nach Toggle

---

## Phase 2 — Theme-System

### 5. Theme-Auswahl
- Neues Modul `theme.js` mit Theme-Definitionen
- Mindestens 3 Themes: Neon Dark (default), Light, Midnight Blue
- CSS-Variablen werden per Theme-Klasse überschrieben
- xterm.js-Theme dynamisch umschalten (`term.options.theme`)
- Persistenz via `localStorage`
- Theme-Button im Header mit Dropdown

---

## Phase 3 — Port Dashboard

### 6. Port Dashboard
- Zeigt alle belegten Ports des Docker-Host-Systems
- Anwendung/Prozess/Container-Name pro Port
- Backend: `/proc/net/tcp` parsen + Docker-Socket für Container-Zuordnung
- API: `GET /api/ports` (gecacht, 5s)
- Frontend: Panel (ähnlich SFTP) mit Tabelle, Sortierung, Suchfilter
- docker-compose.yml: Docker-Socket read-only mounten
- Auto-Refresh alle 10 Sekunden

---

## Phase 4 — Multi-User-System

### 7. Benutzer & Rollen

**Rollen:**
- **Admin** — Vollzugriff, User-Verwaltung, Verbindungen verwalten
- **User** — Gleiche Möglichkeiten wie Admin (Sessions teilen), aber keine User-/Verbindungs-Verwaltung
- **Viewer** — Sieht laufende Sessions (Read-Only), keine Eingabe, kein Session-Kill

**Berechtigungs-Matrix:**

| Aktion | Admin | User | Viewer |
|--------|-------|------|--------|
| Verbindungen verwalten | ja | nein | nein |
| Session erstellen | ja | ja | nein |
| Terminal-Eingabe | ja | ja | nein |
| Terminal zusehen | ja | ja | ja |
| Session beenden | ja | ja | nein |
| Quick Commands | ja | ja | nein |
| SFTP | ja | ja | nein |
| Skripte hochladen | ja | ja | nein |
| User verwalten | ja | nein | nein |
| Eigenes Passwort ändern | ja | ja | ja |
| Theme ändern | ja | ja | ja |
| Port Dashboard | ja | ja | ja |

**Umsetzung:**
- Neue `users`-Tabelle (id, username, password, role)
- Migration: bestehendes Single-Password wird zum Admin-User
- Login mit Username + Passwort
- Session speichert userId, username, role
- Socket-Middleware: Rolle auf Socket-Objekt
- Viewer-Schutz: `terminal:data` und `session:kill` blockieren
- Frontend: Rolle via `/api/auth/check` abfragen, UI entsprechend einschränken
- Admin: User-Verwaltungs-Modal (neues Modul `usermen.js`)

---

## Abhängigkeiten

```
Phase 1: alle unabhängig, parallel machbar
Phase 2: nach Phase 1 (damit Fullscreen-Button mitgestylt wird)
Phase 3: nach Phase 2 (Dashboard gleich theme-fähig)
Phase 4: nach Phase 3 (Port-Dashboard braucht Rollen-Schutz)
```
