/* Worq Dashboard — ws.js
   WebSocket live stats with SSE fallback + polling fallback.
   No frameworks. Theme is handled in base.html inline script. */
(function () {
  "use strict";

  var ws = null;
  var sse = null;
  var pollTimer = null;
  var wsFailCount = 0;

  function getBasePath() {
    var meta = document.querySelector("meta[name='worq-base-path']");
    return meta ? meta.getAttribute("content").replace(/\/$/, "") : "";
  }

  function getWsUrl() {
    var protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return protocol + "//" + location.host + getBasePath() + "/ws/stats";
  }

  function updateStats(data) {
    var totals = { queued: 0, active: 0, scheduled: 0, failed: 0, complete: 0 };
    if (data.queues) {
      data.queues.forEach(function (q) {
        totals.queued += q.queued || 0;
        totals.active += q.active || 0;
        totals.scheduled += q.scheduled || 0;
        totals.failed += q.failed || 0;
        totals.complete += q.complete || 0;
      });
    }
    var cards = document.querySelectorAll("[data-stat]");
    cards.forEach(function (el) {
      var key = el.getAttribute("data-stat");
      if (totals[key] !== undefined) {
        el.textContent = totals[key];
      }
    });
  }

  // Strategy 1: WebSocket
  function connectWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    try {
      ws = new WebSocket(getWsUrl());
    } catch (_) {
      fallbackToSse();
      return;
    }

    ws.onmessage = function (event) {
      try { updateStats(JSON.parse(event.data)); } catch (_) {}
      wsFailCount = 0;
    };

    ws.onclose = function () {
      ws = null;
      wsFailCount++;
      if (wsFailCount >= 3) { fallbackToSse(); }
      else { setTimeout(connectWs, 5000); }
    };

    ws.onerror = function () { if (ws) ws.close(); };
  }

  // Strategy 2: SSE
  function fallbackToSse() {
    if (sse) return;
    try {
      sse = new EventSource(getBasePath() + "/api/sse/stats");
    } catch (_) {
      fallbackToPolling();
      return;
    }

    sse.onmessage = function (event) {
      try { updateStats(JSON.parse(event.data)); } catch (_) {}
    };

    sse.onerror = function () {
      sse.close();
      sse = null;
      fallbackToPolling();
    };
  }

  // Strategy 3: Polling
  function fallbackToPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      fetch(getBasePath() + "/api/stats")
        .then(function (r) { return r.json(); })
        .then(function (resp) { if (resp.data) updateStats(resp.data); })
        .catch(function () {});
    }, 5000);
  }

  document.addEventListener("DOMContentLoaded", connectWs);
})();
