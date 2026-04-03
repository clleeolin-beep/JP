(function () {
  if (window.__JP_SITE_SYNC_HOTFIX__) return;
  window.__JP_SITE_SYNC_HOTFIX__ = true;

  var inFlightLog = false;
  var logQueue = [];
  var logTimer = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function getToken() {
    return (window.app && window.app.accessToken) || sessionStorage.getItem("gapi_access_token") || "";
  }

  function getSheetId() {
    try {
      return String(SHEET_ID || "").trim();
    } catch (_) {
      return "";
    }
  }

  function queueLog(level, message, extra) {
    var msg = String(message || "").slice(0, 800);
    var ext = String(extra || "").slice(0, 1800);
    logQueue.push({
      ts: nowIso(),
      level: level || "INFO",
      message: msg,
      href: String(location.href || "").slice(0, 500),
      extra: ext
    });
    if (!logTimer) logTimer = setTimeout(flushLogs, 1200);
  }

  async function ensureDebugSheet(token, sheetId) {
    var addUrl = "https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + ":batchUpdate";
    var body = {
      requests: [{ addSheet: { properties: { title: "DebugLogs" } } }]
    };
    await fetch(addUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  }

  async function appendRows(token, sheetId, rows) {
    var range = encodeURIComponent("DebugLogs!A1");
    var url = "https://sheets.googleapis.com/v4/spreadsheets/" + sheetId +
      "/values/" + range + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS";
    var payload = { values: rows };

    var res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) return true;
    var txt = await res.text();
    if (res.status === 400 && /Unable to parse range|not found/i.test(txt)) {
      await ensureDebugSheet(token, sheetId);
      var retry = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      return retry.ok;
    }
    return false;
  }

  async function flushLogs() {
    if (inFlightLog) return;
    logTimer = null;
    if (!logQueue.length) return;

    var token = getToken();
    var sheetId = getSheetId();
    if (!token || !sheetId) return;

    inFlightLog = true;
    try {
      var chunk = logQueue.splice(0, 20);
      var rows = chunk.map(function (item) {
        return [item.ts, item.level, item.message, item.href, item.extra];
      });
      await appendRows(token, sheetId, rows);
    } catch (_) {
    } finally {
      inFlightLog = false;
      if (logQueue.length) logTimer = setTimeout(flushLogs, 1200);
    }
  }

  function buildProxyList(targetUrl) {
    var url = String(targetUrl || "").trim();
    var normalizedForJina = url.replace(/^https?:\/\//i, "");
    return [
      { name: "jina-http", url: "https://r.jina.ai/http://" + normalizedForJina, isJson: false },
      { name: "jina-https", url: "https://r.jina.ai/http://https://" + normalizedForJina, isJson: false },
      { name: "codetabs", url: "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(url), isJson: false },
      { name: "corsproxy", url: "https://corsproxy.io/?" + encodeURIComponent(url), isJson: false },
      { name: "allorigins", url: "https://api.allorigins.win/get?url=" + encodeURIComponent(url), isJson: true }
    ];
  }

  function looksUsable(text) {
    var t = String(text || "");
    if (!t) return false;
    if (t.indexOf("<!DOCTYPE") !== -1 || t.indexOf("<html") !== -1 || t.indexOf("<body") !== -1) return true;
    if (t.length > 600 && /(girls-list|\/cast\/|schedule|No\.\s*\d+)/i.test(t)) return true;
    return false;
  }

  async function fetchWithTimeout(url, timeoutMs) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000);
    try {
      return await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    } finally {
      clearTimeout(timer);
    }
  }

  function installGlobalErrorBridge() {
    window.addEventListener("error", function (event) {
      var msg = event && event.message ? event.message : "window error";
      var src = event && event.filename ? event.filename + ":" + event.lineno : "";
      queueLog("ERROR", msg, src);
    });

    window.addEventListener("unhandledrejection", function (event) {
      var reason = event && event.reason;
      var detail = reason && reason.stack ? reason.stack : String(reason || "unhandled rejection");
      queueLog("REJECT", "Unhandled promise rejection", detail);
    });
  }

  function applyHotfix() {
    var proto = null;
    if (window.AppCore && window.AppCore.prototype) {
      proto = window.AppCore.prototype;
    } else if (window.app && window.app.constructor && window.app.constructor.prototype) {
      proto = window.app.constructor.prototype;
    }
    if (!proto) return false;

    if (!proto.__jpHotfixFetchPatched) {
      proto.fetchHtmlWithProxy = async function (targetUrl) {
        var proxies = buildProxyList(targetUrl);
        for (var i = 0; i < proxies.length; i += 1) {
          var proxy = proxies[i];
          try {
            var res = await fetchWithTimeout(proxy.url, 12000);
            if (!res.ok) throw new Error("HTTP error " + res.status);

            var html = "";
            if (proxy.isJson) {
              var data = await res.json();
              html = (data && data.contents) || "";
            } else {
              html = await res.text();
            }

            if (looksUsable(html)) {
              queueLog("INFO", "Proxy success: " + proxy.name, String(targetUrl || ""));
              return html;
            }
            throw new Error("proxy content unusable");
          } catch (err) {
            queueLog("WARN", "Proxy fail: " + proxy.name, (targetUrl || "") + " :: " + (err && err.message ? err.message : err));
            console.warn("[Proxy Failed] " + proxy.name + " " + proxy.url + " - " + (err && err.message ? err.message : err));
          }
        }

        queueLog("ERROR", "All proxy attempts failed", String(targetUrl || ""));
        throw new Error("All proxy attempts failed or timed out.");
      };
      proto.__jpHotfixFetchPatched = true;
    }

    if (!proto.__jpHotfixAuthPatched && typeof proto.initGoogleAuth === "function") {
      var origInit = proto.initGoogleAuth;
      proto.initGoogleAuth = function () {
        if (!window.google || !google.accounts || !google.accounts.oauth2) {
          var self = this;
          setTimeout(function () { self.initGoogleAuth(); }, 150);
          return;
        }
        return origInit.apply(this, arguments);
      };
      proto.__jpHotfixAuthPatched = true;
    }

    if (!proto.__jpHotfixSyncTracePatched && typeof proto.startAutoSync === "function") {
      var origSync = proto.startAutoSync;
      proto.startAutoSync = async function () {
        queueLog("INFO", "AutoSync start", "");
        try {
          var result = await origSync.apply(this, arguments);
          queueLog("INFO", "AutoSync finish", "");
          return result;
        } catch (err) {
          queueLog("ERROR", "AutoSync crash", err && err.stack ? err.stack : String(err || ""));
          throw err;
        }
      };
      proto.__jpHotfixSyncTracePatched = true;
    }

    if (!proto.__jpHotfixAfFilterPatched && typeof proto.getSelectedAfValues === "function") {
      var origGetSelectedAfValues = proto.getSelectedAfValues;
      proto.getSelectedAfValues = function () {
        var vals = origGetSelectedAfValues.apply(this, arguments) || [];
        try {
          var all = document.querySelectorAll("#af-checkboxes input[type='checkbox']");
          if (all && all.length && vals.length === all.length) return [];
        } catch (_) {
        }
        return vals;
      };
      proto.__jpHotfixAfFilterPatched = true;
    }

    if (!window.__jpHotfixFlushTicker) {
      window.__jpHotfixFlushTicker = setInterval(flushLogs, 1500);
    }

    return true;
  }

  installGlobalErrorBridge();

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    var done = applyHotfix();
    if (done || tries > 240) clearInterval(timer);
  }, 150);
})();
