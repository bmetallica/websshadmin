# webSSHadmin — Handbuch

Vollständige Anleitung zur Installation, Administration und Nutzung.

---

## Inhaltsverzeichnis

1. [Überblick](#1-überblick)
2. [Installation](#2-installation)
3. [Erster Start](#3-erster-start)
4. [Administration](#4-administration)
   - [Benutzerverwaltung](#41-benutzerverwaltung)
   - [Gruppenverwaltung](#42-gruppenverwaltung)
   - [Gruppen-Verbindungen](#43-gruppen-verbindungen)
5. [Eigene Verbindungen](#5-eigene-verbindungen)
6. [Terminal-Nutzung](#6-terminal-nutzung)
7. [Quick Commands](#7-quick-commands)
8. [SFTP Dateibrowser](#8-sftp-dateibrowser)
9. [Skript-Manager](#9-skript-manager)
10. [Session-Sharing](#10-session-sharing)
11. [Bookmarks](#11-bookmarks)
12. [Port Dashboard](#12-port-dashboard)
13. [Active Directory / Windows AD](#13-active-directory--windows-ad)
14. [Sicherheitshinweise](#14-sicherheitshinweise)

---

## 1. Überblick

webSSHadmin ist ein webbasierter SSH-Client mit Multi-User-Unterstützung. Mehrere Benutzer können gleichzeitig SSH-Sessions in ihrem Browser öffnen, Dateien per SFTP verwalten, Skripte ausführen und laufende Sessions mit anderen teilen.

**Rollen:**

| Rolle | Beschreibung |
|---|---|
| **Admin** | Vollzugriff inkl. Benutzer- und Gruppenverwaltung |
| **User** | Eigene Verbindungen, Sessions, SFTP, Sharing |
| **Viewer** | Nur-Lese-Zugriff auf geteilte Sessions (kein Login nötig) |

---

## 2. Installation

### Voraussetzungen

- Docker und Docker Compose auf dem Host
- Port 2222 (oder ein anderer konfigurierbarer Port) erreichbar
- `/var/run/docker.sock` für das Port Dashboard (optional)

### Option A: Docker Hub (empfohlen)

`docker-compose.yml` erstellen:

```yaml
services:
  web-ssh:
    image: bmetallica/websshadmin:latest
    network_mode: host
    environment:
      - PORT=2222
      - DB_PATH=/app/data/database.sqlite
      - SCRIPTS_PATH=/app/scripts
    volumes:
      - ./scripts:/app/scripts
      - ./config:/app/config
      - ./data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: always
```

```bash
docker compose up -d
```

### Option B: Aus dem Quellcode bauen

```bash
git clone https://github.com/bmetallica/websshadmin.git
cd websshadmin
docker compose up -d --build
```

### HTTPS / Reverse Proxy

Für Produktivbetrieb wird ein Reverse Proxy mit TLS empfohlen. Beispiel für **Nginx**:

```nginx
server {
    listen 443 ssl;
    server_name ssh.example.com;

    ssl_certificate     /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    location / {
        proxy_pass http://127.0.0.1:2222;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> **Wichtig:** Socket.io benötigt die `Upgrade`-Header für WebSocket-Verbindungen. Ohne diese Header funktioniert das Terminal nicht.

### Volumes

| Pfad | Inhalt |
|---|---|
| `./data` | SQLite-Datenbank und Session-Secret (Verschlüsselungsschlüssel) |
| `./scripts` | Skript-Bibliothek (im Skript-Manager sichtbar) |
| `./config` | Konfigurationsdateien |
| `/var/run/docker.sock` | Docker Socket (read-only, für Port Dashboard) |

> **Backup:** Das `./data`-Verzeichnis enthält die gesamte Datenbank inkl. aller Benutzer, Verbindungen und verschlüsselter Credentials. Dieses Verzeichnis regelmäßig sichern.

---

## 3. Erster Start

Nach dem Start ist die Anwendung unter **http://\<host\>:2222** erreichbar.

**Standard-Login:**

| Feld | Wert |
|---|---|
| Benutzername | `admin` |
| Passwort | `admin` |

> **Sofort nach dem ersten Login das Passwort ändern:** Einstellungen (Zahnrad-Icon oben rechts) → **Passwort ändern**.

---

## 4. Administration

Administratoren erreichen die Verwaltungsfunktionen über das **Zahnrad-Icon** oben rechts.

### 4.1 Benutzerverwaltung

**Einstellungen → Benutzerverwaltung** (nur für Admins sichtbar)

#### Benutzer anlegen

1. **„+ Benutzer"** klicken
2. Benutzername, Passwort und Rolle (`admin` oder `user`) eingeben
3. **Speichern**

Der neue Benutzer kann sich sofort einloggen.

#### Benutzer bearbeiten

- Auf einen Benutzer in der Liste klicken
- Benutzername, Passwort oder Rolle ändern
- **Speichern**

> Passwortfeld leer lassen, um das bestehende Passwort beizubehalten.

#### Benutzer löschen

- Benutzer öffnen → **Löschen**

> Der letzte Admin-Account kann nicht gelöscht oder herabgestuft werden.

#### AD-Benutzer

Benutzer die sich über Active Directory eingeloggt haben erscheinen ebenfalls in der Liste. Ihr Passwort kann nur im Active Directory geändert werden — das Passwort-Feld ist bei AD-Benutzern gesperrt.

---

### 4.2 Gruppenverwaltung

Gruppen ermöglichen es, SSH-Verbindungen mit mehreren Benutzern zu teilen, ohne jedem Benutzer die Zugangsdaten direkt zu geben.

**Einstellungen → Gruppenverwaltung** (nur für Admins)

#### Gruppe erstellen

1. **„+ Gruppe"** klicken
2. Gruppenname eingeben
3. **Speichern**

#### Mitglieder hinzufügen

1. Gruppe öffnen
2. Im Abschnitt **Mitglieder** einen Benutzer aus dem Dropdown auswählen
3. **Hinzufügen**

Mitglieder können per **×** wieder entfernt werden.

#### Mitglieder-Ansicht für normale Benutzer

Normale Benutzer sehen in der linken Sidebar unter ihren eigenen Verbindungen alle Gruppen, in denen sie Mitglied sind. Gruppen-Verbindungen sind mit einem Gruppen-Icon markiert.

---

### 4.3 Gruppen-Verbindungen

Gruppen-Verbindungen sind SSH-Profile die für alle Mitglieder einer Gruppe sichtbar sind.

#### Gruppen-Verbindung anlegen

1. Gruppe öffnen → **„+ Verbindung"**
2. Name, Host, Port, optional Username/Passwort/Key angeben
3. **Speichern**

**Zwei Varianten:**

| Variante | Beschreibung |
|---|---|
| **Mit gespeicherten Credentials** | Username und Passwort/Key direkt in der Gruppen-Verbindung hinterlegen — alle Mitglieder verbinden sich mit diesen Daten |
| **Ohne Credentials (empfohlen)** | Keine Zugangsdaten in der Gruppe — jedes Mitglied hinterlegt seine eigenen Login-Daten |

#### Per-User Credentials (ohne gespeicherte Credentials)

Wenn eine Gruppen-Verbindung ohne Zugangsdaten angelegt wurde, sehen Mitglieder ein **🔓-Icon** neben der Verbindung in der Sidebar.

1. **🔓-Icon** klicken
2. Eigene Zugangsdaten eingeben (Username, Passwort oder Key)
3. Optional: **„Login-Daten für diese Verbindung speichern"** aktivieren → werden verschlüsselt gespeichert und beim nächsten Mal automatisch verwendet
4. **Verbinden**

Nach dem Speichern wechselt das Icon zu **🔒** (Credentials hinterlegt).

---

## 5. Eigene Verbindungen

Jeder Benutzer kann eigene SSH-Verbindungen verwalten. Diese sind nur für ihn sichtbar.

### Verbindung anlegen

1. In der linken Sidebar auf **„+"** klicken (oder das Plus-Icon neben „Verbindungen")
2. Formular ausfüllen:

| Feld | Beschreibung |
|---|---|
| **Name** | Anzeigename in der Sidebar |
| **Host** | IP-Adresse oder Hostname |
| **Port** | Standard: 22 |
| **Username** | SSH-Benutzername |
| **Auth-Methode** | Passwort oder Private Key |
| **Passwort / Key** | Entsprechende Zugangsdaten |
| **Passphrase** | Bei verschlüsseltem Private Key |

3. **Speichern** → Verbindung erscheint sofort in der Sidebar

### SSH-Tunnel konfigurieren

Im Verbindungs-Formular gibt es einen optionalen **Tunnel**-Abschnitt:

| Feld | Beispiel | Beschreibung |
|---|---|---|
| **Lokal Port** | `8080` | Port auf dem lokalen Rechner |
| **Remote Host** | `192.168.1.10` | Ziel-Host (aus Sicht des SSH-Servers) |
| **Remote Port** | `80` | Ziel-Port |
| **Bind-Adresse** | `127.0.0.1` | Auf welcher Adresse der lokale Port lauscht |

Wenn die Verbindung geöffnet wird, startet der Tunnel automatisch. Eingehende Verbindungen auf `<Bind-Adresse>:<Lokal Port>` werden über den SSH-Server zu `<Remote Host>:<Remote Port>` weitergeleitet.

### Verbindung bearbeiten / löschen

- In der Sidebar auf das **Stift-Icon** neben einer Verbindung klicken
- Felder ändern oder **Löschen** klicken

### Verbindungen sortieren

Verbindungen können per **Drag-and-Drop** in der Sidebar neu angeordnet werden.

### Verbindungen suchen

Das Suchfeld oben in der Sidebar filtert nach Name, Host und Username in Echtzeit.

---

## 6. Terminal-Nutzung

### Session starten

- In der Sidebar auf eine Verbindung klicken → Session öffnet sich in einem neuen Tab

### Tab-Verwaltung

| Aktion | Beschreibung |
|---|---|
| **Klick auf Tab** | Zu dieser Session wechseln |
| **Doppelklick auf Tab-Label** | Tab umbenennen (Enter zum Bestätigen, Escape zum Abbrechen) |
| **Drag-and-Drop** | Tab-Reihenfolge ändern |
| **×-Button im Tab** | Session beenden und Tab schließen |

### Fullscreen-Modus

- **Fullscreen-Button** im Header (Pfeil-Icon) oder **F11** → Sidebars, Stats und Footer werden ausgeblendet, das Terminal nimmt den gesamten Bildschirm ein
- **Escape** oder erneuter Klick auf das Icon → Fullscreen verlassen

### Tastenkombinationen im Terminal

| Kombination | Funktion |
|---|---|
| `Ctrl+C` | Prozess abbrechen |
| `Ctrl+D` | EOF / Logout |
| `Ctrl+Z` | Prozess anhalten (SIGTSTP) |
| `Ctrl+L` | Terminal leeren (clear) |
| `Ctrl+R` | Rückwärtssuche in der History |
| `Ctrl+A` | Zum Zeilenanfang |
| `Ctrl+E` | Zum Zeilenende |
| `Ctrl+W` | Wort vor dem Cursor löschen |
| `Ctrl+U` | Zeile bis zum Anfang löschen |

### Ctrl+W in Firefox

Firefox fängt `Ctrl+W` ab und schließt den Browser-Tab, bevor die Tastenkombination das Terminal erreicht.

**Lösung:** Unten rechts im Terminal befindet sich ein **„Strg+W"**-Button. Klick darauf sendet das `Ctrl+W`-Zeichen direkt an die Terminal-Session (z.B. um in nano die Suche zu öffnen).

Zusätzlich erscheint bei aktiven Sessions ein Bestätigungsdialog wenn versucht wird den Tab zu schließen, um versehentlichen Datenverlust zu verhindern.

> In Chrome und anderen Chromium-basierten Browsern funktioniert `Ctrl+W` im Terminal direkt — kein Button nötig.

### Auto-Reconnect

Bei einem SSH-Abbruch versucht die Anwendung automatisch die Verbindung wiederherzustellen (bis zu 5 Versuche, mit exponentiell wachsenden Pausen). Der Tab zeigt während des Reconnects einen Spinner mit dem aktuellen Versuch an. Der Terminal-Scrollback-Buffer (100.000 Zeichen) bleibt dabei erhalten.

---

## 7. Quick Commands

Quick Commands sind vordefinierte Befehle die mit einem Klick an die aktive Terminal-Session gesendet werden. Sie werden in der **Footer-Leiste** angezeigt.

### Kategorie erstellen

1. **„+"**-Button links in der Footer-Leiste klicken
2. Kategoriename eingeben → Enter

### Befehl hinzufügen

1. Auf eine Kategorie klicken → Dropdown öffnet sich
2. **„+"**-Button neben dem Kategorie-Header → Befehl-Dialog
3. Name und Befehl eingeben → Speichern

### Befehl ausführen

- Im Dropdown auf den Befehlsnamen klicken → Befehl wird sofort an die aktive Session gesendet

### Bearbeiten / Löschen

- **Stift-Icon** neben einem Befehl → bearbeiten
- **×-Icon** neben einem Befehl oder einer Kategorie → löschen

---

## 8. SFTP Dateibrowser

Der SFTP-Browser ermöglicht den Zugriff auf das Dateisystem des verbundenen Servers direkt im Browser.

### SFTP öffnen

- Im Header auf das **Ordner-Icon** klicken (oder den SFTP-Tab in der rechten Sidebar)
- Die Verbindung der aktiven Terminal-Session wird verwendet

### Navigation

| Aktion | Beschreibung |
|---|---|
| **Klick auf Ordner** | In Verzeichnis wechseln |
| **„↑"-Button** | Übergeordnetes Verzeichnis |
| **„←"-Button** | Zurück (History) |
| **„⌂"-Button** | Home-Verzeichnis |
| **Pfad-Eingabefeld** | Direkteingabe eines Pfades + Enter |

### Dateien hochladen

- **Upload-Button** klicken → Dateiauswahl-Dialog (Mehrfachauswahl möglich)
- **Drag-and-Drop** von Dateien direkt in den SFTP-Browser

### Dateien herunterladen

- Auf den **Dateinamen** klicken → Download startet (funktioniert bis ca. 50 MB)

### Datei bearbeiten

1. **Stift-Icon** neben einer Datei klicken → Datei öffnet sich im integrierten Ace Editor
2. Syntax-Highlighting wird anhand der Dateiendung automatisch erkannt (25+ Sprachen)
3. Änderungen vornehmen → **Speichern**

### Neue Datei / Ordner erstellen

- **„+ Datei"** oder **„+ Ordner"** Button → Name eingeben → Erstellen

### Umbenennen / Löschen

- **Stift-Icon** neben einer Datei/Ordner → Umbenennen oder Löschen

### Datei-Metadaten

In der Dateiliste werden Größe, Berechtigungen (Oktal), Änderungsdatum und Besitzer (UID/GID) angezeigt.

---

## 9. Skript-Manager

Der Skript-Manager ermöglicht es, Skripte aus einer lokalen Bibliothek direkt auf dem verbundenen Server auszuführen.

### Skript-Bibliothek

Die Bibliothek ist das auf dem Server gemountete `./scripts`-Verzeichnis. Alle dort abgelegten Dateien und Unterordner erscheinen im Skript-Manager in einer Baumstruktur (rechte Sidebar).

### Skripte hochladen

- **Drag-and-Drop** von Skript-Dateien in den Skript-Manager (max. 10 MB pro Datei)
- Ordnerstruktur wird beibehalten

### Skript ausführen

1. Skript in der Baumstruktur anklicken (oder Tooltip „Skript ausführen" → Klick)
2. Das Skript wird auf den verbundenen Server hochgeladen (`/tmp/<scriptname>`), ausführbar gemacht (`chmod +x`) und ausgeführt
3. Die Ausgabe erscheint direkt im Terminal

### Live-Updates

Änderungen an der Skript-Bibliothek (neue Dateien, gelöschte Dateien) werden in Echtzeit im Browser aktualisiert — kein Neuladen nötig.

---

## 10. Session-Sharing

Eine laufende Terminal-Session kann per Link mit anderen geteilt werden — auch mit Personen die keinen Account in der Anwendung haben.

### Share-Link erstellen

1. Im Header auf das **Teilen-Icon** klicken (während eine Session aktiv ist)
2. **Rolle** wählen:
   - **Viewer** — Der Empfänger kann das Terminal live beobachten, aber nichts eintippen
   - **Coworker** — Der Empfänger hat vollständige Terminal-Kontrolle (lesen + schreiben)
3. Optional: **Label** vergeben (z.B. „Support-Team" oder „Max Mustermann")
4. **Link erstellen** → URL wird angezeigt und kann kopiert werden

### Session beitreten (Empfänger)

Der Empfänger öffnet den Share-Link im Browser. Es ist **kein Login erforderlich**. Das Terminal öffnet sich direkt mit den entsprechenden Rechten.

- **Viewer:** Sieht die Terminal-Ausgabe in Echtzeit, kann aber nicht tippen
- **Coworker:** Sieht die Terminal-Ausgabe und kann Befehle eingeben — alle Teilnehmer sehen die Eingaben sofort

### Viewer zu Coworker hochstufen

Der Session-Besitzer kann einen Viewer nachträglich zum Coworker hochstufen:

1. **Teilen-Icon** klicken → aktive Share-Links werden aufgelistet
2. Beim gewünschten Token auf das **Pfeil-Icon** (Hochstufen) klicken → Rolle wechselt zu „Coworker"
3. Der Viewer erhält sofort Schreibzugriff ohne die Seite neu laden zu müssen

### Share-Token widerrufen

1. **Teilen-Icon** klicken → aktive Share-Links aufgelistet
2. Beim gewünschten Token auf **×** klicken → Token wird ungültig
3. Alle über diesen Token verbundenen Betrachter werden sofort getrennt

> Tokens sind an die laufende Session gebunden. Wenn die Session beendet wird, werden automatisch alle Share-Verbindungen getrennt.

---

## 11. Bookmarks

Bookmarks sind Links zu externen Tools und Webseiten (z.B. Monitoring, Router-Webinterfaces, Wikis).

### Bookmark hinzufügen

1. **Bookmarks-Dropdown** im Header öffnen (Lesezeichen-Icon)
2. **„+"**-Button → Name und URL eingeben → Speichern

### Bookmark öffnen

- Im Dropdown auf den Bookmark-Namen klicken → öffnet sich in einem neuen Browser-Tab

### Bookmark bearbeiten / löschen

- Im Dropdown auf das **Stift-Icon** neben dem Bookmark klicken

---

## 12. Port Dashboard

Das Port Dashboard zeigt alle belegten Netzwerk-Ports des Docker-Hosts.

### Öffnen

- Im Header auf das **Dashboard-Icon** klicken

### Informationen

| Spalte | Beschreibung |
|---|---|
| **Port** | Port-Nummer (rot = System-Port < 1024) |
| **Bind-Adresse** | Auf welcher Adresse der Port lauscht |
| **Prozess** | Name des Prozesses der den Port belegt |
| **PID** | Prozess-ID |
| **Container** | Docker-Container-Name (wenn zutreffend) |
| **Image** | Docker-Image des Containers |

### Filter

Das Suchfeld filtert gleichzeitig nach Port, Prozess, Container und Bind-Adresse.

### Auto-Refresh

Das Dashboard aktualisiert sich automatisch alle 10 Sekunden. Manuell kann mit dem **Refresh-Button** aktualisiert werden.

> Voraussetzung: `/var/run/docker.sock` ist in der `docker-compose.yml` als Volume eingebunden (read-only).

---

## 13. Active Directory / Windows AD

Die Anwendung unterstützt optionale Authentifizierung über Active Directory / LDAP. Benutzer können sich mit ihren Domain-Zugangsdaten einloggen — es ist kein separates Konto in der Anwendung nötig.

### Funktionsweise

1. Benutzer wählt auf der Login-Seite **„Domäne"** statt „Lokal"
2. Die Anwendung verbindet sich mit dem LDAP-Server und sucht den Benutzer anhand des konfigurierten Filters
3. Das Passwort wird durch einen Bind-Versuch als der gefundene Benutzer verifiziert
4. Die AD-Gruppenmitgliedschaften werden abgerufen und auf App-Gruppen gemappt
5. Beim ersten Login wird automatisch ein lokaler Account erstellt; bei jedem weiteren Login werden Rolle und Gruppenzuordnungen synchronisiert

### Konfiguration in docker-compose.yml

```yaml
services:
  web-ssh:
    image: bmetallica/websshadmin:latest
    network_mode: host
    environment:
      - PORT=2222
      - DB_PATH=/app/data/database.sqlite
      - SCRIPTS_PATH=/app/scripts

      # AD aktivieren
      - AD_ENABLED=true

      # LDAP-Server (Domain Controller)
      - AD_URL=ldap://dc01.firma.local

      # Basis-DN der Domain
      - AD_BASE_DN=dc=firma,dc=local

      # Service-Account für die Benutzersuche
      - AD_BIND_DN=cn=svc-webssh,ou=ServiceAccounts,dc=firma,dc=local
      - AD_BIND_PASSWORD=SicheresPasswort123!

      # Filter zur Benutzersuche ({{username}} wird ersetzt)
      - AD_USER_FILTER=(sAMAccountName={{username}})

      # Standard-Rolle für neue AD-Benutzer
      - AD_DEFAULT_ROLE=user

      # AD-Gruppen die Admin-Rechte erhalten (kommagetrennt)
      - AD_ADMIN_GROUPS=WebSSH-Admins,IT-Admins

      # AD-Gruppen auf App-Gruppen mappen (JSON)
      - AD_GROUP_MAP={"Server-Team":"server-prod","Dev-Team":"development","DB-Team":"datenbanken"}

    volumes:
      - ./scripts:/app/scripts
      - ./config:/app/config
      - ./data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: always
```

### Umgebungsvariablen im Detail

| Variable | Beschreibung |
|---|---|
| `AD_ENABLED` | `true` um AD-Login zu aktivieren. Der lokale Login bleibt weiterhin verfügbar. |
| `AD_URL` | URL des LDAP-Servers. `ldap://` für unverschlüsselt, `ldaps://` für LDAPS (Port 636). |
| `AD_BASE_DN` | Basis-DN der Suche. Alle Benutzer müssen unterhalb dieses DNs liegen. |
| `AD_BIND_DN` | DN des Service-Accounts. Benötigt Lesezugriff auf Benutzer und Gruppen. |
| `AD_BIND_PASSWORD` | Passwort des Service-Accounts. |
| `AD_USER_FILTER` | LDAP-Filter zur Benutzersuche. `{{username}}` wird durch den eingegebenen Benutzernamen ersetzt. Standard: `(sAMAccountName={{username}})` |
| `AD_GROUP_FILTER` | LDAP-Filter für Gruppenmitgliedschaft. Standard: `(member={{dn}})` |
| `AD_DEFAULT_ROLE` | Rolle die neue AD-Benutzer beim ersten Login erhalten: `user` oder `admin`. |
| `AD_ADMIN_GROUPS` | Kommagetrennte Liste von AD-Gruppen deren Mitglieder Admin-Rechte erhalten. Bei jedem Login neu ausgewertet. |
| `AD_GROUP_MAP` | JSON-Objekt: AD-Gruppenname → App-Gruppenname. Mitgliedschaften werden bei jedem Login synchronisiert. |

### Service-Account einrichten

Der Service-Account benötigt im Active Directory folgende Berechtigungen:

- **Lesezugriff** auf alle Benutzer-Objekte im konfigurierten `AD_BASE_DN`
- **Lesezugriff** auf das Attribut `memberOf` (Gruppenmitgliedschaften)
- Kein Schreibzugriff notwendig

Empfehlung: Eigene OU für Service-Accounts, Passwort auf „läuft nie ab" setzen, interaktiven Login deaktivieren.

### Gruppen-Mapping

Das `AD_GROUP_MAP` bildet AD-Gruppen auf in der Anwendung angelegte Gruppen ab:

```
AD_GROUP_MAP={"AD-Gruppenname":"app-gruppenname","Server-Admins":"server-prod"}
```

- Der **AD-Gruppenname** muss exakt dem `CN` der Gruppe im AD entsprechen (case-sensitive)
- Der **App-Gruppenname** muss einer zuvor in der Anwendung angelegten Gruppe entsprechen
- Nicht gemappte AD-Gruppen werden ignoriert
- Bei jedem Login werden die Gruppen neu abgeglichen — wird ein Benutzer aus einer AD-Gruppe entfernt, verliert er beim nächsten Login automatisch den Zugriff auf die entsprechende App-Gruppe

**Beispiel-Szenario:**

```
AD_GROUP_MAP={"WebSSH-Server-Prod":"server-prod","WebSSH-Dev":"development"}
AD_ADMIN_GROUPS=WebSSH-Admins
AD_DEFAULT_ROLE=user
```

- Mitglieder von `WebSSH-Server-Prod` → sehen in der App die Gruppe „server-prod" mit deren SSH-Verbindungen
- Mitglieder von `WebSSH-Admins` → bekommen automatisch die Admin-Rolle

### Tipps für Windows AD

**UPN statt sAMAccountName:**
Falls Benutzer sich mit `user@firma.local` statt mit `user` einloggen sollen:
```
AD_USER_FILTER=(userPrincipalName={{username}})
```

**LDAPS (verschlüsselt, Port 636):**
```
AD_URL=ldaps://dc01.firma.local:636
```
Das Zertifikat des Domain Controllers muss vom Node.js-Prozess als vertrauenswürdig eingestuft werden. Bei selbstsignierten Zertifikaten ggf. `NODE_TLS_REJECT_UNAUTHORIZED=0` setzen (nur in internen Netzen).

**Mehrere Domain Controller (Failover):**
`ldapjs` unterstützt nur eine URL. Für Hochverfügbarkeit einen Load-Balancer oder einen LDAP-Proxy (z.B. HAProxy) vorschalten.

**Verschachtelte Gruppen:**
Der Standard-Filter `(member={{dn}})` wertet nur direkte Gruppenmitgliedschaften aus. Für verschachtelte Gruppen (Gruppe in Gruppe):
```
AD_GROUP_FILTER=(member:1.2.840.113556.1.4.1941:={{dn}})
```
Dieser LDAP_MATCHING_RULE_IN_CHAIN-Filter funktioniert nur mit Active Directory (nicht mit OpenLDAP).

### Fehlersuche AD

| Symptom | Mögliche Ursache |
|---|---|
| „LDAP-Verbindungsfehler" | `AD_URL` nicht erreichbar, Firewall blockiert Port 389/636 |
| „Service-Bind fehlgeschlagen" | `AD_BIND_DN` oder `AD_BIND_PASSWORD` falsch |
| „Benutzer nicht gefunden" | `AD_USER_FILTER` passt nicht, oder `AD_BASE_DN` zu eng |
| „Ungültige Anmeldedaten" | Falsches Passwort, gesperrter Account, abgelaufenes Passwort |
| Gruppen werden nicht synchronisiert | AD-Gruppenname in `AD_GROUP_MAP` stimmt nicht mit CN im AD überein |
| AD-Benutzer bekommt keine Admin-Rechte | Gruppenname in `AD_ADMIN_GROUPS` stimmt nicht mit CN im AD überein |

Container-Logs prüfen:
```bash
docker compose logs -f web-ssh
```

---

## 14. Sicherheitshinweise

### Standard-Passwort ändern

Das Standard-Passwort `admin` muss sofort nach der ersten Installation geändert werden.

### HTTPS

Im Produktivbetrieb ausschließlich HTTPS verwenden. HTTP überträgt Passwörter und Session-Cookies im Klartext. Ein Reverse Proxy mit TLS-Terminierung (Nginx, Caddy, Traefik) ist die empfohlene Lösung.

### SESSION_SECRET

Wenn nicht angegeben, wird beim ersten Start automatisch ein zufälliges Secret generiert und in `./data/session.secret` gespeichert. Dieses Secret wird für Session-Cookies und die AES-Verschlüsselung der SSH-Credentials verwendet.

> Das `./data`-Verzeichnis nicht löschen — ohne das Secret können gespeicherte SSH-Passwörter nicht mehr entschlüsselt werden.

Für explizite Kontrolle kann das Secret auch als Umgebungsvariable gesetzt werden:
```yaml
- SESSION_SECRET=langes-zufaelliges-geheimnis-mindestens-32-zeichen
```

### Netzwerk-Isolation

Mit `network_mode: host` hat der Container Zugriff auf alle Netzwerkschnittstellen des Hosts. Alternativ kann ein spezifisches Docker-Netzwerk verwendet und der Port explizit gemappt werden:

```yaml
ports:
  - "127.0.0.1:2222:2222"
```

### Share-Links

Share-Links geben Zugriff auf eine laufende Terminal-Session ohne Login. Tokens sollten nur an vertrauenswürdige Personen weitergegeben werden. Nach Abschluss der Zusammenarbeit den Token widerrufen (×-Button im Share-Dialog).

### Docker Socket

Das Mounten von `/var/run/docker.sock` gibt dem Container weitreichende Rechte auf dem Host. Falls das Port Dashboard nicht benötigt wird, diese Zeile in der `docker-compose.yml` entfernen.

### Rate Limiting

Login-Versuche sind auf **10 Versuche pro 15 Minuten pro IP** begrenzt.

---

*webSSHadmin — https://github.com/bmetallica/websshadmin*
