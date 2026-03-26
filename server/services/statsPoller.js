// NOTE: sessionManager is lazy-required to avoid circular dependency
const intervals = new Map();

function parseCpuLine(line) {
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = parts[3] + (parts[4] || 0);
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total };
}

function startPolling(sessionId) {
  if (intervals.has(sessionId)) return; // already polling

  const sessionManager = require('./sessionManager');
  const state = sessionManager.getSession(sessionId);
  if (!state || !state.sshClient) {
    console.log(`[Stats] Cannot start polling for ${sessionId}: no session or client`);
    return;
  }

  console.log(`[Stats] Polling started for session ${sessionId}`);
  let prevCpu = null;
  let pollInFlight = false;

  const doPoll = () => {
    const sessionManager = require('./sessionManager');
    const s = sessionManager.getSession(sessionId);
    if (!s || !s.sshClient) {
      console.log(`[Stats] Session ${sessionId} gone, stopping poll`);
      stopPolling(sessionId);
      return;
    }

    // Skip if previous poll hasn't finished yet (prevents stacking)
    if (pollInFlight) return;
    pollInFlight = true;

    // Timeout: if poll doesn't complete in 5 seconds, reset the flag
    const pollTimeout = setTimeout(() => {
      pollInFlight = false;
    }, 5000);

    const cmd = 'cat /proc/stat 2>/dev/null | head -1; echo "---STAT_SEP---"; cat /proc/meminfo 2>/dev/null | head -5; echo "---STAT_SEP---"; df -Ph / 2>/dev/null | tail -1';
    try {
      s.sshClient.exec(cmd, (err, stream) => {
        if (err) {
          console.log(`[Stats] exec error for ${sessionId}: ${err.message}`);
          clearTimeout(pollTimeout);
          pollInFlight = false;
          return;
        }

        let output = '';
        stream.on('data', (data) => { output += data.toString(); });
        stream.stderr.on('data', () => {}); // consume stderr

        stream.on('close', () => {
          clearTimeout(pollTimeout);
          pollInFlight = false;
          try {
            const sections = output.split('---STAT_SEP---').map(s => s.trim());
            if (sections.length < 3) {
              console.log(`[Stats] Unexpected sections (${sections.length}) for ${sessionId}: ${output.substring(0, 300)}`);
              return;
            }

            const cpuLine = sections[0];
            const memBlock = sections[1];
            const diskLine = sections[2];

            if (!cpuLine || !memBlock || !diskLine) {
              console.log(`[Stats] Empty section for ${sessionId} - cpu:"${cpuLine}" mem:"${memBlock}" disk:"${diskLine}"`);
              return;
            }

            // CPU from /proc/stat
            const cpuData = parseCpuLine(cpuLine);
            let cpuPercent = 0;
            if (prevCpu) {
              const totalDelta = cpuData.total - prevCpu.total;
              const idleDelta = cpuData.idle - prevCpu.idle;
              cpuPercent = totalDelta > 0 ? Math.round(((totalDelta - idleDelta) / totalDelta) * 100) : 0;
            }
            prevCpu = cpuData;

            // RAM from /proc/meminfo (values in kB)
            const memLines = memBlock.split('\n');
            let memTotalKB = 0, memAvailKB = 0, memFreeKB = 0;
            for (const ml of memLines) {
              const match = ml.match(/^(\w+):\s+(\d+)/);
              if (!match) continue;
              if (match[1] === 'MemTotal') memTotalKB = parseInt(match[2], 10);
              else if (match[1] === 'MemAvailable') memAvailKB = parseInt(match[2], 10);
              else if (match[1] === 'MemFree') memFreeKB = parseInt(match[2], 10);
            }
            const ramTotal = Math.round(memTotalKB / 1024); // MB
            const availKB = memAvailKB > 0 ? memAvailKB : memFreeKB;
            const ramUsed = Math.round((memTotalKB - availKB) / 1024); // MB
            const ramPercent = ramTotal > 0 ? Math.round((ramUsed / ramTotal) * 100) : 0;

            // Disk from df -h /
            const diskParts = diskLine.trim().split(/\s+/);
            const diskPercent = parseInt(diskParts[4], 10) || 0;
            const diskUsed = diskParts[2] || '?';
            const diskTotal = diskParts[1] || '?';

            const stats = {
              sessionId,
              cpu: cpuPercent,
              ram: { used: ramUsed, total: ramTotal, percent: ramPercent },
              disk: { used: diskUsed, total: diskTotal, percent: diskPercent },
            };

            const io = sessionManager.getIO();
            if (io) {
              const currentState = sessionManager.getSession(sessionId);
              if (currentState && currentState.attachedSockets && currentState.attachedSockets.size > 0) {
                for (const socketId of currentState.attachedSockets) {
                  const sock = io.sockets.sockets.get(socketId);
                  if (sock) {
                    sock.emit('stats:update', stats);
                  }
                }
              }
            }
          } catch (e) {
            console.log(`[Stats] Parse error for ${sessionId}: ${e.message}`);
          }
        });

        stream.on('error', (err) => {
          console.log(`[Stats] stream error for ${sessionId}: ${err.message}`);
          clearTimeout(pollTimeout);
          pollInFlight = false;
        });
      });
    } catch (e) {
      console.log(`[Stats] exec threw for ${sessionId}: ${e.message}`);
      clearTimeout(pollTimeout);
      pollInFlight = false;
    }
  };

  // First poll after 500ms (give time for socket attachment)
  setTimeout(doPoll, 500);

  // Then poll every 2 seconds
  const interval = setInterval(doPoll, 2000);
  intervals.set(sessionId, interval);
}

function stopPolling(sessionId) {
  const interval = intervals.get(sessionId);
  if (interval) {
    clearInterval(interval);
    intervals.delete(sessionId);
    console.log(`[Stats] Polling stopped for session ${sessionId}`);
  }
}

module.exports = { startPolling, stopPolling };
