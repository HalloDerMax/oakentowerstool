# Oaken Tower Overlay

**Dein Plan und Kauf-Tipps direkt über dem Spiel.** Inoffizielles Fan-Tool zu _Oaken Tower_, Begleiter zum [Oaken Tower Fan Hub](https://oaken.hallodasevent.de).

![Hinweise über dem Shop](docs/screenshots/shop-hints.png)

## Was das Tool kann

Das Tool ist ein **Trainer**: Es liest dein Spiel mit und sagt dir klar, was du tun sollst.

- **Eine Anweisung, groß oben:** **Buy …**, **Merge …**, **Swap in …**, **Sell …**, **Roll**, **Level up (60g)** oder **Save your gold**, mit einem Satz warum und dem nächsten Schritt darunter. Sie berücksichtigt deinen Build-Weg, deine Bank, dein Gold, Level und XP.

- **Klare Kaufentscheidung über jedem Shop-Item** (ein ruhiges Label, das nur wechselt, wenn sich im Shop etwas ändert):
  - **BUY · Build**: dein Build braucht es
  - **STAR ↑**: Kopie eines Items, das du hast, ergibt einen Stern
  - **Fits · Goblin**: passt zu den Packs, die du spielst
  - **Switch · Build**: passt zu einem anderen Weg, den deine Items erlauben
  - **Skip**
- **Build-Wege zur Auswahl:** Aus deinen Items (Turm und Bank) schlägt das Tool bis zu drei Wege vor, aus unseren berechneten Builds und aus Builds, die es für deine Packs neu berechnet. Du klickst deinen Weg an, und die Tipps folgen ihm.
- **Liest das Spiel mit:** Turm, **Bank**, **Perk**, **Tag**, **Gold**, **Level und XP**, **Luck**, **nächste Chest**, **Shop-Chancen**, **Leben**, **Trophäen**. Tag, Perk und Turm werden übernommen.
- **Panel über dem Spiel:** übersichtlich (Anweisung, Shop, Weg; Turm, Planer und Einstellungen eingeklappt), passt sich jeder Fenstergröße an (breit: Shop und Weg nebeneinander), springt nicht bei Aktualisierungen, verschiebbar, **durchsichtig einstellbar (20–100 %)**, sperrbar (Klicks gehen durch zum Spiel).
- **Live mit dem Planner der Website verbunden:** Änderungen erscheinen sofort auf beiden Seiten.

![Panel](docs/screenshots/panel.png)

## Einrichten

1. `OakenTowerOverlay-x.y.z.exe` starten (keine Installation). Das Spiel im Fenster- oder randlosen Modus spielen.
2. Fertig. Im **Vollbild oder randlosen Fenster** kennt das Tool die Positionen von Shop, Turm, Bank und Anzeigen selbst (auch auf Ultrawide- und 16:10-Bildschirmen, wo das Spiel mittig sitzt).
3. Nur im **Fenstermodus**: einmal **Strg+Umschalt+K**, pro Shop-Reihe einen Rahmen ziehen, dann den Turm, speichern. „Use auto layout“ schaltet zurück.

![Kalibrieren](docs/screenshots/calibrate.png)

| Kürzel | Wirkung |
|---|---|
| Strg+Umschalt+O | Ein- / ausblenden |
| Strg+Umschalt+L | Panel sperren (Klicks gehen durch) |
| Strg+Umschalt+K | Kalibrieren |
| Strg+Umschalt+S | Shop-Scan an / aus |
| Strg+Umschalt+↑ / ↓ | Panel weniger / mehr durchsichtig |

## Was das Tool sieht

Es nimmt den Bildschirm als ruhigen Video-Stream (2 Bilder pro Sekunde) und liest daraus nur die nötigen Ausschnitte: Item-Bilder werden mit den Item-Bildern verglichen, Zahlen mit einer Texterkennung (Tesseract, offline) gelesen, alles **auf deinem PC**. Ein Item gilt erst als erkannt, wenn mehrere Bilder hintereinander dasselbe zeigen. Kein Zugriff auf Speicher oder Dateien des Spiels, nichts wird hochgeladen. Die Verbindung zum Planner läuft nur lokal (`127.0.0.1`).

## Entwickeln

```bash
npm install
npm start        # bauen und starten
npm test         # Erkennung, auch an echten Spiel-Ausschnitten
npm run dist     # portable .exe nach release/
npm run sync     # Simulator, Daten und Bilder aus dem Hub nach shared/ (HUB_DIR=../oaken-tower-hub)
```

`shared/` ist eine Kopie der benötigten Teile des Fan Hubs (Simulator, Spieldaten, Overlay-Anzeige, Item-Bilder). Item-Bilder und Spielinhalte gehören den Entwicklern von _Oaken Tower_.

Die Positionen der Spielanzeigen leitet das Tool aus der Kalibrierung von Shop und Turm ab (`renderer/hud.ts`); ohne Kalibrierung nimmt es an, dass das Spiel den ganzen Bildschirm füllt. Die Tests prüfen Erkennung und Texterkennung an echten Spiel-Ausschnitten (ohne Spielernamen).
