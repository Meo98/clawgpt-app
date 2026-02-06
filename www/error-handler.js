// ClawGPT - ChatGPT-like interface for OpenClaw
// https://github.com/openclaw/openclaw

// Global error handler with visual debugging + Copy Logs button
window._clawgptErrors = [];
window._clawgptLogs = [];

// Log collector - captures all console output
(function() {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const maxLogs = 200;

  function addLog(level, args) {
    const msg = `[${level}] ${Array.from(args).map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
      catch { return String(a); }
    }).join(' ')}`;
    window._clawgptLogs.push(msg);
    if (window._clawgptLogs.length > maxLogs) window._clawgptLogs.shift();
  }

  console.log = function(...args) { addLog('LOG', args); origLog.apply(console, args); };
  console.warn = function(...args) { addLog('WARN', args); origWarn.apply(console, args); };
  console.error = function(...args) { addLog('ERROR', args); origError.apply(console, args); };
})();

// Show error banner with Copy Logs button
function showErrorBanner(errMsg, isWarning) {
  if (!document.body) return;

  // Remove existing error banners (keep only one at a time)
  document.querySelectorAll('.clawgpt-error-banner').forEach(el => el.remove());

  const banner = document.createElement('div');
  banner.className = 'clawgpt-error-banner';
  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
    background: ${isWarning ? '#e67e22' : '#e74c3c'}; color: white;
    padding: 12px 15px; font-size: 13px; font-family: system-ui, sans-serif;
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  `;

  const msgSpan = document.createElement('span');
  msgSpan.style.cssText = 'flex: 1; min-width: 200px; word-break: break-word;';
  msgSpan.textContent = errMsg;

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy Logs';
  copyBtn.style.cssText = `
    background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.4);
    color: white; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;
  `;
  copyBtn.onclick = function() {
    const fullLog = [
      '=== ClawGPT Error Log ===',
      'Time: ' + new Date().toISOString(),
      'UserAgent: ' + navigator.userAgent,
      '',
      '=== Errors ===',
      ...window._clawgptErrors,
      '',
      '=== Recent Logs ===',
      ...window._clawgptLogs.slice(-50)
    ].join('\n');

    navigator.clipboard.writeText(fullLog).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => copyBtn.textContent = 'Copy Logs', 2000);
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = fullLog;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => copyBtn.textContent = 'Copy Logs', 2000);
    });
  };

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = `
    background: none; border: none; color: white; font-size: 20px;
    cursor: pointer; padding: 0 5px; line-height: 1;
  `;
  closeBtn.onclick = () => banner.remove();

  banner.appendChild(msgSpan);
  banner.appendChild(copyBtn);
  banner.appendChild(closeBtn);
  document.body.appendChild(banner);
}

window.onerror = function(message, source, lineno, colno, error) {
  const errMsg = `ERROR: ${message} at ${source}:${lineno}:${colno}`;
  console.error('ClawGPT Error:', errMsg, error);
  window._clawgptErrors.push(errMsg);
  showErrorBanner(errMsg, false);
  return false;
};

window.addEventListener('unhandledrejection', function(event) {
  const errMsg = `PROMISE REJECT: ${event.reason}`;
  console.error('ClawGPT Unhandled Promise Rejection:', event.reason);
  window._clawgptErrors.push(errMsg);
  showErrorBanner(errMsg, true);
});

