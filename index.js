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

if (process.argv.length !== 5) {
  console.error(`Usage: node ${path.basename(process.argv[1])} <listen_port> <norm_xml> <hex_file>`);
  process.exit(1);
}

const port = parseInt(process.argv[2], 10);
const xmlPath = process.argv[3];
const hexPath = process.argv[4];

// Load normative XML and print metadata
const normData = fs.readFileSync(xmlPath, 'utf8');
let meterInfo;
xml2js.parseString(normData, { explicitArray: false }, (err, result) => {
  if (err) {
    console.error('Failed to parse XML:', err);
    process.exit(1);
  }
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

// MBUS control codes
const CTRL_REQ_UD1 = 0x05;
const CTRL_REQ_UD2 = 0x09;
const SND_UD1 = 0x5B;
const SND_UD2 = 0x5D;
const ACK_BYTE = Buffer.from([0xE5]);

const server = net.createServer((socket) => {
  console.log(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);

  socket.on('data', (data) => {
    // Detect short frame: 10 SND_UD1/UD2 ADDR LCS 16
    if (data.length === 5 && data[0] === 0x10 && (data[1] === SND_UD1 || data[1] === SND_UD2) && data[4] === 0x16) {
      console.log('Received short-frame SND_UD request');
      socket.write(meterResponse);
      console.log('Sent meter response (full telegram)');
      return;
    }
    // Detect long frame: 68 L1 L2 68 C A ... LCS 16
    if (data.length >= 7 && data[0] === 0x68) {
      const ctrl = data[6];
      if (ctrl === CTRL_REQ_UD1 || ctrl === CTRL_REQ_UD2) {
        console.log('Received long-frame read request');
        socket.write(meterResponse);
        console.log('Sent meter response (full telegram)');
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
