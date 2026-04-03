(function () {
  if (window.__JP_SITE_SYNC_HOTFIX__) return;
  window.__JP_SITE_SYNC_HOTFIX__ = true;

  var inFlightLog = false;
  var logQueue = [];
  var logTimer = null;
  var proxyCooldownUntil = Object.create(null);

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
      { name: "codetabs", url: "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(url), isJson: false },
      { name: "corsproxy", url: "https://corsproxy.io/?" + encodeURIComponent(url), isJson: false },
      { name: "jina-http", url: "https://r.jina.ai/http://" + normalizedForJina, isJson: false }
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
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 7000);
    try {
      return await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    } finally {
      clearTimeout(timer);
    }
  }

  function getTargetHost(targetUrl) {
    try {
      return new URL(String(targetUrl || "")).host || "unknown-host";
    } catch (_) {
      return "unknown-host";
    }
  }

  function getCooldownKey(proxyName, targetUrl) {
    return String(proxyName || "") + "|" + getTargetHost(targetUrl);
  }

  function isCoolingDown(proxyName, targetUrl) {
    var key = getCooldownKey(proxyName, targetUrl);
    var until = proxyCooldownUntil[key] || 0;
    return until > Date.now();
  }

  function coolDown(proxyName, targetUrl, ms) {
    var key = getCooldownKey(proxyName, targetUrl);
    proxyCooldownUntil[key] = Date.now() + Math.max(15000, ms || 90000);
  }

  function installGlobalErrorBridge() {
    if (window.__jpWarnBridgeInstalled) return;
    window.__jpWarnBridgeInstalled = true;

    var origWarn = console.warn ? console.warn.bind(console) : null;
    var origError = console.error ? console.error.bind(console) : null;
    if (origWarn) {
      console.warn = function () {
        try {
          var msg = Array.prototype.slice.call(arguments).map(function (x) { return String(x); }).join(" ");
          queueLog("WARN", msg.slice(0, 800), "");
        } catch (_) {}
        return origWarn.apply(console, arguments);
      };
    }
    if (origError) {
      console.error = function () {
        try {
          var msg = Array.prototype.slice.call(arguments).map(function (x) { return String(x); }).join(" ");
          queueLog("ERROR", msg.slice(0, 800), "");
        } catch (_) {}
        return origError.apply(console, arguments);
      };
    }

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
          if (isCoolingDown(proxy.name, targetUrl)) {
            queueLog("INFO", "Proxy cooling down: " + proxy.name, String(targetUrl || ""));
            continue;
          }
          try {
            var res = await fetchWithTimeout(proxy.url, 7000);
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
            var errMsg = String(err && err.message ? err.message : err);
            if (/429|Too Many Requests/i.test(errMsg)) {
              coolDown(proxy.name, targetUrl, 120000);
              queueLog("WARN", "Proxy rate-limited: " + proxy.name, String(targetUrl || ""));
            }
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

    if (!proto.__jpHotfixToggleModePatched && typeof proto.toggleMode === "function") {
      var origToggleMode = proto.toggleMode;
      proto.toggleMode = function () {
        var selected = null;
        try {
          var all = Array.prototype.slice.call(
            document.querySelectorAll("#af-checkboxes input[type='checkbox']")
          );
          if (all.length) {
            var checked = all.filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
            if (checked.length && checked.length < all.length) selected = checked;
          }
        } catch (_) {}

        var out = origToggleMode.apply(this, arguments);

        if (selected && selected.length) {
          try {
            var now = Array.prototype.slice.call(
              document.querySelectorAll("#af-checkboxes input[type='checkbox']")
            );
            now.forEach(function (cb) { cb.checked = selected.indexOf(cb.value) !== -1; });
            if (typeof this.updateAfSelectBoxText === "function") this.updateAfSelectBoxText();
            if (typeof this.renderCatalog === "function") this.renderCatalog();
          } catch (_) {}
        }
        return out;
      };
      proto.__jpHotfixToggleModePatched = true;
    }

    if (!proto.__jpHotfixSyncDiagPatched) {
      if (typeof proto.normalizeSyncText !== "function") {
        proto.normalizeSyncText = function (value) {
          return String(value || "").toLowerCase().replace(/[\s"'`~!@#$%^&*()_\-+=\[\]{}|\\:;,.<>/?]+/g, "");
        };
      }

      if (typeof proto.diagnoseUnmatchedRecord !== "function") {
        proto.diagnoseUnmatchedRecord = function (record, siteCode) {
          var r = record || {};
          var out = {
            siteCode: siteCode || "unknown",
            name: String(r.name || "").trim(),
            store: String(r.store || "").trim(),
            url: String(r.url || "").trim(),
            reason: "not_in_database",
            detail: ""
          };
          if (!out.name) {
            out.reason = "invalid_record";
            out.detail = "name missing";
            return out;
          }
          var nName = this.normalizeSyncText((window.Utility && Utility.parseName ? Utility.parseName(out.name, window.ruleEngine).pureName : out.name) || out.name);
          var byName = (this.dataStore || []).filter(function (item) {
            var db = item && item._raw ? item._raw[this.colMap.name] : "";
            var parsed = (window.Utility && Utility.parseName ? Utility.parseName(db || "", window.ruleEngine).pureName : db);
            return this.normalizeSyncText(parsed) === nName;
          }.bind(this));
          if (byName.length) {
            var sameStore = byName.find(function (item) {
              return window.Utility && Utility.isSameStore && Utility.isSameStore((item._raw[this.colMap.store] || ""), out.store);
            }.bind(this));
            if (sameStore) {
              out.reason = out.url ? "url_or_key_mismatch" : "missing_profile_url";
              out.detail = out.url ? "name+store matched but url/key mismatch" : "name+store matched but url missing";
              return out;
            }
            out.reason = "store_mismatch";
            out.detail = "name matched but store mismatch";
            return out;
          }
          out.reason = out.url ? "name_not_found" : "name_not_found_and_no_url";
          out.detail = out.url ? "no name match in sheet" : "no name match and no url";
          return out;
        };
      }

      if (typeof proto.addSyncIssue !== "function") {
        proto.addSyncIssue = function (statsObj, siteCode, record, error) {
          if (!statsObj) return;
          if (!statsObj.issues) statsObj.issues = [];
          if (statsObj.issues.length >= 30) return;
          var item = this.diagnoseUnmatchedRecord(record, siteCode);
          if (error) item.error = String(error && error.message ? error.message : error).slice(0, 200);
          statsObj.issues.push(item);
        };
      }

      if (typeof proto.showSyncStatsModal === "function") {
        var origShowSyncStatsModal = proto.showSyncStatsModal;
        proto.showSyncStatsModal = function (stats) {
          var ret = origShowSyncStatsModal.apply(this, arguments);
          try {
            var lines = [];
            Object.keys(stats || {}).forEach(function (siteCode) {
              var val = stats[siteCode] || {};
              (val.issues || []).slice(0, 4).forEach(function (issue) {
                lines.push("[" + siteCode + "] " + issue.reason + " :: " + (issue.name || "unknown"));
              });
            });
            if (lines.length) console.warn("[AutoSync Diagnostics]\n" + lines.join("\n"));
          } catch (_) {}
          return ret;
        };
      }
      proto.__jpHotfixSyncDiagPatched = true;
    }

    if (!window.__jpHotfixFlushTicker) {
      window.__jpHotfixFlushTicker = setInterval(flushLogs, 1500);
    }

    if (!window.__jpYoasobiRatePatchApplied && window.SiteSyncRegistry && typeof window.SiteSyncRegistry.getHandler === "function") {
      var yoa = window.SiteSyncRegistry.getHandler("yoasobi-heaven");
      if (yoa && typeof yoa.syncAuto === "function") {
        yoa.DETAIL_FETCH_LIMIT_PER_SITE = 12;
        yoa.DETAIL_FETCH_DELAY_MS = 1200;
        yoa.DETAIL_FETCH_JITTER_MS = 350;
        yoa.DETAIL_ERROR_STREAK_LIMIT = 3;

        yoa.shouldFetchDetail = function () { return false; };

        var origSyncAuto = yoa.syncAuto.bind(yoa);
        yoa.syncAuto = async function (ctx) {
          var app = ctx && ctx.app;
          var rule = ctx && ctx.rule;
          var statsObj = ctx && ctx.statsObj;
          if (!app || !rule || !statsObj) return origSyncAuto(ctx);

          var html = await app.fetchHtmlWithProxy(rule.pattern);
          var extractedText = yoa.buildListText(html);
          var siteMatches = app.inferSiteMatches(extractedText, html, rule.pattern, rule.siteMatch);
          if (siteMatches.indexOf(rule.siteMatch) === -1) siteMatches.push(rule.siteMatch);

          var blocks = yoa.parseBlocks({ app: app, text: extractedText });
          var listRecords = [];
          var detailFetchCount = 0;
          var detailErrorStreak = 0;
          var detailDisabled = true;

          blocks.forEach(function (block) {
            var record = yoa.extractRecord({
              app: app,
              block: block,
              html: html,
              siteMatches: siteMatches
            });
            if (record && record.name) listRecords.push(record);
          });

          for (var i = 0; i < listRecords.length; i += 1) {
            if (!app.isSyncing) break;
            var record = listRecords[i];
            statsObj.total += 1;

            if (yoa.shouldFetchDetail(record) && !detailDisabled && detailFetchCount < yoa.DETAIL_FETCH_LIMIT_PER_SITE) {
              try {
                detailFetchCount += 1;
                var detailHtml = await app.fetchHtmlWithProxy(record.url);
                var detailText = yoa.buildPlainText(detailHtml);
                var detailMatches = app.inferSiteMatches(detailText, detailHtml, record.url, rule.siteMatch);
                if (detailMatches.indexOf(rule.siteMatch) === -1) detailMatches.push(rule.siteMatch);
                var detailRecord = app.extractRecordFromBlock(detailText, detailHtml, detailMatches, record.url);
                record = yoa.mergeRecords(record, detailRecord);
                detailErrorStreak = 0;
              } catch (error) {
                detailErrorStreak += 1;
                var msg = String(error && error.message ? error.message : error);
                console.warn("[Yoasobi Detail Sync] " + record.url + " - " + msg);
                if (/429|Too Many Requests|HTTP error 429/i.test(msg) || detailErrorStreak >= yoa.DETAIL_ERROR_STREAK_LIMIT) {
                  detailDisabled = true;
                  console.warn("[Yoasobi Detail Sync] Detail fetch disabled for this run.");
                }
              }

              var jitter = Math.floor(Math.random() * yoa.DETAIL_FETCH_JITTER_MS);
              await new Promise(function (resolve) {
                setTimeout(resolve, yoa.DETAIL_FETCH_DELAY_MS + jitter);
              });
            }

            var existingIndex = app.findRecordIndex(record);
            if (existingIndex !== -1) {
              app.applyRecordToRow(app.dataStore[existingIndex]._raw, record, false);
              statsObj.updated += 1;
            } else {
              statsObj.missing += 1;
              if (typeof app.addSyncIssue === "function") {
                app.addSyncIssue(statsObj, rule.siteMatch || yoa.id, record);
              }
            }
          }
        };
        window.__jpYoasobiRatePatchApplied = true;
        queueLog("INFO", "Yoasobi sync hotfix applied", "");
      }
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
