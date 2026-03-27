# webSSHadmin — Multiview Roadmap

## Übersicht

| Phase | Beschreibung | Status |
|---|---|---|
| 1 | Multiview-Button & Wizard-Modal (Session-Auswahl) | ✅ fertig |
| 2 | Wizard Schritt 2: Layout + Anordnung (visuell) | ✅ fertig |
| 3 | Multiview-Seite: Terminals rendern + Socket-Attach | ✅ fertig |
| 4 | Resize-Handles zwischen Terminals | ✅ fertig |
| 5 | Polishing: Focus-Indikator, Titelleiste, Responsiveness | ✅ fertig |

---

## Architektur-Entscheidungen

### Neuer Browser-Tab via URL-Parameter
Die Multiview-Seite (`/multiview`) ist eine eigenständige HTML-Seite.
Session-IDs und Layout werden als URL-Parameter übergeben:
```
/multiview?sessions=id1,id2,id3&layout=2col&order=0,1,2
```
Die Seite verbindet sich selbst mit Socket.io (Session-Cookie authentifiziert automatisch)
und hängt sich via `session:attach` an die laufenden Sessions.

### Keine Backend-Änderungen nötig
Der bestehende `session:attach`-Mechanismus unterstützt mehrere gleichzeitige Sockets
pro Session. Die Multiview-Seite nutzt diesen direkt.

### Layouts (CSS Grid)
Vordefinierte Raster, je nach Anzahl gewählter Sessions angeboten:

| Sessions | Verfügbare Layouts |
|---|---|
| 2 | `2col` (nebeneinander), `2row` (übereinander) |
| 3 | `3col`, `3row`, `2top-1bot`, `1top-2bot` |
| 4 | `2x2`, `4col`, `4row`, `3top-1bot`, `1top-3bot` |
| 5 | `2x2+1bot`, `1top+2x2` |
| 6 | `2x3`, `3x2`, `6col`, `6row` |

### Resize-Handles
Verschiebbare CSS-Trennlinien zwischen den Terminal-Zellen (custom Drag-Handler,
kein externes Framework). Beim Loslassen: FitAddon.fit() für betroffene Terminals.

### Wizard: 2 Schritte statt 3
- **Schritt 1:** Session-Auswahl (Checkboxen)
- **Schritt 2:** Layout-Picker (visuelle Vorschau-Icons) +
  Drag-and-Drop Anordnung der Sessions in die Layout-Slots
- **→ Öffnen:** `window.open('/multiview?...', '_blank')`

---

## Phase 1 — Button & Wizard Schritt 1

### Aufgaben
- [x] Multiview-Button in `app.html` Header (neben Ports)
- [x] Button-Icon + Styling in `main.css`
- [x] Wizard-Modal HTML in `app.html`
- [x] Wizard-Logik in `multiview-wizard.js`: Session-Liste aus `Tabs.sessions` laden
- [x] Schritt-1-UI: Session-Cards mit Checkboxen, Auswahl-Highlighting
- [x] Validierung: mind. 2 Sessions auswählen

---

## Phase 2 — Wizard Schritt 2 (Layout + Anordnung)

### Aufgaben
- [x] Layout-Picker: visuelle SVG/CSS-Vorschau-Icons für jedes Layout
- [x] Layouts dynamisch nach Anzahl gewählter Sessions filtern
- [x] Anordnungs-Grid: leere Slots in gewähltem Layout
- [x] Drag-and-Drop: Session-Cards in Slots ziehen
- [x] URL bauen: `sessions`, `layout`, `order` Parameter zusammensetzen
- [x] „Öffnen"-Button: `window.open('/multiview?...', '_blank')`

---

## Phase 3 — Multiview-Seite

### Aufgaben
- [x] `public/multiview.html` erstellen
- [x] `public/css/multiview.css` erstellen
- [x] `public/js/multiview.js` erstellen
- [x] URL-Parameter einlesen und validieren
- [x] Socket.io verbinden (Auth via Session-Cookie)
- [x] Für jede Session: xterm.js Terminal + FitAddon initialisieren
- [x] `session:attach` Event absenden, `terminal:replay` empfangen
- [x] `terminal:output` → `term.write()` pro Session
- [x] `terminal:data` senden wenn Terminal fokussiert
- [x] `terminal:resize` bei Container-Größenänderung senden
- [x] CSS-Grid-Layout anhand URL-Parameter aufbauen
- [x] Titelleiste pro Terminal: Verbindungsname + Host
- [x] Fehlerfall: Session nicht mehr aktiv → Hinweis im Terminal-Slot

---

## Phase 4 — Resize-Handles

### Aufgaben
- [x] Horizontale Trennlinien (bei Row-Layouts): verschiebbar
- [x] Vertikale Trennlinien (bei Col-Layouts): verschiebbar
- [x] Beide Achsen (bei Grid-Layouts): verschiebbar
- [x] Nach Resize: FitAddon.fit() + terminal:resize für betroffene Terminals
- [x] CSS: Cursor-Feedback beim Hover/Drag

---

## Phase 5 — Polishing

### Aufgaben
- [x] Focus-Indikator: aktives Terminal farblich hervorheben (Rahmen in Akzentfarbe)
- [x] Keyboard-Shortcut: Klick auf Terminal setzt Fokus
- [x] Theme: Multiview-Seite erbt Theme aus localStorage (via Theme.init())
- [x] beforeunload-Schutz auf der Multiview-Seite
- [ ] Dokumentation: HANDBUCH.md um Multiview-Abschnitt erweitern

---

## Fortschritt

*Implementierung abgeschlossen am 27.03.2026.*

### Umgesetzte Dateien
| Datei | Beschreibung |
|---|---|
| `public/app.html` | Multiview-Button (⧉) + Wizard-Modal eingefügt |
| `public/css/main.css` | Wizard-Styles angehängt |
| `public/js/multiview-wizard.js` | Vollständige Wizard-Logik (2 Schritte) |
| `public/js/app.js` | `MultiviewWizard.init()` hinzugefügt |
| `public/multiview.html` | Eigenständige Multiview-Seite |
| `public/css/multiview.css` | Vollständige Stile für die Multiview-Seite |
| `public/js/multiview.js` | Grid-Aufbau, Terminal-Attach, Resize-Handles |
| `server/index.js` | Route `GET /multiview` (requires auth) |
