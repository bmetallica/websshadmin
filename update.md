# update.md — Erweiterung webSSHadmin (v1.3.0)

Umgesetzt am 30.07.2026 auf Basis von `main` @ `46aae2f`.

1. **Zeitgesteuerte Befehle pro Session** — im „Session teilen"-Popup
2. **Mobile Oberfläche** für Smartphones inkl. PWA — Desktop-UI unverändert
3. **Strg+W-Problem** in Chrome *und* Firefox gelöst
4. *(nachträglich ergänzt)* **Betrieb ohne Internetzugang** — alle externen Assets lokal

---

## Ausgangslage (geprüft)

- Sessions leben nur im RAM (`sessionManager.js`), `sessionId` ist eine UUID pro Verbindungsaufbau
  und überlebt keinen Server-Neustart.
- Der Container lief auf **UTC**, der Host auf CEST → für „um 02:23 Uhr" relevant.
- `main.css` enthielt **keine einzige** `@media`-Regel → reines Desktop-Layout.
- Der Chrome-Zweig in `terminal.js` konnte prinzipbedingt nicht funktionieren (siehe Punkt 3).
- Externe Abhängigkeiten: Ace-Editor von cdnjs, Inter + JetBrains Mono von Google Fonts.

---

# 1. Zeitgesteuerte Befehle

Typen: **einmalig** (Datum + Uhrzeit) und **täglich** (HH:MM).

## Datenbank

Migration 14 legt `scheduled_commands` an (Befehl, `send_enter`, `mark_terminal`, `schedule_type`,
`run_at` / `time_of_day`, `timezone`, `enabled`, `status`, `last_run_at`, `last_error`).
Beim Serverstart wird die Tabelle geleert — alle `session_id` sind nach einem Neustart tot.

## Backend

**`server/services/commandScheduler.js`**

- Ein globaler Ticker (5 s) statt Timer pro Eintrag → kein Drift, Genauigkeit ±5 s.
- Ausführung schreibt zeilenweise per `sessionManager.writeToSession()`; mit „Enter bestätigen"
  bekommt jede Zeile ein `\r` (echtes Enter), Zeilenabstand 150 ms.
- Optionaler Marker im Terminal: `--- geplanter Befehl ausgeführt: <Label> ---` (cyan),
  landet auch im Scrollback.
- Socket-Event `schedule:executed` aktualisiert offene Listen live.
- `cleanupSession()` hängt in `killSession()` und `_endSession()` → Zeitpläne sterben mit der Session.
- Doppelfeuern innerhalb einer Minute wird über `last_run_at` verhindert.

**Zeitzonen** — der Kern des Ganzen, weil der Container UTC spricht und der Nutzer nicht:

- Der Browser schickt seine IANA-Zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) mit.
- *Einmalig*: der Browser rechnet die Eingabe direkt in einen absoluten UTC-Zeitstempel um.
- *Täglich*: der Server berechnet den nächsten Termin über `Intl.DateTimeFormat` mit `timeZone`,
  zweistufig, damit DST-Wechsel korrekt aufgelöst werden.
- Verifiziert: 02:23 Europe/Berlin bleibt 02:23, auch über beide Zeitumstellungen 2026.

**`server/routes/schedules.js`** unter `/api/schedules` (mit `requireAuth`):
`GET|POST /sessions/:id/schedules`, `PUT /schedules/:id`, `POST /schedules/:id/run`,
`DELETE /schedules/:id`. Jede Route prüft `isSessionOwner` — Coworker dürfen bewusst nichts terminieren.
Der Testlauf (`/run`) verbraucht einen Einmal-Termin nicht.

## Frontend

- Das Share-Modal hat jetzt zwei Reiter: **Freigaben** | **Zeitgesteuerte Befehle**.
- **`public/js/schedules.js`**: Formular (Label, Befehl als Textarea, Typ, Zeitpunkt, „mit Enter
  bestätigen", „im Terminal markieren") plus Liste mit Status-Chip, ▶ jetzt, ❚❚ pausieren, × löschen.
- Zeitzone wird unter dem Formular angezeigt.
- CSS rein additiv (`.modal-tabs`, `.sched-*`), keine bestehende Regel angefasst.

---

# 2. Mobile Oberfläche + PWA

Komplett eigene Seite — `app.html`, `main.css` und die Desktop-Module bleiben unberührt
(einzige Ausnahme: der gemeinsame Strg+W-Fix aus Punkt 3).

