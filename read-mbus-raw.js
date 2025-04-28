const net = require('net');

// parse arguments from argv
// usage: node read-mbus-raw.js [address] [ip:port]
// examples:
//   node read-mbus-raw.js         # address=1, host=127.0.0.1, port=8000
//   node read-mbus-raw.js 5       # address=5, host=127.0.0.1, port=8000
//   node read-mbus-raw.js 5 192.168.0.100:8001
//   node read-mbus-raw.js 192.168.0.100:8001

const args = process.argv.slice(2);

let primaryAddress = 1;
let HOST = '127.0.0.1';
let PORT = 8000;

args.forEach(arg => {
  if (/^\d+$/.test(arg)) {
    // numeric arg: primary address
    const addr = parseInt(arg, 10);
    if (addr < 0 || addr > 250) {
      console.error(`Invalid address "${arg}". Must be 0–250.`);
      process.exit(1);
    }
    primaryAddress = addr;
  } else if (/^[^:]+:\d+$/.test(arg)) {
    // host:port
    const [h, p] = arg.split(':');
    HOST = h;
    const portNum = parseInt(p, 10);
    if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
      console.error(`Invalid port "${p}". Must be 1–65535.`);
      process.exit(1);
    }
    PORT = portNum;
  } else {
    console.error(`Unknown argument "${arg}". Use an integer address or ip:port.`);
    process.exit(1);
  }
});

console.log(`Primary address: ${primaryAddress}`);
console.log(`Connecting to ${HOST}:${PORT}`);

// how long (ms) to wait for complete frame before giving up
const RESPONSE_TIMEOUT = 3000;

// Build the short-frame REQ_UD2 request (C=0x5B) for primary address A:
const A = primaryAddress;
const REQ_UD2_C = 0x5B;
const reqUd2Check = (REQ_UD2_C + A) & 0xFF;
const REQ_UD2_FRAME = Buffer.from([0x10, REQ_UD2_C, A, reqUd2Check, 0x16]);

console.log(`Sending REQ_UD2 short-frame: ${REQ_UD2_FRAME.toString('hex')}`);

const client = new net.Socket();
let buffer = Buffer.alloc(0);
let timer;

// Cleanup and disconnect, optionally logging a message
function cleanup(msg) {
  clearTimeout(timer);
  if (msg) console.log(msg);
  client.end();
}

client.connect(PORT, HOST, () => {
  console.log(`Connected`);
  client.write(REQ_UD2_FRAME);
  client.setTimeout(RESPONSE_TIMEOUT);
  timer = setTimeout(() => cleanup('Timeout waiting for frame'), RESPONSE_TIMEOUT);
});

client.on('data', chunk => {
  console.log('Received chunk:', chunk.toString('hex'));
  clearTimeout(timer);
  timer = setTimeout(() => cleanup('Timeout waiting for frame'), RESPONSE_TIMEOUT);

  // If it's a short frame echo or NKE, ignore:
  if (chunk[0] === 0x10) {
    console.log('← Ignored short frame');
    return;
  }

  // Accumulate long-frame data
  buffer = Buffer.concat([buffer, chunk]);

  // Find start of long frame
  const start = buffer.indexOf(0x68);
  if (start !== -1) {
    buffer = buffer.slice(start);
    if (buffer.length >= 4) {
      const lengthField = buffer[1];
      const totalLen = 6 + lengthField;
      if (buffer.length >= totalLen) {
        const frame = buffer.slice(0, totalLen);
        console.log('⬅ Full M-Bus long frame:', frame.toString('hex'));
        cleanup();
      }
    }
  }
});

client.on('timeout', () => cleanup('Socket timeout'));
client.on('end', () => console.log('Disconnected'));
client.on('error', err => console.error('TCP error:', err.message));
