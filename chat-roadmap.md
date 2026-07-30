# Chat-Feature Roadmap

## Übersicht

Eine Text-Chat-Funktion für geteilte Sessions.  
Sobald eine Session geteilt wird, erscheint im Host ein geteiltes Skript-/Chat-Panel.  
Viewer und Coworker bekommen die rechte Sidebar vollständig als Chat angezeigt.

---

## Architektur-Entscheidungen

### Datenspeicherung
- Chat-History **in-memory** pro Session (kein DB-Persist) – wird mit der Session verworfen
- Maximal 200 Nachrichten im Buffer (ältere fallen raus)
- Format einer Nachricht: `{ from, role, message, ts }` (ts = Unix-Timestamp ms)

### Authentifizierung / Identität
- **Host**: Username kommt aus `window._username` (gesetzt via `/api/auth/check` in app.js)
- **Viewer/Coworker**: Name wird im Browser in `localStorage['chatDisplayName']` gespeichert  
  → nicht session-gebunden, gilt browser-weit
- Der Anzeigename wird mit jeder Nachricht als payload mitgeschickt, **nicht** server-seitig gespeichert

### Socket-Events (neu)
| Event | Richtung | Payload |
|---|---|---|
| `chat:message` | Client → Server | `{ sessionId, from, message }` |
| `chat:message` | Server → Clients (broadcast) | `{ from, role, message, ts }` |
| `chat:history` | Server → Client (on join) | `{ messages: [...] }` |

### Zugriffskontrolle (Server)
- Nur Sockets die Owner (`attachedSockets`) **oder** in `sharedSockets` für diese Session sind, dürfen senden und empfangen
- Host-Role wird server-seitig als `'owner'` markiert, Shared als deren Rolle (`viewer`/`coworker`)

### Frontend-Zustand
- Chat-Panel wird durch CSS-Klasse `.chat-active` auf `#sidebarRight` gesteuert
- Host: Klasse wird gesetzt wenn mind. 1 Share-Token für aktive Session existiert
- Viewer/Coworker: Klasse ist von Anfang an gesetzt (weil `window._shareMode === true`)

---

## Phase 1: Backend – chatHandler.js

**Datei neu:** `server/socket/chatHandler.js`

- In-memory Map `chatHistories`: `sessionId → Message[]`
- Socket-Event `chat:message`:
  1. Empfange `{ sessionId, from, message }`
  2. Prüfe ob Socket Owner oder in `sharedSockets` dieser Session ist (via `sessionManager.getSessionRole`)
  3. Sanitize: `from` und `message` auf 200 bzw. 2000 Zeichen begrenzen, HTML-Zeichen escapen
  4. Bestimme `role` des Senders aus `getSessionRole(sessionId, socket.id)`
  5. Erstelle Nachricht-Objekt: `{ from, role, message, ts: Date.now() }`
  6. Push in `chatHistories.get(sessionId)`, cap bei 200 Einträgen
  7. Broadcast via `sessionManager._emitToAttached`-ähnliche Funktion:  
     → emit `chat:message` an **alle** Sockets der Session (owner + shared)

- Chat-Buffer löschen wenn Session beendet wird:
  - `chatHandler.clearHistory(sessionId)` wird aus `sessionManager._endSession` aufgerufen  
    **oder** per `session:ended`-Event in chatHandler selbst (lauscht auf `session:ended` global)

- Helper-Export: `module.exports = { handler, getHistory, clearHistory }`

**Datei ändern:** `server/socket/index.js`
- `chatHandler` importieren und `chatHandler.handler(io, socket)` aufrufen

**Datei ändern:** `server/socket/terminalHandler.js`  
- Im `session:join-shared` Handler: nach `socket.emit('session:joined-shared', ...)` auch  
  `socket.emit('chat:history', { messages: chatHandler.getHistory(sessionId) })` senden
- Im `session:create` / `session:attach` Handler: nach erfolgreichem Attach ebenfalls  
  `socket.emit('chat:history', { messages: chatHandler.getHistory(sessionId) })` senden

---

## Phase 2: Frontend – chat.js

**Datei neu:** `public/js/chat.js`

Objekt `Chat` mit folgenden Methoden:

### `Chat.init(socket)`
- Socket-Referenz speichern
- Listener für `chat:message` registrieren → `_appendMessage(msg)`
- Listener für `chat:history` registrieren → alle Messages rendern
- `_setupNamePrompt()` aufrufen