## Auslieferung

- Route `GET /m` → `public/mobile.html`, gleiche Zugriffsregeln wie `/app` (Session **oder** Share-Token).
- Mobile User-Agents werden von `/` und `/app` automatisch auf `/m` geleitet.
- Cookie `viewMode=desktop|mobile` (1 Jahr) übersteuert die Erkennung in beide Richtungen;
  umschaltbar über „Desktop-Ansicht" (mobil, Menü ⋮) bzw. „Mobile Ansicht" (Desktop, Einstellungen).
- Desktop-UAs werden nie umgeleitet.

## Neue Dateien

`public/mobile.html`, `public/css/mobile.css`, `public/js/mobile.js`,
`public/js/mobile-keys.js`, `public/js/mobile-sftp.js`, `public/manifest.json`, `public/sw.js`,
`public/icons/icon-{192,512}.png` + `icon-maskable-512.png`.

Wiederverwendet werden `theme.js` und **sämtliche Socket-Events** — es gibt keine zweite Server-API.

## Aufbau

```
☰  vm-prod ▾  ⌨  ⋮        ← Schublade / Session-Auswahl / Tastatur / Menü
CPU 12% · RAM 43% · DISK 61%
┌───────────────────────────┐
│        T E R M I N A L    │
└───────────────────────────┘
Esc Tab Strg Alt ← ↑ ↓ → …  ← Sondertasten (2 Reihen, scrollbar)
```

- **Sticky-Modifier:** Strg/Alt kurz antippen → gilt für die nächste Taste (auch von der
  Bildschirmtastatur, via `attachCustomKeyEventHandler`); lang drücken → rastet ein.
  Strg+Buchstabe → `\x01`–`\x1a`, Alt+Taste → ESC-Präfix, Strg/Alt+Pfeil → `CSI 1;5/1;3`.
- **Bildschirmtastatur:** `visualViewport`-Listener setzt Höhe und Offset von `#mApp`, danach `fit()`.
- **xterm-Textarea** bekommt `autocapitalize/autocorrect/spellcheck=off`, sonst verfälscht
  Android die Eingabe. „⌨"-Button ruft `term.focus()`, weil Android sonst oft keine Tastatur öffnet.
- `overscroll-behavior: none` (kein Pull-to-Refresh), kein Doppeltipp-Zoom, Safe-Area-Insets.
- Enthalten: Verbindungen (inkl. Gruppen-Credential-Abfrage), Sessions, Stats, SFTP, Teilen +
  Zeitpläne, Chat, Theme-Wechsel, Schriftgröße.
- Bewusst nicht enthalten: Quick Commands, Skripte, Port-Dashboard, Multiview, Benutzer-/Gruppenverwaltung.

## PWA

`manifest.json` (`start_url: /m`, `display: standalone`) + minimaler Service Worker, der **nichts**
cacht — sonst hielte ein Deploy alte JS-Dateien auf den Geräten fest. Icons wurden aus dem
Favicon-Design (`>_` im Neon-Verlauf) als PNG erzeugt.

---

# 3. Strg+W

## Warum der alte Code nicht funktionieren konnte

`Strg+W`, `Strg+T`, `Strg+N` sind in Chrome, Edge **und** Firefox browser-reserviert; sie erreichen
die Seite nicht bzw. `preventDefault()` bleibt wirkungslos. Der `else`-Zweig in `terminal.js` ging vom
Gegenteil aus — deshalb schloss sich der Tab. Abfangbar sind nur die übrigen Kürzel.

## Umsetzung (Button + Ersatzkürzel, wie gewählt)

1. Browser-Weiche entfernt — eine Logik für alle Browser.
2. **`Alt+<Buchstabe>` → Control-Code** (`Alt+W` = `Strg+W`), layoutunabhängig über `e.code`.
   `AltGr` (= Strg+Alt) bleibt unangetastet, `@ | ~` funktionieren normal.
   Abschaltbar unter Einstellungen → Terminal.
3. **Button „Strg+W"** jetzt in allen Browsern (vorher Firefox-only).
4. **`beforeunload`-Schutz** in allen Browsern, solange Sessions offen sind.
5. **Ein einziger Key-Handler pro Terminal**: `setReadOnlySession()` setzt nur noch ein Flag statt
   `attachCustomKeyEventHandler` zu überschreiben — sonst hätte die Viewer-Logik das Alt-Mapping gekillt.
