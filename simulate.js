// mbus_tcp_device_sim.js
// Node.js version: Simulates an electricity meter (from test-frames/electricity-meter-1.hex)
// over TCP/IP. Dynamically loads the normalized XML and the raw hex telegram
// so it covers all fields specified in the XML and handles both short- and long-frame requests.
//
// Run with:
//   npm install xml2js
//   node mbus_tcp_device_sim.js <listen_port> <path_to_norm_xml> <path_to_hex>

const net = require('net');
const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

if (process.argv.length !== 6) {
  console.error(`Usage: node ${path.basename(process.argv[1])} <listen_port> <norm_xml> <hex_file> <broken telegram yes/no>`);
  process.exit(1);
}

const port = parseInt(process.argv[2], 10);
const xmlPath = process.argv[3];
const hexPath = process.argv[4];
const broken = process.argv[5];

// Funktion zum Generieren einer Zufallszahl zwischen min und max
function getRandomFloat(min, max) {
  return (Math.random() * (max - min) + min).toFixed(6);
}

// Neue Hilfsfunktion zum Generieren von passenden Zufallswerten je nach Einheit
function getRandomValueForUnit(unit, currentValue) {
  const value = parseFloat(currentValue);
  switch(unit) {
    case 'Wh':
      // Energiewerte leicht erhöhen (0-2% Zunahme)
      return (value * (1 + Math.random() * 0.02)).toFixed(6);
    case 'V':
      // Spannung ±5% um den aktuellen Wert
      return (value * (0.95 + Math.random() * 0.1)).toFixed(6);
    case 'A':
      // Strom ±20% um den aktuellen Wert
      return (value * (0.8 + Math.random() * 0.4)).toFixed(6);
    case 'W':
      // Leistung ±30% um den aktuellen Wert
      return (value * (0.7 + Math.random() * 0.6)).toFixed(6);
    default:
      // Sonstige Werte ±10% um den aktuellen Wert
      return (value * (0.9 + Math.random() * 0.2)).toFixed(6);
  }
}

// M-Bus DIF Konstanten gemäß libmbus
const DIF = {
  NO_DATA: 0x00,
  INT8: 0x01,
  INT16: 0x02,
  INT24: 0x03,
  INT32: 0x04,
  FLOAT32: 0x05,
  INT48: 0x06,
  INT64: 0x07,
  SELECTION: 0x08,
  BCD2: 0x09,
  BCD4: 0x0A,
  BCD6: 0x0B,
  BCD8: 0x0C,
  VARIABLE: 0x0D,
  BCD12: 0x0E,
  SPECIAL: 0x0F,
  DATA_FIELD_4: 0x04,
  SUBUNIT: 0x40
};

// M-Bus VIF Konstanten gemäß libmbus
const VIF = {
  ENERGY_WH: 0x00, // 0.1Wh to 1000Wh
  ENERGY_WH_EXP: 0x07, // 10⁰ Wh to 10⁷ Wh
  VOLUME_M3: 0x13,
  MASS_KG: 0x15,
  POWER_W: 0x28,
  VOLUME_FLOW_M3H: 0x38,
  FLOW_TEMP_C: 0x5A,
  RETURN_TEMP_C: 0x5E,
  MANUFACTURER: 0x0F,
  ENERGY: 0x04 // Wichtig: Energie wird oft als 0x04 kodiert
};

// Verbesserte Funktion zum Finden der Datenposition
function findValuePosition(telegram) {
  console.log('Analysiere Telegramm-Struktur:');
  console.log('Header:', telegram.slice(0, 20).toString('hex'));
  
  // Suche nach dem ersten Energiewert-Record
  let i = 20; // Startposition für erste Daten nach Header
  
  const dif = telegram[i];
  const vif = telegram[i + 1];
  
  console.log(`Prüfe Position ${i}: DIF=${dif.toString(16)}, VIF=${vif.toString(16)}`);
  
  // Prüfe auf korrekten DIF/VIF für Energiewert
  // DIF 0x10 = Data length 4 bytes, BCD format
  // VIF 0x04 = Energy in Wh
  if (dif === 0x10 && vif === 0x04) {
    const pos = i + 2; // Position nach DIF und VIF
    console.log(`Gefundene Wertposition: ${pos} (DIF=${dif.toString(16)}, VIF=${vif.toString(16)})`);
    return {
      position: pos,
      dif: dif,
      vif: vif,
      type: 'BCD4',
      value: telegram.slice(pos, pos + 4)
    };
  }
  
  return null;
}

function updateValueInTelegram(telegram, valueInfo, value) {
  const { position, type } = valueInfo;
  const bcdBuffer = Buffer.alloc(4);
  
  // Konvertiere zu ganzer Zahl durch Abschneiden der Nachkommastellen
  const scaledValue = Math.trunc(parseFloat(value));
  const valueStr = scaledValue.toString().padStart(8, '0');
  
  // Debug Ausgabe
  console.log('Aktualisiere Wert:');
  console.log(`  Original: ${value}`);
  console.log(`  Ganzzahl: ${scaledValue}`);
  console.log(`  BCD: ${valueStr}`);
  
  // BCD Konvertierung (Little Endian)
  for (let i = 0; i < 4; i++) {
    const pos = 6 - (i * 2); // Position von rechts nach links
    const digit1 = parseInt(valueStr[pos], 10);
    const digit2 = parseInt(valueStr[pos + 1], 10);
    bcdBuffer[i] = (digit1 << 4) | digit2;
  }
  
  console.log(`  Bytes: ${bcdBuffer.toString('hex')}`);
  
  // Kopiere das original Telegram
  const newTelegram = Buffer.from(telegram);
  bcdBuffer.copy(newTelegram, position);
  
  // Berechne neue Prüfsumme
  let checksum = 0;
  for (let i = 4; i < newTelegram.length - 2; i++) {
    checksum += newTelegram[i];
  }
  newTelegram[newTelegram.length - 2] = checksum & 0xFF;
  
  return newTelegram;
}

