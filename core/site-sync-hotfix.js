(function () {
  if (window.__JP_SITE_SYNC_HOTFIX__) return;
  window.__JP_SITE_SYNC_HOTFIX__ = true;

  function buildProxyList(targetUrl) {
    var url = String(targetUrl || "").trim();
    var normalizedForJina = url.replace(/^https?:\/\//i, "");
    return [
      { name: "allorigins", url: "https://api.allorigins.win/get?url=" + encodeURIComponent(url), isJson: true },
      { name: "codetabs", url: "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(url), isJson: false },
      { name: "corsproxy", url: "https://corsproxy.io/?" + encodeURIComponent(url), isJson: false },
      { name: "jina-http", url: "https://r.jina.ai/http://" + normalizedForJina, isJson: false },
      { name: "jina-https", url: "https://r.jina.ai/http://https://" + normalizedForJina, isJson: false }
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

  function applyHotfix() {
    if (!window.AppCore || !window.AppCore.prototype) return false;
    var proto = window.AppCore.prototype;

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
            if (looksUsable(html)) return html;
            throw new Error("內容不可用");
          } catch (err) {
            console.warn("[Proxy Failed] " + proxy.name + " " + proxy.url + " - " + (err && err.message ? err.message : err));
          }
        }
        throw new Error("所有跨域代理均已失效、超時或被目標網站封鎖。");
      };
      proto.__jpHotfixFetchPatched = true;
    }

    if (!proto.__jpHotfixAuthPatched) {
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

    return true;
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    var ok = applyHotfix();
    if (ok || tries > 200) clearInterval(timer);
  }, 150);
})();

