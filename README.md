# M-Bus Device Simulator

Dieses Projekt simuliert M-Bus Geräte (z. B. Strom- oder Wärmezähler) über TCP/IP. Es kann sowohl rohe M-Bus-Telegramme als auch dynamisch generierte Werte auf Basis einer XML-Beschreibung ausgeben.

## Features

- **Simuliert M-Bus Geräte**: Antwortet auf M-Bus-Frames (Short- und Long-Frame) über TCP/IP.
- **Dynamische Werte**: Mit `simulate.js` werden Werte aus einer XML-Datei bei jeder Anfrage zufällig variiert.
- **Replay-Modus**: Mit `replay_hex.js` wird ein statisches, vorgegebenes Telegramm immer gleich zurückgegeben.
- **Test-Client**: Mit `read-mbus-raw.js` kann ein M-Bus-Gerät abgefragt werden.

## Voraussetzungen

- Node.js (>=14)
- Abhängigkeiten installieren:

  ```sh
  npm install
  ```

## Dateien

- [`simulate.js`](simulate.js): Simuliert ein Gerät mit dynamischen Werten aus XML und Hex-Datei.
- [`replay_hex.js`](replay_hex.js): Gibt immer das gleiche Hex-Telegramm zurück.
- [`read-mbus-raw.js`](read-mbus-raw.js): Einfache Client-Anwendung zum Testen der Simulatoren.
- `devices/`: Beispiel-XML- und Hex-Dateien für verschiedene Geräte.

## Nutzung

### 1. Simulation mit dynamischen Werten

Starte einen simulierten Zähler mit dynamischen Werten:

```sh
node simulate.js <port> <norm_xml> <hex_file>
```

Beispiel:

```sh
node simulate.js 8000 devices/electricity-meter-1.norm.xml devices/electricity-meter-1.hex
```

### 2. Replay-Modus (statisches Telegramm)

Starte einen Simulator, der immer das gleiche Telegramm sendet:

```sh
node replay_hex.js <port> <hex_file>
```

Beispiel:

```sh
node replay_hex.js 8000 devices/electricity-meter-1.hex
```

### 3. Test-Client

Frage ein simuliertes Gerät ab:

```sh
node read-mbus-raw.js [address] [ip:port]
```

Beispiele:

```sh
node read-mbus-raw.js
node read-mbus-raw.js 5
node read-mbus-raw.js 5 127.0.0.1:8000
```

## Hinweise

- Die XML-Dateien beschreiben die Datenstruktur und Wertebereiche der simulierten Geräte.
- Die HEX-Dateien enthalten rohe M-Bus-Telegramme, wie sie vom Gerät gesendet werden.
- Die simulierten Werte werden bei jeder Anfrage neu generiert (nur bei `simulate.js`).

## Lizenz

ISC

---

Siehe auch die Beispielgeräte in [`devices/`](devices/)