// Load normative XML and print metadata
const normData = fs.readFileSync(xmlPath, 'utf8');
let meterInfo;
let originalXml;
xml2js.parseString(normData, { explicitArray: false }, (err, result) => {
  if (err) {
    console.error('Failed to parse XML:', err);
    process.exit(1);
  }
  originalXml = result;
  const mbus = result.MBusData;
  const info = mbus.SlaveInformation;
  console.log('Meter Slave Information:');
  console.log(`  Id:           ${info.Id}`);
  console.log(`  Manufacturer: ${info.Manufacturer}`);
  console.log(`  Version:      ${info.Version}`);
  console.log(`  Medium:       ${info.Medium}`);
  console.log(`  AccessNumber: ${info.AccessNumber}`);
  console.log(`  Status:       ${info.Status}`);
  console.log(`  Signature:    ${info.Signature}`);
  console.log('Data Records:');
  const records = Array.isArray(mbus.DataRecord) ? mbus.DataRecord : [mbus.DataRecord];
  records.forEach(rec => {
    console.log(`  [${rec.$.id}] ${rec.Quantity} (${rec.Unit}) = ${rec.Value}`);
  });
  meterInfo = { info, records };
});

// Load raw hex telegram and convert to Buffer
const hexText = fs.readFileSync(hexPath, 'utf8');
const hexBytes = hexText
  .trim()
  .split(/\s+/)
  .map(b => parseInt(b, 16));
const meterResponse = Buffer.from(hexBytes);
console.log(`Loaded meter telegram: ${meterResponse.length} bytes from ${hexPath}`);

// Nach dem Laden des Telegramms, Position bestimmen
const valueInfo = findValuePosition(meterResponse);
if (!valueInfo) {
  console.error('Konnte Wertposition im Telegramm nicht finden!');
  process.exit(1);
}
console.log(`Wertposition im Telegramm: ${valueInfo.position}`);

// MBUS control codes
const CTRL_REQ_UD1 = 0x05;
const CTRL_REQ_UD2 = 0x09;
const SND_UD1 = 0x5B;
const SND_UD2 = 0x5D;
const ACK_BYTE = Buffer.from([0xE5]);

// Helper function: Send buffer in 24-byte blocks with delay
async function sendInChunks(socket, buffer, chunkSize = 24, delayMs = 50) {
  console.log(`Sending ${buffer.length} bytes in ${chunkSize}-byte chunks (delay ${delayMs}ms)...`);
  let i = 0;
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    const chunk = buffer.slice(offset, offset + chunkSize);
    socket.write(chunk);
    console.log(`  Sent bytes ${offset}–${offset + chunk.length - 1}`);
    await new Promise(res => setTimeout(res, delayMs));
    i++;
	if (i === 3 && broken === "yes")
	{
	  console.log("Abort");
	  return;
	}

  }
  console.log('Finished sending full telegram.');
}

const server = net.createServer((socket) => {
  console.log(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);

  socket.on('data', async (data) => {
    // Aktualisiere alle DataRecords mit neuen Werten
    const records = Array.isArray(originalXml.MBusData.DataRecord) ? 
      originalXml.MBusData.DataRecord : 
      [originalXml.MBusData.DataRecord];

    records.forEach(record => {
      const newValue = getRandomValueForUnit(record.Unit, record.Value);
      record.Value = newValue;
      console.log(`Updated ${record.Quantity} (${record.Unit}): ${newValue}`);
    });

    const valueInfo = findValuePosition(meterResponse);
    if (!valueInfo) {
      console.error('Konnte Wertposition im Telegramm nicht finden!');
      process.exit(1);
    }

    // Beim Aktualisieren des Werts (nur erster Wert im Telegramm)
    const updatedResponse = updateValueInTelegram(meterResponse, valueInfo, records[0].Value);

    // Detect short frame: 10 SND_UD1/UD2 ADDR LCS 16
    if (data.length === 5 && data[0] === 0x10 && (data[1] === SND_UD1 || data[1] === SND_UD2) && data[4] === 0x16) {
      console.log('Received short-frame SND_UD request');
      console.log(`Sending updated telegram with DataRecord[0]: ${records[0].Value}`);
      await sendInChunks(socket, updatedResponse, 24, 1000);
      return;
    }
    // Detect long frame: 68 L1 L2 68 C A ... LCS 16
    if (data.length >= 7 && data[0] === 0x68) {
      const ctrl = data[6];
      if (ctrl === CTRL_REQ_UD1 || ctrl === CTRL_REQ_UD2) {
        console.log('Received long-frame read request');
        await sendInChunks(socket, updatedResponse, 24, 500);
      } else {
        socket.write(ACK_BYTE);
        console.log('Sent ACK');
      }
      return;
    }
    console.warn('Received unknown frame:', data.toString('hex'));
  });

  socket.on('close', () => {
    console.log('Client disconnected');
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

server.listen(port, () => {
  console.log(`Simulated M-Bus device listening on port ${port}`);
});
