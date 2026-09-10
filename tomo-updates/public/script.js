// 117 — renders the "anon" design from data. Source of truth:
//   1. /api/works + /api/diary (D1-backed; edited from /admin, no deploys needed)
//   2. fallback: the `works` + `site` globals bundled in works.js

(function () {
  "use strict";

  var worksData = typeof works !== "undefined" ? works : [];
  var siteData = typeof site !== "undefined" ? site : {};

  var workView = document.getElementById("work-view");
  var detailView = document.getElementById("detail-view");
  var diaryView = document.getElementById("diary-view");
  var hero = document.getElementById("hero");

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // materials render as stacked lines; frame and note follow after a gap
  function matBlock(w) {
    var lines = String(w.materials || "").split(/\n+/).filter(Boolean).map(esc);
    var html = lines.join("<br>");
    if (w.frame) html += "<br><br>" + esc(w.frame);
    if (w.note) html += "<br><br>" + esc(w.note);
    return html;
  }

  function priceText(w) {
    if (w.priceMode === "sold") return "Sold";
    if (w.priceMode === "price" && w.price) return esc(w.price);
    return "Price on request";
  }

  function inquiryMail(w) {
    return "mailto:" + siteData.email + "?subject=" +
      encodeURIComponent((w ? w.title + " — " : "") + "117");
  }

  // ---------- work index ----------
  function renderIndex() {
    workView.innerHTML = worksData.map(function (w) {
      return (
        '<div class="row">' +
        '<div class="row-text">' +
        '<div class="row-title">' + esc(w.title) + "</div>" +
        '<div class="row-year">' + esc(w.year || "") + "</div>" +
        '<div class="row-mat">' + matBlock(w) + "</div>" +
        '<div class="row-dim">' + esc(w.size) + "</div>" +
        '<div class="row-price' + (w.priceMode === "sold" ? " sold" : "") + '">' + priceText(w) + "</div>" +
        "</div>" +
        '<div class="row-thumb" data-slug="' + esc(w.slug) + '">' +
        '<img src="' + esc(w.image) + '" alt="' + esc(w.title) + '" loading="lazy"></div>' +
        "</div>"
      );
    }).join("");
  }

  // ---------- diary (its own page, like a work's detail view) ----------
  function renderDiary(entries) {
    entries = entries || [];
    $("diaryEmpty").hidden = entries.length > 0;
    $("diaryGrid").innerHTML = entries.map(function (e) {
      var d = String(e.date || "").slice(0, 10).split("-").reverse().join(".");
      return (
        '<div class="diary-item"><img src="' + esc(e.image) + '" alt="" loading="lazy">' +
        (e.caption ? '<div class="diary-cap">' + esc(e.caption) + "</div>" : "") +
        (d ? '<div class="diary-date">' + d + "</div>" : "") +
        "</div>"
      );
    }).join("");
  }

  // ---------- view routing ----------
  // Views are driven by location.hash so the browser / phone back button
  // works: #work-slug → detail, #diary → diary, anything else → index.
  var currentView = "index";
  var savedScroll = 0;        // where the visitor was in the work list
  var internalPush = false;   // the current hash entry was pushed by a click here
  var pendingScrollTop = false;

  // the views swap in place, so the browser's own scroll restoration on
  // back/forward would fight the positions we restore ourselves
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  // view switches must jump, not animate — the page has scroll-behavior:smooth
  function jumpTo(y) {
    try { window.scrollTo({ top: y, left: 0, behavior: "instant" }); }
    catch (e) { window.scrollTo(0, y); }
  }

  function navigate(hash) {
    internalPush = true;
    location.hash = hash;     // fires hashchange → route()
  }

  function goBack(toTop) {
    pendingScrollTop = !!toTop;
    if (!location.hash || location.hash === "#") { route(); return; }
    if (internalPush) {
      internalPush = false;
      history.back();         // fires hashchange → route()
    } else {
      // deep link — there is no site entry behind us to go back to
      history.replaceState("", document.title, window.location.pathname + window.location.search);
      route();
    }
  }

  function route() {
    var h = location.hash;
    if (h.indexOf("#work-") === 0) showDetail(decodeURIComponent(h.slice(6)));
    else if (h === "#diary") showDiary();
    else showIndex();
  }

  function showDiary() {
    if (currentView === "index") savedScroll = window.scrollY;
    detailView.classList.remove("open");
    workView.classList.add("hidden");
    hero.style.display = "none";
    diaryView.classList.add("open");
    jumpTo(0);
    setNav("navDiary");
    currentView = "diary";
  }

  function setNav(activeId) {
    ["navWork", "navDiary"].forEach(function (id) {
      $(id).classList.toggle("active", id === activeId);
    });
  }

  // ---------- info section ----------
  function renderInfo() {
    var phone = $("infoPhone");
    phone.textContent = siteData.phoneDisplay || siteData.phone || "";
    phone.href = "tel:" + (siteData.phone || "");
    var email = $("infoEmail");
    email.textContent = siteData.email || "";
    email.href = "mailto:" + (siteData.email || "");
    var ig = $("infoInstagram");
    if (siteData.instagram) { ig.style.display = ""; ig.href = siteData.instagram; }
  }

  // ---------- detail view ----------
  function showDetail(slug) {
    var w = null;
    worksData.forEach(function (x) { if (x.slug === slug) w = x; });
    if (!w) { showIndex(); return; }
    if (currentView === "index") savedScroll = window.scrollY;

    // like the reference HTML, the detail page shows only the title —
    // year/materials/size/price all live on the work index rows
    $("dTitle").textContent = w.title;

    $("dHero").src = w.image;
    $("dHero").alt = w.title;

    // Process videos — only real clips; supports several per work
    var vwrap = $("dVideoWrap");
    var vids = (w.videos && w.videos.length) ? w.videos : (w.video ? [w.video] : []);
    if (vids.length) {
      vwrap.hidden = false;
      // no poster — the thumbnail is the video's own first frame
      // (#t=0.001 nudges iOS Safari to actually render it)
      vwrap.innerHTML =
        '<div class="d-section-label">Process</div>' +
        vids.map(function (src) {
          return '<div class="d-video"><video src="' + esc(src) +
            '#t=0.001" controls playsinline preload="metadata"></video></div>';
        }).join("");
    } else {
      vwrap.hidden = true;
      vwrap.innerHTML = "";
    }

    // Details — only real uploaded process photos; no decorative crops
    var dwrap = $("dDetailsWrap");
    var grid = $("dDetailsGrid");
    if (w.details && w.details.length) {
      dwrap.hidden = false;
      grid.innerHTML = w.details.map(function (src, i) {
        return '<div class="dcrop"><img src="' + esc(src) + '" alt="' +
          esc(w.title) + " detail " + (i + 1) + '" loading="lazy"></div>';
      }).join("");
    } else {
      dwrap.hidden = true;
      grid.innerHTML = "";
    }

    var ig = $("shareIG");
    if (siteData.instagram) { ig.style.display = ""; ig.href = siteData.instagram; }
    else { ig.style.display = "none"; }
    $("shareEmail").href = inquiryMail(w);

    diaryView.classList.remove("open");
    workView.classList.add("hidden");
    hero.style.display = "none";
    detailView.classList.add("open");
    jumpTo(0);
    setNav("navWork");
    currentView = "detail";
  }

  function showIndex() {
    var v = detailView.querySelector("video");
    if (v) v.pause();
    detailView.classList.remove("open");
    diaryView.classList.remove("open");
    workView.classList.remove("hidden");
    hero.style.display = "";
    setNav("navWork");
    if (pendingScrollTop) {
      jumpTo(0);
    } else if (currentView !== "index") {
      if (location.hash === "#info") {
        var info = document.getElementById("info");
        if (info) info.scrollIntoView();
      } else {
        jumpTo(savedScroll); // back where the visitor left the list
      }
    }
    pendingScrollTop = false;
    currentView = "index";
  }

  window.addEventListener("hashchange", route);

  // ---------- lightbox (full-screen photo) ----------
  // Opening pushes a same-URL history entry, so the phone's back button
  // closes the photo instead of leaving the page.
  var lightbox = $("lightbox");
  var lightboxImg = $("lightboxImg");
  var lbOpen = false;

  function openLightbox(src, alt) {
    lightboxImg.src = src;
    lightboxImg.alt = alt || "";
    lightbox.classList.add("open");
    document.body.style.overflow = "hidden";
    history.pushState({ lb: true }, "", location.href);
    lbOpen = true;
  }
  function closeLightbox(viaHistory) {
    if (!lbOpen) return;
    lbOpen = false;
    lightbox.classList.remove("open");
    document.body.style.overflow = "";
    lightboxImg.src = "";
    if (!viaHistory) history.back(); // consume the entry we pushed
  }
  window.addEventListener("popstate", function () { if (lbOpen) closeLightbox(true); });
  lightbox.addEventListener("click", function () { closeLightbox(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeLightbox(false);
  });
  function openLightboxFromGrid(e) {
    var img = e.target.closest("img");
    if (img) openLightbox(img.currentSrc || img.src, img.alt);
  }
  $("dDetailsGrid").addEventListener("click", openLightboxFromGrid);
  $("diaryGrid").addEventListener("click", openLightboxFromGrid);

  workView.addEventListener("click", function (e) {
    var t = e.target.closest("[data-slug]");
    if (t) navigate("work-" + t.getAttribute("data-slug"));
  });
  $("dBack").addEventListener("click", function (e) { e.preventDefault(); goBack(false); });
  $("dHome").addEventListener("click", function (e) { e.preventDefault(); goBack(true); });
  $("diaryBack").addEventListener("click", function (e) { e.preventDefault(); goBack(false); });
  $("logoLink").addEventListener("click", function (e) { e.preventDefault(); goBack(true); });
  $("navWork").addEventListener("click", function (e) { e.preventDefault(); goBack(true); });
  $("navDiary").addEventListener("click", function (e) { e.preventDefault(); navigate("diary"); });

  $("shareCopy").addEventListener("click", function (e) {
    e.preventDefault();
    if (navigator.clipboard) navigator.clipboard.writeText(window.location.href).catch(function () {});
    var el = this;
    el.textContent = "Copied";
    setTimeout(function () { el.textContent = "Copy link"; }, 1400);
  });

  // ---------- boot ----------
  async function boot() {
    try {
      var res = await fetch("/api/works");
      if (res.ok) {
        var data = await res.json();
        if (data && Array.isArray(data.works) && data.works.length) {
          worksData = data.works;
          siteData = Object.assign({}, siteData, data.site || {});
        }
      }
    } catch (e) { /* static preview / offline — bundled data stands */ }

    renderIndex();
    renderInfo();

    try {
      var dres = await fetch("/api/diary");
      if (dres.ok) {
        var ddata = await dres.json();
        renderDiary(ddata.entries);
      }
    } catch (e) { /* no diary yet */ }

    if (location.hash) route(); // deep links: #work-slug / #diary

    // count this visit (once per browser per day, server-deduped) — fire & forget
    try { fetch("/api/visit", { method: "POST" }); } catch (e) {}
  }
  boot();

  // ============================================================
  // GLITCH ENGINE v2 — 100 visual presets × 100 synth sounds
  // Visual modes: slice / vertical / blocks / wave / zoom /
  //               ghost / shred / invert — seeded, repeatable.
  // Sound families: voice, electric, animal, bubble, fire,
  //                 hazard, chaos, vintage, digital, idm.
  // ============================================================
  (function () {
    var wrap = document.getElementById("heroWrap");
    var text = document.getElementById("heroText");
    var canvas = document.getElementById("heroCanvas");
    if (!wrap || !text || !canvas) return;
    var ctx2d = canvas.getContext("2d");
    var buffer = document.createElement("canvas");
    var bctx = buffer.getContext("2d");

    var PALETTE = ["#0A0A0A", "#ffffff", "#39ff14", "#ff2a6d", "#05d9e8", "#f5d300", "#7d5fff", "#ff8b3d"];
    var COUNT = 100;

    function mulberry32(seed) {
      return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

    // ---------- 100 visual presets ----------
    var MODES = ["hslice", "vslice", "blocks", "wave", "zoom", "ghost", "shred", "invert"];
    var VISUAL = [];
    for (var i = 0; i < COUNT; i++) {
      var rng = mulberry32(i * 97 + 13);
      VISUAL.push({
        mode: pick(rng, MODES),
        dur: 220 + rng() * 850,
        slices: 3 + Math.floor(rng() * 38),
        maxOffset: 2 + rng() * 48,
        rgbSplit: rng() < 0.5 ? (2 + rng() * 16) : 0,
        noiseDensity: rng() < 0.5 ? rng() * 0.2 : 0,
        scanlines: rng() < 0.45,
        strobe: rng() < 0.35 ? (2 + Math.floor(rng() * 6)) : 0,
        tint: rng() < 0.4 ? pick(rng, PALETTE) : null,
        blocks: 5 + Math.floor(rng() * 20),
        waveAmp: 4 + rng() * 40,
        waveFreq: 0.5 + rng() * 3.5,
        waveSpeed: 1 + rng() * 4,
        zoomAmt: 0.02 + rng() * 0.18,
        ghosts: 2 + Math.floor(rng() * 4),
        ghostAlpha: 0.18 + rng() * 0.3
      });
    }

    // ---------- 100 sound presets ----------
    var FAMILIES = ["voice", "electric", "animal", "bubble", "fire", "hazard", "chaos", "vintage", "digital", "idm", "gothic", "adventure", "tense"];
    var SOUND = [];
    for (var j = 0; j < COUNT; j++) {
      var srng = mulberry32(j * 211 + 31);
      SOUND.push({
        family: FAMILIES[j % FAMILIES.length],
        seed: j * 211 + 31,
        dur: 0.35 + srng() * 0.9
      });
    }

    var audioCtx = null;
    function getCtx() {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    }

    var noiseBuf = null;
    function sharedNoise(ac) {
      if (!noiseBuf) {
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
      }
      return noiseBuf;
    }
    function tanhCurve(amount) {
      var n = 256, curve = new Float32Array(n);
      for (var k = 0; k < n; k++) {
        var x = k / n * 2 - 1;
        curve[k] = Math.tanh(x * (1 + amount * 8));
      }
      return curve;
    }
    function stepCurve(steps) {
      var n = 512, curve = new Float32Array(n);
      for (var k = 0; k < n; k++) {
        var x = k / n * 2 - 1;
        curve[k] = Math.round(x * steps) / steps;
      }
      return curve;
    }

    // tiny builders reused by every family
    function tone(ac, dest, o) {
      var osc = ac.createOscillator();
      osc.type = o.wave || "sine";
      osc.frequency.setValueAtTime(Math.max(20, o.f0), o.t);
      if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), o.t + o.dur);
      var g = ac.createGain();
      g.gain.setValueAtTime(0.0001, o.t);
      g.gain.linearRampToValueAtTime(o.gain != null ? o.gain : 0.5, o.t + (o.attack || 0.008));
      g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
      osc.connect(g); g.connect(dest);
      osc.start(o.t); osc.stop(o.t + o.dur + 0.03);
      return osc;
    }
    function noiseHit(ac, dest, t, dur, type, freq, q, gain) {
      var src = ac.createBufferSource();
      src.buffer = sharedNoise(ac);
      src.loop = true;
      var f = ac.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
      var g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(dest);
      src.start(t); src.stop(t + dur + 0.03);
    }
    function gateGain(ac, dest, t0, dur, hz, depth) {
      var g = ac.createGain();
      var seg = 1 / Math.max(1, hz);
      var n = Math.max(1, Math.floor(dur / seg));
      g.gain.setValueAtTime(0.0001, t0);
      for (var s = 0; s < n; s++) {
        var ts = t0 + s * seg;
        g.gain.linearRampToValueAtTime(1, ts + seg * 0.12);
        g.gain.linearRampToValueAtTime(depth != null ? depth : 0.03, ts + seg * 0.88);
      }
      g.connect(dest);
      return g;
    }

    // ---------- the ten families ----------
    var FAM = {

      // human-ish utterances: formant-filtered buzz gated into syllables
      voice: function (ac, out, t0, dur, rng) {
        var VOWELS = {
          a: [730, 1090, 2440], e: [530, 1840, 2480], i: [390, 1990, 2550],
          o: [570, 840, 2410], u: [440, 1020, 2240]
        };
        var keys = "aeiou";
        var v1 = VOWELS[keys[Math.floor(rng() * 5)]];
        var v2 = VOWELS[keys[Math.floor(rng() * 5)]];
        var f0 = 85 + rng() * 190;

        var src = ac.createOscillator();
        src.type = rng() < 0.5 ? "sawtooth" : "square";
        src.frequency.setValueAtTime(f0, t0);
        src.frequency.linearRampToValueAtTime(f0 * (0.75 + rng() * 0.6), t0 + dur);
        var vib = ac.createOscillator();
        vib.frequency.value = 4 + rng() * 4;
        var vibG = ac.createGain();
        vibG.gain.value = f0 * 0.05;
        vib.connect(vibG); vibG.connect(src.frequency);

        var syllables = 1 + Math.floor(rng() * 4);
        var gate = gateGain(ac, out, t0, dur, syllables / dur, 0.04);
        // formant bank
        var mouth = ac.createGain(); mouth.gain.value = 0.9;
        for (var b = 0; b < 3; b++) {
          var bp = ac.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.setValueAtTime(v1[b], t0);
          bp.frequency.linearRampToValueAtTime(v2[b], t0 + dur);
          bp.Q.value = 9;
          var bg = ac.createGain();
          bg.gain.value = b === 0 ? 0.9 : b === 1 ? 0.5 : 0.28;
          src.connect(bp); bp.connect(bg); bg.connect(mouth);
        }
        mouth.connect(gate);
        src.start(t0); src.stop(t0 + dur + 0.03);
        vib.start(t0); vib.stop(t0 + dur + 0.03);
        noiseHit(ac, out, t0, dur * 0.9, "bandpass", 1800 + rng() * 1600, 2, 0.05 + rng() * 0.05); // breath
      },

      // mains hum / zaps / arcing crackle
      electric: function (ac, out, t0, dur, rng) {
        var v = Math.floor(rng() * 3);
        if (v === 0) { // hum + flicker
          var hum = gateGain(ac, out, t0, dur, 6 + rng() * 7, 0.15);
          tone(ac, hum, { wave: "square", f0: rng() < 0.5 ? 50 : 60, dur: dur, t: t0, gain: 0.4 });
          tone(ac, hum, { wave: "sawtooth", f0: 100, dur: dur, t: t0, gain: 0.15 });
          noiseHit(ac, out, t0 + dur * rng() * 0.5, 0.05, "highpass", 6000, 1, 0.2);
        } else if (v === 1) { // zap(s)
          var zaps = 1 + Math.floor(rng() * 3);
          for (var z = 0; z < zaps; z++) {
            var tz = t0 + rng() * dur * 0.6;
            tone(ac, out, { wave: "sawtooth", f0: 2800 + rng() * 2400, f1: 60, dur: 0.1 + rng() * 0.15, t: tz, gain: 0.45 });
            noiseHit(ac, out, tz, 0.04, "highpass", 4000, 1, 0.3);
          }
        } else { // arcing: dense micro-crackle
          var nBursts = 30 + Math.floor(rng() * 40);
          for (var a = 0; a < nBursts; a++) {
            noiseHit(ac, out, t0 + rng() * dur, 0.006 + rng() * 0.014, "highpass", 3000 + rng() * 5000, 1, 0.18 + rng() * 0.12);
          }
          tone(ac, out, { wave: "square", f0: 50, dur: dur, t: t0, gain: 0.08 });
        }
      },

      // chirps / growl / howl / insect buzz
      animal: function (ac, out, t0, dur, rng) {
        var v = Math.floor(rng() * 4);
        if (v === 0) { // bird chirps
          var n = 3 + Math.floor(rng() * 5);
          for (var c = 0; c < n; c++) {
            var tc = t0 + (c / n) * dur * 0.9;
            var f = 1500 + rng() * 1800;
            tone(ac, out, { wave: "sine", f0: f, f1: f * (1.3 + rng() * 0.8), dur: 0.05 + rng() * 0.08, t: tc, gain: 0.4 });
          }
        } else if (v === 1) { // growl
          var am = gateGain(ac, out, t0, dur, 20 + rng() * 18, 0.35);
          var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 260;
          lp.connect(am);
          tone(ac, lp, { wave: "sawtooth", f0: 60 + rng() * 70, dur: dur, t: t0, gain: 0.7 });
          noiseHit(ac, am, t0, dur, "lowpass", 300, 1, 0.15);
        } else if (v === 2) { // howl
          var f0 = 320 + rng() * 320;
          var o = tone(ac, out, { wave: "sine", f0: f0, dur: dur, t: t0, gain: 0.45, attack: 0.08 });
          o.frequency.linearRampToValueAtTime(f0 * (1.5 + rng() * 0.5), t0 + dur * 0.4);
          o.frequency.linearRampToValueAtTime(f0 * 0.9, t0 + dur);
        } else { // insect buzz
          var am2 = gateGain(ac, out, t0, dur, 55 + rng() * 60, 0.1);
          tone(ac, am2, { wave: "square", f0: 140 + rng() * 260, dur: dur, t: t0, gain: 0.3 });
        }
      },

      // bloops rising in pitch over a soft underwater bed
      bubble: function (ac, out, t0, dur, rng) {
        noiseHit(ac, out, t0, dur, "lowpass", 240, 1, 0.12);
        var n = 4 + Math.floor(rng() * 6);
        for (var b = 0; b < n; b++) {
          var tb = t0 + rng() * dur * 0.85;
          var f = 130 + rng() * 320;
          tone(ac, out, { wave: "sine", f0: f, f1: f * (2 + rng() * 1.6), dur: 0.04 + rng() * 0.06, t: tb, gain: 0.5 });
        }
      },

      // rumble + crackle + pops
      fire: function (ac, out, t0, dur, rng) {
        noiseHit(ac, out, t0, dur, "lowpass", 140, 0.7, 0.3);
        var n = 25 + Math.floor(rng() * 45);
        for (var c = 0; c < n; c++) {
          noiseHit(ac, out, t0 + rng() * dur, 0.006 + rng() * 0.014, "highpass", 2500 + rng() * 4500, 1, 0.12 + rng() * 0.18);
        }
        var pops = 1 + Math.floor(rng() * 3);
        for (var p2 = 0; p2 < pops; p2++) {
          noiseHit(ac, out, t0 + rng() * dur, 0.03, "bandpass", 300 + rng() * 600, 6, 0.35);
        }
      },

      // tritone alarm + geiger clicks + pressure hiss
      hazard: function (ac, out, t0, dur, rng) {
        var f = 200 + rng() * 320;
        var hz = 3 + rng() * 4;
        var g1 = gateGain(ac, out, t0, dur, hz, 0.02);
        var g2 = gateGain(ac, out, t0 + (1 / hz) * 0.5, dur, hz, 0.02);
        tone(ac, g1, { wave: "square", f0: f, dur: dur, t: t0, gain: 0.3 });
        tone(ac, g2, { wave: "square", f0: f * 1.406, dur: dur, t: t0, gain: 0.3 });
        var clicks = 6 + Math.floor(rng() * 8);
        for (var c = 0; c < clicks; c++) {
          noiseHit(ac, out, t0 + rng() * dur, 0.005, "highpass", 6000, 1, 0.22);
        }
        noiseHit(ac, out, t0, dur, "highpass", 5000, 1, 0.05);
      },

      // inharmonic FM shards through a bit-crusher
      chaos: function (ac, out, t0, dur, rng) {
        var crush = ac.createWaveShaper();
        crush.curve = stepCurve(3 + Math.floor(rng() * 6));
        var cg = ac.createGain(); cg.gain.value = 0.5;
        crush.connect(cg); cg.connect(out);

        var car = ac.createOscillator();
        car.type = pick(rng, ["square", "sawtooth", "triangle"]);
        var seg = 0.04 + rng() * 0.05;
        for (var t = 0; t < dur; t += seg) {
          car.frequency.setValueAtTime(80 + rng() * 2800, t0 + t);
        }
        var mod = ac.createOscillator();
        mod.frequency.value = 200 + rng() * 700;
        var mg = ac.createGain();
        mg.gain.value = 300 + rng() * 1500;
        mod.connect(mg); mg.connect(car.frequency);

        var env = ac.createGain();
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(0.6, t0 + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        car.connect(env); env.connect(crush);
        car.start(t0); car.stop(t0 + dur + 0.03);
        mod.start(t0); mod.stop(t0 + dur + 0.03);
        for (var b = 0; b < 3; b++) {
          noiseHit(ac, out, t0 + rng() * dur, 0.02 + rng() * 0.05, "bandpass", 400 + rng() * 4000, 4, 0.2);
        }
      },

      // vinyl ticks, tape wobble, projector clatter, AM radio sweeps
      vintage: function (ac, out, t0, dur, rng) {
        var v = Math.floor(rng() * 3);
        if (v === 0) { // vinyl + warm wobble tone
          var ticks = 10 + Math.floor(rng() * 14);
          for (var c = 0; c < ticks; c++) {
            noiseHit(ac, out, t0 + rng() * dur, 0.004 + rng() * 0.01, "lowpass", 1400, 1, 0.12);
          }
          var f = 220 + rng() * 520;
          var o = tone(ac, out, { wave: "sine", f0: f, dur: dur, t: t0, gain: 0.28, attack: 0.05 });
          var lfo = ac.createOscillator();
          lfo.frequency.value = 0.6 + rng() * 1.4;
          var lg = ac.createGain(); lg.gain.value = 3 + rng() * 8;
          lfo.connect(lg); lg.connect(o.frequency);
          lfo.start(t0); lfo.stop(t0 + dur + 0.03);
        } else if (v === 1) { // projector clatter
          var hz = 12 + rng() * 7;
          var n = Math.floor(dur * hz);
          for (var k = 0; k < n; k++) {
            noiseHit(ac, out, t0 + k / hz, 0.008, "bandpass", 420, 4, 0.25);
          }
          tone(ac, out, { wave: "square", f0: 100, dur: dur, t: t0, gain: 0.06 });
        } else { // AM radio sweep
          var src = ac.createBufferSource();
          src.buffer = sharedNoise(ac); src.loop = true;
          var bp = ac.createBiquadFilter();
          bp.type = "bandpass"; bp.Q.value = 14;
          bp.frequency.setValueAtTime(350 + rng() * 300, t0);
          bp.frequency.exponentialRampToValueAtTime(2400 + rng() * 1600, t0 + dur);
          var g = ac.createGain();
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.linearRampToValueAtTime(0.4, t0 + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
          src.connect(bp); bp.connect(g); g.connect(out);
          src.start(t0); src.stop(t0 + dur + 0.03);
          if (rng() < 0.6) tone(ac, out, { wave: "sine", f0: 600 + rng() * 800, dur: 0.08, t: t0 + rng() * dur, gain: 0.2 });
        }
      },

      // modem screech, crushed stutters, quantized arps
      digital: function (ac, out, t0, dur, rng) {
        var v = Math.floor(rng() * 3);
        if (v === 0) { // modem handshake
          var seg = 0.03 + rng() * 0.04;
          var f1 = 1000 + rng() * 300, f2 = 1900 + rng() * 600;
          for (var t = 0; t < dur; t += seg) {
            tone(ac, out, { wave: "square", f0: (Math.floor(t / seg) % 2 ? f1 : f2), dur: seg * 0.9, t: t0 + t, gain: 0.25, attack: 0.003 });
          }
          noiseHit(ac, out, t0, dur, "highpass", 4000, 1, 0.04);
        } else if (v === 1) { // crushed stutter
          var crush = ac.createWaveShaper();
          crush.curve = stepCurve(4 + Math.floor(rng() * 8));
          var gate = gateGain(ac, crush, t0, dur, 9 + rng() * 17, 0.02);
          crush.connect(out);
          tone(ac, gate, { wave: "sawtooth", f0: 200 + rng() * 600, dur: dur, t: t0, gain: 0.45 });
        } else { // quantized arp
          var steps = 3 + Math.floor(rng() * 4);
          var base = 300 + rng() * 500;
          for (var s = 0; s < steps; s++) {
            tone(ac, out, {
              wave: pick(rng, ["square", "triangle"]),
              f0: base * Math.pow(1.5, Math.floor(rng() * 4)),
              dur: dur / steps * 0.85,
              t: t0 + (s * dur) / steps,
              gain: 0.3, attack: 0.004
            });
          }
        }
      },

      // the original IDM recipe, kept as one of the ten voices
      idm: function (ac, out, t0, dur, rng) {
        var crush = ac.createWaveShaper();
        crush.curve = tanhCurve(rng() < 0.6 ? 0.9 : 0.15);
        var gate = gateGain(ac, crush, t0, dur, (1 + Math.floor(rng() * 5)) / dur, 0.02);
        crush.connect(out);
        tone(ac, gate, {
          wave: pick(rng, ["square", "sawtooth", "sine", "triangle"]),
          f0: 60 + rng() * 1400, f1: 60 + rng() * 2600,
          dur: dur, t: t0, gain: 0.6
        });
        if (rng() < 0.7) {
          noiseHit(ac, out, t0, dur * 0.8, "highpass", 800 + rng() * 3000, 1, rng() * 0.25);
        }
      },

      // dark drone — two close, detuned low saws beating under a slow tremolo
      gothic: function (ac, out, t0, dur, rng) {
        var base = 55 + rng() * 35;
        var lp = ac.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = 500 + rng() * 400;
        var trem = gateGain(ac, out, t0, dur, 1.5 + rng() * 2.5, 0.35);
        lp.connect(trem);
        tone(ac, lp, { wave: "sawtooth", f0: base, dur: dur, t: t0, gain: 0.35, attack: 0.06 });
        tone(ac, lp, { wave: "sawtooth", f0: base * 1.015, dur: dur, t: t0, gain: 0.35, attack: 0.06 });
      },

      // bright, quick heroic arpeggio — major triad up to the octave
      adventure: function (ac, out, t0, dur, rng) {
        var rootF = 220 + rng() * 220;
        var ratios = [1, 1.25, 1.5, 2];
        var noteLen = dur / ratios.length;
        for (var n = 0; n < ratios.length; n++) {
          tone(ac, out, {
            wave: rng() < 0.5 ? "triangle" : "square",
            f0: rootF * ratios[n],
            dur: noteLen, t: t0 + n * noteLen * 0.85,
            gain: 0.4, attack: 0.02
          });
        }
      },

      // low pulsing stinger with a sharp noise hit at the end
      tense: function (ac, out, t0, dur, rng) {
        var pulses = 4 + Math.floor(rng() * 5);
        var g = gateGain(ac, out, t0, dur * 0.8, pulses / (dur * 0.8), 0.04);
        tone(ac, g, { wave: "sine", f0: 60 + rng() * 40, dur: dur * 0.8, t: t0, gain: 0.6 });
        noiseHit(ac, out, t0 + dur * 0.8, 0.14, "bandpass", 1200 + rng() * 2000, 3, 0.5);
      }
    };

    function playSound(idx) {
      var ac = getCtx();
      if (!ac) return;
      var p = SOUND[idx];
      var rng = mulberry32(p.seed);
      var now = ac.currentTime;
      var master = ac.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.linearRampToValueAtTime(0.85, now + 0.015);
      master.gain.linearRampToValueAtTime(0.0001, now + p.dur + 0.12);
      var soft = ac.createWaveShaper();
      soft.curve = tanhCurve(0.3); // gentle limiter so nothing clips
      master.connect(soft);
      soft.connect(ac.destination);
      try { FAM[p.family](ac, master, now, p.dur, rng); } catch (e) { /* keep the party going */ }
    }

    // ---------- canvas ----------
    // The canvas is PAD× larger than the glyph box so the distortion
    // spills past the letters instead of being boxed in.
    var PAD = 2.4;
    function sizeCanvas() {
      var rect = text.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var cw = rect.width * PAD, ch = rect.height * PAD;
      canvas.style.width = cw + "px";
      canvas.style.height = ch + "px";
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      buffer.width = canvas.width;
      buffer.height = canvas.height;

      var cs = getComputedStyle(text);
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.clearRect(0, 0, buffer.width, buffer.height);
      bctx.fillStyle = "#0A0A0A";
      bctx.font = cs.fontWeight + " " + (parseFloat(cs.fontSize) * dpr) + "px " + cs.fontFamily;
      bctx.textBaseline = "middle";
      bctx.textAlign = "center";
      bctx.fillText("117", buffer.width / 2, buffer.height / 2);
    }

    var lastIndex = -1;
    function nextIndex() {
      var idx;
      do { idx = Math.floor(Math.random() * COUNT); } while (idx === lastIndex);
      lastIndex = idx;
      return idx;
    }

    var running = false;
    function runGlitch(idx) {
      if (running) return;
      running = true;
      sizeCanvas();
      var v = VISUAL[idx];
      var w = canvas.width, h = canvas.height;
      var start = performance.now();
      wrap.classList.add("glitching");

      function drawTintedRegion(sx, sy, sw, sh, dx, dy, color) {
        ctx2d.save();
        ctx2d.globalCompositeOperation = "lighter";
        ctx2d.drawImage(buffer, sx, sy, sw, sh, dx, dy, sw, sh);
        ctx2d.globalCompositeOperation = "source-atop";
        ctx2d.fillStyle = color;
        ctx2d.fillRect(dx, dy, sw, sh);
        ctx2d.restore();
      }

      function frame(now) {
        var t = now - start;
        var prog = Math.min(1, t / v.dur);
        ctx2d.clearRect(0, 0, w, h);

        var skip = false;
        if (v.strobe) {
          var phase = Math.floor(prog * v.strobe * 2);
          if (phase % 2 === 1) skip = true;
        }

        if (!skip) {
          var s, sy, sx, sliceH, sliceW, jitter;

          if (v.mode === "hslice" || v.mode === "shred") {
            var nSl = v.mode === "shred" ? Math.max(40, Math.floor(h / (2 * (window.devicePixelRatio || 1)))) : v.slices;
            var off = v.mode === "shred" ? v.maxOffset * 1.6 : v.maxOffset;
            sliceH = h / nSl;
            for (s = 0; s < nSl; s++) {
              sy = s * sliceH;
              jitter = (Math.random() * 2 - 1) * off;
              sx = Math.random() < 0.65 ? jitter : 0;
              if (v.rgbSplit > 0 && v.mode === "hslice") {
                drawTintedRegion(0, sy, w, sliceH, sx - v.rgbSplit, sy, "#ff2a6d");
                drawTintedRegion(0, sy, w, sliceH, sx + v.rgbSplit, sy, "#05d9e8");
                drawTintedRegion(0, sy, w, sliceH, sx, sy, "#ffffff");
                ctx2d.globalCompositeOperation = "source-over";
              } else {
                ctx2d.drawImage(buffer, 0, sy, w, sliceH, sx, sy, w, sliceH);
              }
            }
          } else if (v.mode === "vslice") {
            sliceW = w / v.slices;
            for (s = 0; s < v.slices; s++) {
              var sxc = s * sliceW;
              jitter = (Math.random() * 2 - 1) * v.maxOffset;
              var dyv = Math.random() < 0.65 ? jitter : 0;
              ctx2d.drawImage(buffer, sxc, 0, sliceW, h, sxc, dyv, sliceW, h);
            }
          } else if (v.mode === "blocks") {
            ctx2d.drawImage(buffer, 0, 0);
            for (s = 0; s < v.blocks; s++) {
              var bw = w * (0.05 + Math.random() * 0.25);
              var bh = h * (0.06 + Math.random() * 0.3);
              var bx = Math.random() * (w - bw);
              var by = Math.random() * (h - bh);
              ctx2d.drawImage(buffer, bx, by, bw, bh,
                bx + (Math.random() * 2 - 1) * v.maxOffset,
                by + (Math.random() * 2 - 1) * v.maxOffset * 0.6, bw, bh);
            }
          } else if (v.mode === "wave") {
            var band = Math.max(2, Math.floor(h / 90));
            for (sy = 0; sy < h; sy += band) {
              var dx = Math.sin(prog * v.waveSpeed * Math.PI * 2 + (sy / h) * v.waveFreq * Math.PI * 2) * v.waveAmp;
              ctx2d.drawImage(buffer, 0, sy, w, band, dx, sy, w, band);
            }
          } else if (v.mode === "zoom") {
            var sc = 1 + (Math.random() * 2 - 1) * v.zoomAmt;
            var dw = w * sc, dh = h * sc;
            ctx2d.drawImage(buffer, (w - dw) / 2, (h - dh) / 2, dw, dh);
          } else if (v.mode === "ghost") {
            ctx2d.drawImage(buffer, 0, 0);
            for (s = 0; s < v.ghosts; s++) {
              ctx2d.globalAlpha = v.ghostAlpha;
              ctx2d.drawImage(buffer,
                (Math.random() * 2 - 1) * v.maxOffset,
                (Math.random() * 2 - 1) * v.maxOffset * 0.5);
            }
            ctx2d.globalAlpha = 1;
          } else if (v.mode === "invert") {
            ctx2d.drawImage(buffer,
              (Math.random() * 2 - 1) * v.maxOffset * 0.3,
              (Math.random() * 2 - 1) * v.maxOffset * 0.2);
            if (Math.floor(prog * 8) % 2 === 0) {
              ctx2d.save();
              ctx2d.globalCompositeOperation = "difference";
              ctx2d.fillStyle = "#ffffff";
              ctx2d.fillRect(0, 0, w, h);
              ctx2d.restore();
            }
          }

          // chroma fringe for modes that don't slice
          if (v.rgbSplit > 0 && v.mode !== "hslice") {
            drawTintedRegion(0, 0, w, h, -v.rgbSplit, 0, "#ff2a6d");
            drawTintedRegion(0, 0, w, h, v.rgbSplit, 0, "#05d9e8");
            ctx2d.globalCompositeOperation = "source-over";
          }
          if (v.tint) {
            ctx2d.save();
            ctx2d.globalCompositeOperation = "source-atop";
            ctx2d.fillStyle = v.tint;
            ctx2d.globalAlpha = 0.55;
            ctx2d.fillRect(0, 0, w, h);
            ctx2d.restore();
          }
          if (v.noiseDensity > 0) {
            var dots = Math.floor(w * h * 0.0006 * v.noiseDensity * 40);
            ctx2d.fillStyle = "#ffffff";
            for (var d = 0; d < dots; d++) {
              ctx2d.globalAlpha = 0.4 + Math.random() * 0.6;
              ctx2d.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
            }
            ctx2d.globalAlpha = 1;
          }
          if (v.scanlines) {
            ctx2d.fillStyle = "rgba(0,0,0,0.18)";
            for (var ly = 0; ly < h; ly += 3) { ctx2d.fillRect(0, ly, w, 1); }
          }
        }

        if (t < v.dur) {
          requestAnimationFrame(frame);
        } else {
          ctx2d.clearRect(0, 0, w, h);
          wrap.classList.remove("glitching");
          running = false;
        }
      }

      requestAnimationFrame(frame);
    }

    // Computerized speech — original lines only, spoken by the browser's
    // own text-to-speech voice. Occasional, not every trigger.
    // Grouped into named styles, each with its own voice signature, so the
    // spoken lines feel like different characters rather than one randomized voice.
    var SPEECH_STYLES = [
      { // oracle — slow, low, ominous
        rate: [0.62, 0.72], pitch: [0.25, 0.5], volume: 0.85,
        lines: [
          "The night remembers what the day forgets.",
          "Some doors should stay closed after dark.",
          "Even shadows need somewhere to rest.",
          "Not everything broken wants to be fixed.",
          "The city keeps its own secrets.",
          "It only looks like chaos from the outside."
        ]
      },
      { // urgent — fast, tense, higher pitch
        rate: [1.15, 1.4], pitch: [1.1, 1.5], volume: 0.9,
        lines: [
          "Stay sharp. It is not over yet.",
          "One wrong move changes everything.",
          "Keep your eyes open and your grip steady.",
          "Move. Now. Do not look back.",
          "There is no time left to decide.",
          "Something is already watching."
        ]
      },
      { // whisper — quiet, close, unsettling
        rate: [0.75, 0.9], pitch: [0.6, 0.85], volume: 0.4,
        lines: [
          "Some things are found, not made.",
          "I have been here longer than you think.",
          "Do not tell them what you saw.",
          "It is still following the pattern.",
          "One seventeen. Remember the number."
        ]
      },
      { // robotic — flat, mechanical, monotone
        rate: [0.95, 1.05], pitch: [0.95, 1.05], volume: 0.85,
        lines: [
          "Signal received. Processing.",
          "Fortune favors the stubborn.",
          "Every good story needs one more twist.",
          "The bravest step is always the next one.",
          "System stable. Continue.",
          "Data does not lie. People do."
        ]
      },
      { // vintage radio — warm, mid pitch, slightly slow, like an old broadcast
        rate: [0.8, 0.95], pitch: [0.7, 0.95], volume: 0.75,
        lines: [
          "This has been transmitted before.",
          "We interrupt this silence with a warning.",
          "The frequency is almost clear tonight.",
          "Somewhere, someone is still listening.",
          "The signal repeats. It always repeats."
        ]
      }
    ];
    function speakLine() {
      if (!window.speechSynthesis) return;
      try {
        var style = SPEECH_STYLES[Math.floor(Math.random() * SPEECH_STYLES.length)];
        var line = style.lines[Math.floor(Math.random() * style.lines.length)];
        var u = new SpeechSynthesisUtterance(line);
        u.rate = style.rate[0] + Math.random() * (style.rate[1] - style.rate[0]);
        u.pitch = style.pitch[0] + Math.random() * (style.pitch[1] - style.pitch[0]);
        u.volume = style.volume;
        window.speechSynthesis.speak(u);
      } catch (e) { /* no voice, no problem */ }
    }

    function trigger() {
      var idx = nextIndex();
      runGlitch(idx);
      playSound(idx);
      if (Math.random() < 0.22) speakLine();
      if (navigator.vibrate) {
        try { navigator.vibrate([20, 15, 35, 10, 25]); } catch (e) {}
      }
    }

    window.addEventListener("resize", function () { if (!running) sizeCanvas(); });
    wrap.addEventListener("mouseenter", trigger);
    wrap.addEventListener("touchstart", function () { trigger(); }, { passive: true });
    window.addEventListener("load", function () { setTimeout(trigger, 30); });

    // idle breathing (grow/shrink) — happens often. Wandering (position
    // drift) is rare, about 1 in 20 times; no tilting/rotation.
    (function idleDrift() {
      function playBreath() {
        var ac = getCtx();
        if (!ac) return;
        var now = ac.currentTime;
        var f = 300 + Math.random() * 500;
        tone(ac, ac.destination, {
          wave: "sine", f0: f, f1: f * (0.8 + Math.random() * 0.5),
          dur: 0.4, t: now, gain: 0.12, attack: 0.03
        });
      }
      function next() {
        var scale = 0.75 + Math.random() * 1.15;
        if (Math.random() < 0.15) scale = 1.8 + Math.random() * 0.6;

        var tx = 0, ty = 0;
        if (Math.random() < 0.05) {
          var maxX = Math.min(60, window.innerWidth * 0.12);
          tx = (Math.random() * 2 - 1) * maxX;
          ty = (Math.random() * 2 - 1) * 40;
        }
        wrap.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale.toFixed(2) + ")";
        if (Math.random() < 0.4) { try { playBreath(); } catch (e) {} }
        setTimeout(next, 1800 + Math.random() * 3200);
      }
      setTimeout(next, 1200);
    })();

    // debug/testing hook
    window.__glitch = { visuals: VISUAL.length, sounds: SOUND.length, playSound: playSound, runGlitch: runGlitch, speakLine: speakLine };
  })();
})();

// ---------- 80s digital bird ----------
// A tiny pixel-art bird glitches across the screen every ~2 minutes,
// fixed to the viewport so it appears no matter which view is open
// (index, work detail, or diary).
(function () {
  var SVG_NS = "http://www.w3.org/2000/svg";

  function buildBird() {
    var wrap = document.createElement("div");
    wrap.className = "pixel-bird";
    // 11×7 pixel grid, two wing frames, chunky retro blocks
    var frames = [
      // wings up
      [
        "...##.....",
        "..####....",
        ".##########",
        "###########",
        ".####..##..",
        "..##.......",
        "...........",
      ],
      // wings down
      [
        "...........",
        "..##.......",
        ".####..##..",
        "###########",
        ".##########",
        "..####.....",
        "...##......",
      ]
    ];
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 11 7");
    svg.setAttribute("class", "pixel-bird-svg");
    wrap.appendChild(svg);

    function paint(frameIdx) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      var rows = frames[frameIdx];
      for (var y = 0; y < rows.length; y++) {
        for (var x = 0; x < rows[y].length; x++) {
          if (rows[y][x] === "#") {
            var r = document.createElementNS(SVG_NS, "rect");
            r.setAttribute("x", x);
            r.setAttribute("y", y);
            r.setAttribute("width", 1);
            r.setAttribute("height", 1);
            svg.appendChild(r);
          }
        }
      }
    }
    paint(0);
    return { el: wrap, paint: paint };
  }

  function flyBirdAcross() {
    var bird = buildBird();
    var wrap = bird.el;
    document.body.appendChild(wrap);

    var goingRight = Math.random() < 0.5;
    var topPct = 8 + Math.random() * 55; // stay in the upper ~2/3 of the screen
    var duration = 5200 + Math.random() * 2600;

    wrap.style.top = topPct + "%";
    wrap.style.setProperty("--fly-duration", duration + "ms");
    wrap.classList.add(goingRight ? "fly-right" : "fly-left");

    // wing flap
    var frame = 0;
    var flapTimer = setInterval(function () {
      frame = 1 - frame;
      bird.paint(frame);
    }, 140);

    // a few brief glitch flickers mid-flight, matching the site's glitch language
    var glitchCount = 2 + Math.floor(Math.random() * 3);
    for (var i = 0; i < glitchCount; i++) {
      setTimeout(function () {
        wrap.classList.add("bird-glitch");
        setTimeout(function () { wrap.classList.remove("bird-glitch"); }, 90 + Math.random() * 90);
      }, 400 + Math.random() * (duration - 800));
    }

    setTimeout(function () {
      clearInterval(flapTimer);
      wrap.remove();
    }, duration + 100);
  }

  function scheduleBird() {
    setTimeout(function () {
      try { flyBirdAcross(); } catch (e) {}
      scheduleBird();
    }, 120000); // every 2 minutes
  }
  scheduleBird();
})();