### `Chat._setupNamePrompt()`
- Wenn `window._shareMode === true`:
  - Name aus `localStorage.chatDisplayName` lesen
  - Falls vorhanden → direkt `_activateChat()` aufrufen
  - Falls nicht → Name-Eingabe-Screen anzeigen (`#chatNamePrompt`)
- Wenn nicht `_shareMode` (Host):
  - `_activateChat()` direkt aufrufen (kein Name-Prompt, nutzt `window._username`)

### `_activateChat()`
- `#chatNamePrompt` verbergen
- `#chatMessages` + `#chatInputArea` sichtbar machen
- Für Viewer/Coworker: Aktuellen `sessionId` aus `window._shareSessionId` holen
- `chat:history` noch nicht empfangen? Warten bis Event kommt

### `_sendMessage()`
- `from` bestimmen: `window._shareMode ? localStorage.chatDisplayName : window._username`
- Socket emit `chat:message` mit `{ sessionId, from, message: input.value.trim() }`
- Input leeren

### `_appendMessage(msg)`
- Neues Message-Element erzeugen
- Eigene Nachrichten rechts, fremde links (basierend auf `from === currentName`)
- Timestamp formatieren (HH:MM)
- Auto-scroll ans Ende

### `Chat.activate(sessionId)` _(aufgerufen vom Host wenn Share erstellt wird)_
- `window._activeChatSessionId = sessionId` setzen
- CSS-Klasse `.chat-active` auf `#sidebarRight` setzen
- Falls Sidebar eingeklappt: aufklappen

### `Chat.deactivate()` _(wenn letzte Share widerrufen wird)_
- `.chat-active` entfernen

---

## Phase 3: Host-Integration – wann wird Chat aktiviert/deaktiviert?

**Datei ändern:** `public/js/sharing.js`

- Nach erfolgreichem `_createShare()` → `Chat.activate(this.currentSessionId)` aufrufen
- Nach `_revokeShare()` → prüfen ob noch Shares für aktive Session vorhanden:  
  wenn `shares.length === 0` → `Chat.deactivate()` aufrufen
- Nach `_loadShares()` beim Öffnen des Share-Modals → wenn `shares.length > 0` und aktive Session  
  → `Chat.activate(this.currentSessionId)` aufrufen (für Page-Reload)

**Zusatz:** Beim Wechsel des aktiven Tabs (Tab-Klick in tabs.js)
- `Chat.activate(newSessionId)` wenn Session Shares hat (API-Check: `GET /api/sharing/sessions/:id/shares`)
- `Chat.deactivate()` wenn keine Shares (oder beim Tab mit anderer Session)

---

## Phase 4: Viewer/Coworker-Integration

**Datei ändern:** `public/js/app.js`

- Im `if (!window._shareMode)` Block: Chat **nicht** initialisieren
- **Außerhalb** des Blocks: `Chat.init(socket)` für alle (Host + Viewer)
- Für Viewer/Coworker: Nach `session:joined-shared`:
  - `window._activeChatSessionId = sessionId` setzen
  - `document.getElementById('sidebarRight').classList.add('chat-active', 'share-mode-chat')`
  - Sidebar aufklappen falls collapsed
  - `window._shareSessionId = sessionId` setzen

---

## Phase 5: HTML – Chat-Panel DOM

**Datei ändern:** `public/app.html`

Im `<aside id="sidebarRight">` folgenden Block **ergänzen** (nach dem bestehenden Footer):

```html
<!-- Chat Panel (sichtbar wenn .chat-active auf sidebarRight) -->
<div class="chat-panel" id="chatPanel">
  <!-- Name-Prompt (nur Viewer/Coworker, einmalig) -->
  <div class="chat-name-prompt" id="chatNamePrompt">
    <div class="chat-name-prompt-inner">
      <label>Dein Name im Chat</label>
      <input type="text" id="chatNameInput" maxlength="50" placeholder="Name eingeben..." autocomplete="off">
      <button id="btnChatSetName">Weiter</button>
    </div>
  </div>
  <!-- Nachrichten-Liste -->
  <div class="chat-messages" id="chatMessages"></div>
  <!-- Eingabe-Bereich -->
  <div class="chat-input-area" id="chatInputArea">
    <input type="text" id="chatInput" maxlength="2000" placeholder="Nachricht..." autocomplete="off">
    <button id="btnChatSend">&#10148;</button>
  </div>
</div>
```