6. `preventDefault`-Liste bereinigt: `w`, `t`, `n` raus (nichts zu holen), Rest bleibt.
7. Mobil: eigene `^W`-Taste in der Sondertasten-Leiste.

---

# 4. Betrieb ohne Internetzugang (nachträglich ergänzt)

Vorher hätte ein Server ohne Internet den Ace-Editor gar nicht und die Schriften nur als
System-Fallback bekommen.

- **Ace-Editor** → `public/vendor/ace/` (ace.js + 28 Modes + 4 Themes + 7 Worker, 2,6 MB),
  passend zu den in `sftp.js` angebotenen Sprachen und den vier App-Themes.
- **Schriften** → `public/vendor/fonts/` (13 woff2, 320 KB) + lokale `fonts.css`;
  `@import` in `main.css`, `multiview.css`, `mobile.css` und der Link in `index.html` zeigen dorthin.
- **CSP verschärft**: keine externen Hosts mehr (`script-src 'self' blob:`, `font-src 'self'`,
  `style-src 'self' 'unsafe-inline'`); `blob:` und `worker-src` wegen der Ace-Syntax-Worker,
  `manifest-src` für die PWA.
- Ergebnis: keine einzige externe Referenz mehr in HTML/CSS/JS.

---

# 5. Geänderte und neue Dateien

**Neu:** `server/services/commandScheduler.js`, `server/routes/schedules.js`,
`public/js/schedules.js`, `public/mobile.html`, `public/css/mobile.css`, `public/js/mobile.js`,
`public/js/mobile-keys.js`, `public/js/mobile-sftp.js`, `public/manifest.json`, `public/sw.js`,
`public/icons/*`, `public/vendor/ace/*`, `public/vendor/fonts/*`

**Geändert:** `server/db.js` (Migration 14), `server/index.js` (Routen `/m`, `/api/schedules`,
Mobil-Redirect, Manifest/SW, CSP, Scheduler-Start), `server/services/sessionManager.js`
(`emitToSession`, `writeMarker`, Cleanup-Hooks), `public/app.html`, `public/index.html`,
`public/multiview.html`, `public/js/app.js`, `public/js/sharing.js`, `public/js/terminal.js`,
`public/css/main.css`, `public/css/multiview.css`, `docker-compose.yml`, `README.md`, `HANDBUCH.md`

---

# 6. Tests

Getestet gegen einen Wegwerf-Container mit echtem SSH-Server (der Produktivstand blieb unberührt).

**End-to-End (18 Prüfungen, alle grün):** Login → Verbindung → echte SSH-Session → Zeitplan-Validierung
(leerer Befehl, Vergangenheit, fremde Session → 403) → einmaliger Zeitplan feuert pünktlich, Text kommt
im Terminal an, Marker gesetzt, `schedule:executed` mit `done`, Einmal-Termin verbraucht → täglicher
Zeitplan trifft 02:23 Berliner Zeit bei Container-TZ UTC → manueller Testlauf verbraucht ihn nicht →
Session-Ende löscht die Zeitpläne.

**DOM-Tests (jsdom):** Mobil- und Desktop-Seite laden fehlerfrei, alle Module initialisieren,
Tastenleiste baut 42 Tasten, Modifier-Logik korrekt (`Strg+W`→`\x17`, `Alt+B`→`ESC b`,
`Strg+→`→`CSI 1;5C`), Reiterwechsel im Popup, Ace lädt lokal.

**Statisch:** alle 66 bzw. 24 im JS referenzierten DOM-IDs existieren im HTML; alle Assets liefern 200;
Redirect-Matrix (Desktop/Mobil × Cookie) geprüft.

---

# 7. Hinweise für den Betrieb

- `TZ=Europe/Berlin` wurde in `docker-compose.yml` ergänzt (nur für Logs; Zeitpläne richten sich
  ohnehin nach der Browser-Zeitzone).
- Die Migration ist additiv, bestehende Daten werden nicht angefasst — `data/database.sqlite`
  trotzdem vor dem Rollout sichern.
- Sonderfall Zeitumstellung: eine tägliche Uhrzeit in der im Frühjahr übersprungenen Stunde
  (02:00–03:00) wird an diesem Tag entsprechend verschoben ausgeführt.
- Zeitpläne sind an die Session gebunden. Ein an die *Verbindung* gebundener Zeitplan, der sich bei
  Bedarf selbst einwählt, wäre ein eigenständiges Folgefeature.
