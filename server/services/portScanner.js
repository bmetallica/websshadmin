const { execSync } = require('child_process');
const http = require('http');

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 5000;

function scanPorts() {
  const now = Date.now();
  if (cache && (now - cacheTime) < CACHE_TTL) return cache;

  const ports = [];

  try {
    // Use ss to get listening ports with process info
    const output = execSync('ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const lines = output.trim().split('\n').slice(1); // skip header
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;

      // ss format: State Recv-Q Send-Q Local_Address:Port Peer_Address:Port Process
      // netstat format: Proto Recv-Q Send-Q Local_Address Foreign_Address State PID/Program
      let localAddr, processInfo;

      if (parts[0] === 'LISTEN') {
        // ss format
        localAddr = parts[3];
        processInfo = parts[5] || '';
      } else if (parts[0] === 'tcp' || parts[0] === 'tcp6') {
        // netstat format
        localAddr = parts[3];
        processInfo = parts[6] || '';
      } else {
        // ss without state column
        localAddr = parts[3];
        processInfo = parts.length > 5 ? parts[5] : '';
      }

      if (!localAddr) continue;

      // Parse address:port
      const lastColon = localAddr.lastIndexOf(':');
      if (lastColon === -1) continue;
      const bindAddr = localAddr.substring(0, lastColon);
      const port = parseInt(localAddr.substring(lastColon + 1), 10);
      if (isNaN(port)) continue;

      // Parse process name from ss format: users:(("name",pid=123,fd=4))
      let process = '';
      const procMatch = processInfo.match(/\("([^"]+)",pid=(\d+)/);
      if (procMatch) {
        process = procMatch[1];
      } else if (processInfo.includes('/')) {
        // netstat format: PID/program
        process = processInfo.split('/').slice(1).join('/');
      }

      ports.push({
        port,
        bind: bindAddr.replace(/^\[/, '').replace(/\]$/, ''),
        process: process || '?',
        protocol: 'tcp',
      });
    }
  } catch (e) {
    // Fallback: parse /proc/net/tcp
    try {
      const fs = require('fs');
      const tcpData = fs.readFileSync('/proc/net/tcp', 'utf-8');
      const tcpLines = tcpData.trim().split('\n').slice(1);
      for (const line of tcpLines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        const state = parseInt(parts[3], 16);
        if (state !== 0x0A) continue; // LISTEN only
        const [hexAddr, hexPort] = parts[1].split(':');
        const port = parseInt(hexPort, 16);
        const addrParts = hexAddr.match(/.{2}/g).reverse();
        const bind = addrParts.map(h => parseInt(h, 16)).join('.');
        ports.push({ port, bind, process: '?', protocol: 'tcp' });
      }
    } catch (e2) { /* ignore */ }
  }

  // Try to enrich with Docker container info
  _enrichWithDocker(ports);

  // Sort by port
  ports.sort((a, b) => a.port - b.port);

  // Deduplicate (same port, keep the one with more info)
  const seen = new Map();
  for (const p of ports) {
    const existing = seen.get(p.port);
    if (!existing || (p.process !== '?' && existing.process === '?')) {
      seen.set(p.port, p);
    }
  }

  cache = Array.from(seen.values());
  cacheTime = now;
  return cache;
}

function _enrichWithDocker(ports) {
  try {
    const data = _dockerGet('/containers/json');
    if (!Array.isArray(data)) return;

    const containerPorts = new Map();
    for (const container of data) {
      const name = (container.Names && container.Names[0] || '').replace(/^\//, '');
      const image = container.Image || '';
      if (container.Ports) {
        for (const p of container.Ports) {
          if (p.PublicPort) {
            containerPorts.set(p.PublicPort, { name, image });
          }
        }
      }
    }

    for (const p of ports) {
      const info = containerPorts.get(p.port);
      if (info) {
        p.container = info.name;
        p.image = info.image;
      }
    }
  } catch (e) { /* Docker not available */ }
}

function _dockerGet(path) {
  const fs = require('fs');
  try {
    fs.accessSync('/var/run/docker.sock');
  } catch { return null; }

  const result = execSync(
    `curl -s --unix-socket /var/run/docker.sock http://localhost${path}`,
    { encoding: 'utf-8', timeout: 3000 }
  );
  return JSON.parse(result);
}

module.exports = { scanPorts };