---

## Phase 6: CSS

**Datei ändern:** `public/css/main.css`

### Sidebar-Split (Host mit aktiver Share)
```css
/* Wenn Chat aktiv: Sidebar als Flexbox-Spalte aufteilen */
#sidebarRight.chat-active {
  display: flex;
  flex-direction: column;
}

/* Skripte-Bereich: oberes 1/3 */
#sidebarRight.chat-active > .sidebar-header,
#sidebarRight.chat-active > .sidebar-content,
#sidebarRight.chat-active > .sidebar-footer {
  flex: 0 0 auto;
  max-height: 33%;
  overflow: hidden;
}
#sidebarRight.chat-active > .sidebar-content {
  overflow-y: auto;
}

/* Chat-Panel: untere 2/3 */
#sidebarRight.chat-active .chat-panel {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
```

### Viewer-Modus (ganzer Sidebar = Chat)
```css
/* Im Share-Mode: Skripte verstecken, Chat voll */
#sidebarRight.share-mode-chat > .sidebar-header,
#sidebarRight.share-mode-chat > .sidebar-content,
#sidebarRight.share-mode-chat > .sidebar-footer {
  display: none;
}
#sidebarRight.share-mode-chat .chat-panel {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
}
```

### Chat-Komponenten
- `.chat-panel`: Höhe 100%, flex-column, border-top
- `.chat-name-prompt`: Zentrierte Eingabe, halbtransparenter Overlay innerhalb des Panels
- `.chat-messages`: flex: 1, overflow-y auto, padding, gap zwischen Nachrichten
- `.chat-message`: flex-row mit Avatar-Kürzel, Name+Text+Zeit
- `.chat-message.own`: rechts ausgerichtet (justify-self: flex-end)
- `.chat-input-area`: flex-row, input + Button am unteren Rand
- Farbgebung via CSS-Variablen (passt automatisch zu allen Themes)

---

## Phase 7: Script-Include

**Datei ändern:** `public/app.html`

`<script src="/js/chat.js"></script>` hinzufügen – **vor** `app.js`, **nach** `sharing.js`

---

## Dateien-Übersicht

| Datei | Aktion | Beschreibung |
|---|---|---|
| `server/socket/chatHandler.js` | **Neu** | In-memory Chat-History, broadcast, clearHistory |
| `server/socket/index.js` | **Ändern** | chatHandler einbinden |
| `server/socket/terminalHandler.js` | **Ändern** | chat:history bei attach + join-shared senden |
| `public/js/chat.js` | **Neu** | Chat-Modul (init, send, receive, name-prompt) |
| `public/app.html` | **Ändern** | Chat-Panel DOM + script-Tag |
| `public/css/main.css` | **Ändern** | Chat-Styles + Sidebar-Split |
| `public/js/sharing.js` | **Ändern** | Chat.activate/deactivate bei Share-Änderungen |
| `public/js/app.js` | **Ändern** | Chat.init(socket) außerhalb des `_shareMode`-Guards |

---

## Implementierungs-Reihenfolge

1. ✅ Phase 1: chatHandler.js (Backend) + index.js
2. ✅ Phase 5+6: HTML-DOM + CSS (Grundgerüst sichtbar machen)
3. ✅ Phase 2: chat.js (Frontend-Modul)
4. ✅ Phase 3+4: Sharing.js + app.js Integration
5. ✅ Phase 7: Script-Include
6. ✅ Phase 1 ergänzen: terminalHandler chat:history

---

## Offene Fragen / Hinweise

- **Tab-Wechsel:** Wenn Host zwischen Sessions wechselt, muss der Chat-Zustand pro Session gecacht werden  
  → `Chat._sessions = Map<sessionId, { messages[], active }>` empfohlen
- **Unread-Badge:** Optional nach Implementierung: kleines Badge am Expand-Button wenn Sidebar collapsed und neue Nachricht kommt
- **Kein Persistenz:** Chat-History geht verloren wenn Session endet – bewusste Entscheidung, Hinweis an User optional
- **XSS:** Alle Nachrichten müssen im Frontend via `textContent` (nie `innerHTML`) geschrieben werden; auf dem Server vom und message trimmen und lengthcap setzen
