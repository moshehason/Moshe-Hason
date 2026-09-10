// 117 Editor — vanilla JS, mobile-first.
// Talks to /api/admin/*; photos are converted to JPEG on-device before upload
// (handles iPhone HEIC), videos upload as-is.

(function () {
  "use strict";

  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");

  var state = {
    works: [],
    site: null,
    editingId: null, // work id being edited, "settings" for site settings
  };
  var reorderTimer = null;

  // --- utilities -------------------------------------------------------------
  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Media paths in the DB may be root-relative ("assets/x.jpg"); the admin
  // lives at /admin/ so resolve them against the site root.
  function mediaUrl(p) {
    if (!p) return "";
    return /^(https?:)?\//.test(p) ? p : "/" + p;
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("err", !!isErr);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, isErr ? 3500 : 1600);
  }

  async function api(path, opts) {
    opts = opts || {};
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers);
      opts.body = JSON.stringify(opts.body);
    }
    var res = await fetch("/api/admin" + path, opts);
    if (res.status === 401) {
      renderLogin();
      throw new Error("Not logged in");
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
  }

  function findWork(id) {
    return state.works.find(function (w) { return w.id === id; });
  }

  // Convert any photo (incl. iPhone HEIC) to a lean JPEG on-device.
  function toJpeg(file, maxDim, quality) {
    maxDim = maxDim || 3200; // keeps pinch-zoom sharp on 3x phone screens
    quality = quality || 0.85;
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name || "")) {
        return resolve(file); // not an image — pass through
      }
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var s = Math.min(1, maxDim / Math.max(w, h));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(w * s));
          canvas.height = Math.max(1, Math.round(h * s));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          canvas.toBlob(function (blob) {
            if (blob && blob.size) {
              resolve(new File([blob], "photo.jpg", { type: "image/jpeg" }));
            } else {
              resolve(file);
            }
          }, "image/jpeg", quality);
        } catch (e) {
          URL.revokeObjectURL(url);
          resolve(file);
        }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  // XHR instead of fetch so big (video) uploads can report progress
  function uploadFile(file, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/upload");
      xhr.upload.onprogress = function (e) {
        if (onProgress && e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = function () {
        var data = {};
        try { data = JSON.parse(xhr.responseText); } catch (e) {}
        if (xhr.status === 401) { renderLogin(); return reject(new Error("Not logged in")); }
        if (xhr.status < 200 || xhr.status >= 300) {
          return reject(new Error(data.error || "Upload failed (" + xhr.status + ")"));
        }
        resolve(data.path);
      };
      xhr.onerror = function () { reject(new Error("Upload failed — check the connection")); };
      var fd = new FormData();
      fd.append("file", file);
      xhr.send(fd);
    });
  }

  // Exact-content hash, used to auto-skip duplicate photos in a batch.
  async function fileHash(file) {
    var buf = await file.arrayBuffer();
    var digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.prototype.map.call(new Uint8Array(digest), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  // Ask for a file via a throwaway input (iOS shows Library / Camera).
  // Must be attached to the DOM before .click() — iOS Safari silently drops
  // multi-select (and can be flaky generally) on detached inputs.
  function pickFile(accept) {
    return new Promise(function (resolve) {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.style.position = "fixed";
      input.style.top = "-1000px";
      input.onchange = function () {
        resolve(input.files[0] || null);
        input.remove();
      };
      document.body.appendChild(input);
      input.click();
    });
  }

  // Same, but lets the user pick several at once → array (may be empty).
  function pickFiles(accept) {
    return new Promise(function (resolve) {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.multiple = true;
      input.style.position = "fixed";
      input.style.top = "-1000px";
      input.onchange = function () {
        resolve(Array.prototype.slice.call(input.files));
        input.remove();
      };
      document.body.appendChild(input);
      input.click();
    });
  }

  // A work's videos as an array (older works kept a single `video`).
  function workVideos(w) {
    return (w.videos && w.videos.length) ? w.videos : (w.video ? [w.video] : []);
  }

  // ---- zoom & frame before upload -----------------------------------------
  // Full-screen cropper: pinch/slider to zoom, drag to position, drag corners
  // to frame. Resolves with the framed region as a JPEG File (≤3200px),
  // null if cancelled, or the original file if the image can't be decoded.
  function openCropper(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name || "")) {
        return resolve(file);
      }
      var url = URL.createObjectURL(file);
      var probe = new Image();
      probe.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      probe.onload = function () { build(probe); };
      probe.src = url;

      function build(img) {
        var natW = img.naturalWidth, natH = img.naturalHeight;
        var modal = document.createElement("div");
        modal.className = "cropper";
        modal.innerHTML =
          '<div class="cr-stage" id="crStage">' +
          '<img class="cr-img" id="crImg" alt="" draggable="false" />' +
          '<div class="cr-rect" id="crRect">' +
          '<span class="cr-h" data-c="nw"></span><span class="cr-h" data-c="ne"></span>' +
          '<span class="cr-h" data-c="sw"></span><span class="cr-h" data-c="se"></span>' +
          "</div></div>" +
          '<div class="cr-bar">' +
          '<div class="cr-hint">Pinch or slide to zoom · drag the photo to position · drag corners to frame</div>' +
          '<input type="range" id="crZoom" min="100" max="800" value="100" aria-label="Zoom" />' +
          '<div class="cr-actions">' +
          '<button class="btn ghost cr-cancel" type="button">Cancel</button>' +
          '<button class="btn rust cr-use" type="button">Use photo</button>' +
          "</div></div>";
        document.body.appendChild(modal);
        var prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        var stage = modal.querySelector("#crStage");
        var imgEl = modal.querySelector("#crImg");
        var rectEl = modal.querySelector("#crRect");
        var zoomEl = modal.querySelector("#crZoom");
        imgEl.src = url;

        var sw = stage.clientWidth, sh = stage.clientHeight;
        var fit = Math.min(sw / natW, sh / natH);
        var dispW = natW * fit, dispH = natH * fit;
        var MIN_S = 1, MAX_S = 8, MIN_RECT = 56;
        var s = 1;
        var tx = (sw - dispW) / 2, ty = (sh - dispH) / 2;
        var rect = { x: tx, y: ty, w: dispW, h: dispH };

        imgEl.style.width = dispW + "px";

        function apply() {
          imgEl.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + s + ")";
          rectEl.style.left = rect.x + "px";
          rectEl.style.top = rect.y + "px";
          rectEl.style.width = rect.w + "px";
          rectEl.style.height = rect.h + "px";
        }
        apply();

        // zoom keeping the stage point `cx,cy` over the same image point
        function zoomTo(next, cx, cy) {
          next = Math.min(MAX_S, Math.max(MIN_S, next));
          tx = cx - (cx - tx) * (next / s);
          ty = cy - (cy - ty) * (next / s);
          s = next;
          zoomEl.value = Math.round(Math.min(800, s * 100));
          apply();
        }

        zoomEl.addEventListener("input", function () {
          zoomTo(Number(zoomEl.value) / 100, rect.x + rect.w / 2, rect.y + rect.h / 2);
        });
        stage.addEventListener("wheel", function (e) {
          e.preventDefault();
          zoomTo(s * Math.exp(-e.deltaY * 0.002), e.offsetX, e.offsetY);
        }, { passive: false });

        // pointers: 1 = pan photo (or resize via handle), 2 = pinch zoom
        var pointers = new Map();
        var mode = null; // "pan" | "pinch" | corner name
        var start = null;

        function pinchState() {
          var pts = Array.from(pointers.values());
          var dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
          return {
            dist: Math.hypot(dx, dy) || 1,
            mx: (pts[0].x + pts[1].x) / 2,
            my: (pts[0].y + pts[1].y) / 2,
          };
        }

        stage.addEventListener("pointerdown", function (e) {
          e.preventDefault();
          try { stage.setPointerCapture(e.pointerId); } catch (err) {}
          var pos = { x: e.clientX - stage.getBoundingClientRect().left, y: e.clientY - stage.getBoundingClientRect().top };
          pointers.set(e.pointerId, pos);
          if (pointers.size === 2) {
            var p = pinchState();
            mode = "pinch";
            start = { s: s, tx: tx, ty: ty, dist: p.dist, mx: p.mx, my: p.my };
          } else if (e.target.classList.contains("cr-h")) {
            mode = e.target.dataset.c;
            start = { rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, x: pos.x, y: pos.y };
          } else {
            mode = "pan";
            start = { tx: tx, ty: ty, x: pos.x, y: pos.y };
          }
        });

        stage.addEventListener("pointermove", function (e) {
          if (!pointers.has(e.pointerId)) return;
          var box = stage.getBoundingClientRect();
          pointers.set(e.pointerId, { x: e.clientX - box.left, y: e.clientY - box.top });

          if (mode === "pinch" && pointers.size >= 2) {
            var p = pinchState();
            var next = Math.min(MAX_S, Math.max(MIN_S, start.s * (p.dist / start.dist)));
            tx = p.mx - (start.mx - start.tx) * (next / start.s);
            ty = p.my - (start.my - start.ty) * (next / start.s);
            s = next;
            zoomEl.value = Math.round(Math.min(800, s * 100));
            apply();
          } else if (mode === "pan" && pointers.size === 1) {
            var pt = pointers.get(e.pointerId);
            tx = start.tx + (pt.x - start.x);
            ty = start.ty + (pt.y - start.y);
            apply();
          } else if (mode && mode !== "pan" && mode !== "pinch" && pointers.size === 1) {
            var pt2 = pointers.get(e.pointerId);
            var dx = pt2.x - start.x, dy = pt2.y - start.y;
            var r0 = start.rect;
            var x1 = r0.x, y1 = r0.y, x2 = r0.x + r0.w, y2 = r0.y + r0.h;
            if (mode.indexOf("w") > -1) x1 = Math.min(x2 - MIN_RECT, Math.max(0, r0.x + dx));
            if (mode.indexOf("e") > -1) x2 = Math.max(x1 + MIN_RECT, Math.min(sw, r0.x + r0.w + dx));
            if (mode.indexOf("n") > -1) y1 = Math.min(y2 - MIN_RECT, Math.max(0, r0.y + dy));
            if (mode.indexOf("s") > -1) y2 = Math.max(y1 + MIN_RECT, Math.min(sh, r0.y + r0.h + dy));
            rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
            apply();
          }
        });

        function drop(e) {
          pointers.delete(e.pointerId);
          if (pointers.size < 2 && mode === "pinch") mode = null;
          if (pointers.size === 0) mode = null;
        }
        stage.addEventListener("pointerup", drop);
        stage.addEventListener("pointercancel", drop);

        function cleanup() {
          URL.revokeObjectURL(url);
          document.body.style.overflow = prevOverflow;
          modal.remove();
        }

        modal.querySelector(".cr-cancel").addEventListener("click", function () {
          cleanup();
          resolve(null);
        });

        modal.querySelector(".cr-use").addEventListener("click", function () {
          // stage coords -> natural pixels: css px at zoom s cover 1/(fit*s) natural px
          var k = 1 / (fit * s);
          var rx = (rect.x - tx) * k, ry = (rect.y - ty) * k;
          var rw = rect.w * k, rh = rect.h * k;
          // clamp to the image
          var cx1 = Math.max(0, rx), cy1 = Math.max(0, ry);
          var cx2 = Math.min(natW, rx + rw), cy2 = Math.min(natH, ry + rh);
          rw = cx2 - cx1; rh = cy2 - cy1;
          if (rw < 8 || rh < 8) { toast("Frame the photo first", true); return; }
          var scale = Math.min(1, 3200 / Math.max(rw, rh));
          var canvas = document.createElement("canvas");
          canvas.width = Math.round(rw * scale);
          canvas.height = Math.round(rh * scale);
          canvas.getContext("2d").drawImage(img, cx1, cy1, rw, rh, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) {
            cleanup();
            if (blob && blob.size) {
              resolve(new File([blob], "photo.jpg", { type: "image/jpeg" }));
            } else {
              resolve(file);
            }
          }, "image/jpeg", 0.85);
        });
      }
    });
  }
  window.__openCropper = openCropper; // testing hook

  // --- login -------------------------------------------------------------
  function renderLogin(err) {
    state.editingId = null;
    app.innerHTML =
      '<div class="login">' +
      '<div class="big">117</div>' +
      "<p>Editor — enter the password to manage the site.</p>" +
      '<input id="pw" type="password" autocomplete="current-password" placeholder="Password" />' +
      '<p class="err">' + esc(err || "") + "</p>" +
      '<button class="btn rust" id="loginBtn">Log in</button>' +
      "</div>";

    var pw = document.getElementById("pw");
    var go = async function () {
      try {
        document.getElementById("loginBtn").disabled = true;
        await api("/login", { method: "POST", body: { password: pw.value } });
        await loadAll();
      } catch (e) {
        renderLogin(e.message);
      }
    };
    document.getElementById("loginBtn").addEventListener("click", go);
    pw.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    pw.focus();
  }

  // --- top bar -----------------------------------------------------------
  function bar(backTarget, actionsHtml) {
    return (
      '<div class="bar">' +
      (backTarget
        ? '<button class="btn ghost small" data-nav="' + backTarget + '">← Back</button>'
        : '<span class="brand"><em>117</em> Editor</span>') +
      '<div class="bar-actions">' + (actionsHtml || "") + "</div></div>"
    );
  }

  // --- works list ----------------------------------------------------------
  function modeChip(w) {
    if (w.priceMode === "sold") return '<span class="chip sold">Sold</span>';
    if (w.priceMode === "price") return '<span class="chip price">' + esc(w.price || "Price") + "</span>";
    return '<span class="chip">On request</span>';
  }

  // Visitor count banner on the works list. Best-effort — never blocks the UI.
  function loadVisits() {
    var el = document.getElementById("visits");
    if (!el) return;
    api("/stats").then(function (s) {
      if (!document.getElementById("visits")) return; // navigated away
      var total = Number(s.total || 0), today = Number(s.today || 0);
      el.innerHTML =
        '<strong>' + total.toLocaleString() + '</strong> ' +
        (total === 1 ? "visit" : "visits") +
        ' <span class="sub">· ' + today.toLocaleString() + " today</span>";
    }).catch(function () {
      if (el) el.textContent = "";
    });
  }

  function renderList() {
    state.editingId = null;
    var cards = state.works.map(function (w, i) {
      return (
        '<div class="card" data-id="' + w.id + '">' +
        '<div class="order">' +
        '<button data-move="up" data-id="' + w.id + '" aria-label="Move up"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
        '<button data-move="down" data-id="' + w.id + '" aria-label="Move down"' + (i === state.works.length - 1 ? " disabled" : "") + ">↓</button>" +
        "</div>" +
        '<img class="thumb" src="' + esc(mediaUrl(w.image)) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'" />' +
        '<div class="meta"><div class="t">' + esc(w.title) + "</div>" +
        '<div class="s">' + (i + 1) + " / " + state.works.length + " · " + modeChip(w) +
        (w.hidden ? ' <span class="chip hidden">Hidden</span>' : "") +
        "</div></div>" +
        '<button class="open" data-edit="' + w.id + '" aria-label="Edit ' + esc(w.title) + '">›</button>' +
        "</div>"
      );
    }).join("");

    app.innerHTML =
      bar(null,
        '<a class="btn ghost small" href="https://117-cuv.pages.dev/" target="_blank" rel="noreferrer">View site ↗</a>' +
        '<button class="btn ghost small" data-nav="diary">Diary</button>' +
        '<button class="btn ghost small" data-nav="settings">Settings</button>' +
        '<button class="btn ghost small" id="logout">Log out</button>') +
      '<div class="visits" id="visits">· · ·</div>' +
      '<div class="list">' + (cards || '<p style="color:var(--muted);padding:30px 10px;text-align:center">No works yet — add the first one.</p>') + "</div>" +
      '<div class="fab-row"><button class="btn rust" id="addWork">＋ Add work</button></div>';

    loadVisits();

    document.getElementById("logout").addEventListener("click", async function () {
      try { await api("/logout", { method: "POST" }); } catch (e) {}
      renderLogin();
    });
    document.getElementById("addWork").addEventListener("click", async function () {
      try {
        var data = await api("/works", { method: "POST", body: { title: "Untitled" } });
        state.works.push(data.work);
        renderEdit(data.work.id);
      } catch (e) { toast(e.message, true); }
    });
    wireListEvents();
  }

  function wireListEvents() {
    app.querySelectorAll("[data-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () { renderEdit(Number(btn.dataset.edit)); });
    });
    // the whole card opens the editor — only the ↑/↓ buttons do their own thing
    app.querySelectorAll(".card").forEach(function (el) {
      el.addEventListener("click", function (e) {
        if (e.target.closest("[data-move]")) return;
        renderEdit(Number(el.dataset.id));
      });
    });
    app.querySelectorAll("[data-move]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = Number(btn.dataset.id);
        var idx = state.works.findIndex(function (w) { return w.id === id; });
        var to = btn.dataset.move === "up" ? idx - 1 : idx + 1;
        if (to < 0 || to >= state.works.length) return;
        var tmp = state.works[idx];
        state.works[idx] = state.works[to];
        state.works[to] = tmp;
        renderList();
        clearTimeout(reorderTimer);
        reorderTimer = setTimeout(async function () {
          try {
            await api("/reorder", { method: "POST", body: { order: state.works.map(function (w) { return w.id; }) } });
            toast("Order saved");
          } catch (e) { toast(e.message, true); }
        }, 700);
      });
    });
    app.querySelectorAll("[data-nav=settings]").forEach(function (b) {
      b.addEventListener("click", renderSettings);
    });
    app.querySelectorAll("[data-nav=diary]").forEach(function (b) {
      b.addEventListener("click", renderDiaryAdmin);
    });
  }

  // --- diary ("117 seen in the wild") ----------------------------------------
  function renderDiaryAdmin() {
    state.editingId = "diary";
    api("/diary").then(function (data) {
      var entries = data.entries || [];
      var cards = entries.map(function (e) {
        return (
          '<div class="card">' +
          '<img class="thumb" src="' + esc(mediaUrl(e.image)) + '" alt="" loading="lazy" />' +
          '<div class="meta">' +
          '<input class="cap-input" data-cap="' + e.id + '" type="text" placeholder="Caption (optional)" value="' + esc(e.caption) + '" />' +
          '<div class="s" style="margin-top:6px;">' + esc(String(e.date || "").slice(0, 10)) + "</div>" +
          "</div>" +
          '<button class="btn danger small" data-rmdiary="' + e.id + '" aria-label="Delete">✕</button>' +
          "</div>"
        );
      }).join("");

      app.innerHTML =
        bar("list") +
        '<div class="list">' +
        '<p style="color:var(--muted);font-size:13px;padding:4px 4px 14px;">117, seen in the wild — newest first on the site. Captions save as you type.</p>' +
        (cards || '<p style="color:var(--muted);padding:30px 10px;text-align:center">No sightings yet — add the first one.</p>') +
        "</div>" +
        '<div class="fab-row"><button class="btn rust" id="addDiary">＋ Add sighting</button></div>';

      app.querySelector("[data-nav=list]").addEventListener("click", renderList);

      document.getElementById("addDiary").addEventListener("click", async function () {
        var file = await pickFile("image/*");
        if (!file) return;
        var edited = await openCropper(file);
        if (!edited) return;
        if (edited === file) edited = await toJpeg(file);
        toast("Uploading…");
        try {
          var path = await uploadFile(edited, function (pct) { toast("Uploading… " + pct + "%"); });
          await api("/diary", { method: "POST", body: { image: path, caption: "" } });
          toast("Added");
          renderDiaryAdmin();
        } catch (err) { toast(err.message, true); }
      });

      app.querySelectorAll("[data-rmdiary]").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          if (!confirm("Delete this photo?")) return;
          try {
            await api("/diary/" + btn.dataset.rmdiary, { method: "DELETE" });
            renderDiaryAdmin();
          } catch (err) { toast(err.message, true); }
        });
      });

      app.querySelectorAll("[data-cap]").forEach(function (inp) {
        var timer = null;
        inp.addEventListener("input", function () {
          clearTimeout(timer);
          timer = setTimeout(async function () {
            try {
              await api("/diary/" + inp.dataset.cap, { method: "PUT", body: { caption: inp.value } });
              toast("Caption saved");
            } catch (err) { toast(err.message, true); }
          }, 900);
        });
      });
    }).catch(function (e) { toast(e.message, true); });
  }

  // --- edit work -----------------------------------------------------------
  function field(label, id, value, type) {
    if (type === "textarea") {
      return '<div class="field"><label for="' + id + '">' + label + "</label>" +
        '<textarea id="' + id + '">' + esc(value) + "</textarea></div>";
    }
    return '<div class="field"><label for="' + id + '">' + label + "</label>" +
      '<input id="' + id + '" type="text" value="' + esc(value) + '" /></div>';
  }

  function renderEdit(id) {
    var w = findWork(id);
    if (!w) return renderList();
    state.editingId = id;

    var detailCells = (w.details || []).map(function (src, i, arr) {
      return '<div class="dcell"><img src="' + esc(mediaUrl(src)) + '" alt="" />' +
        '<button class="x" data-rmdetail="' + i + '" aria-label="Remove">✕</button>' +
        (i > 0 ? '<button class="mv left" data-movedetail="' + i + '" data-dir="-1" aria-label="Move earlier">‹</button>' : '') +
        (i < arr.length - 1 ? '<button class="mv right" data-movedetail="' + i + '" data-dir="1" aria-label="Move later">›</button>' : '') +
        '</div>';
    }).join("");

    var videoList = workVideos(w);
    var videoCells = videoList.map(function (src, i) {
      return '<div class="videorow"><span class="nm">' + esc(src.split("/").pop()) + "</span>" +
        '<button class="btn ghost small" data-rmvideo="' + i + '">Remove</button></div>';
    }).join("");

    app.innerHTML =
      bar("list",
        '<button class="btn danger small" id="deleteWork">Delete</button>') +
      '<div class="form">' +

      '<div class="field"><label>Main photo</label>' +
      '<img class="mainphoto" id="mainPhoto" src="' + esc(mediaUrl(w.image)) + '" alt="" />' +
      '<div class="photo-actions"><button class="btn ghost" id="replacePhoto">Replace photo</button></div></div>' +

      field("Title", "f-title", w.title) +
      '<div class="row2">' + field("Year", "f-year", w.year) + field("Size", "f-size", w.size) + "</div>" +
      field("Materials", "f-materials", w.materials, "textarea") +
      field("Frame (optional)", "f-frame", w.frame) +
      field("Note (optional)", "f-note", w.note) +

      '<div class="field"><label>Price display</label>' +
      '<div class="seg" id="modeSeg">' +
      '<button data-mode="inquire" class="' + (w.priceMode === "inquire" ? "on" : "") + '">On request</button>' +
      '<button data-mode="price" class="' + (w.priceMode === "price" ? "on" : "") + '">Show price</button>' +
      '<button data-mode="sold" class="' + (w.priceMode === "sold" ? "on" : "") + '">Sold</button>' +
      "</div></div>" +
      '<div class="field" id="priceField"' + (w.priceMode === "price" ? "" : " hidden") + ">" +
      '<label for="f-price">Price (as shown, e.g. ₪12,000)</label>' +
      '<input id="f-price" type="text" value="' + esc(w.price) + '" /></div>' +

      '<div class="field"><label>Process photos (shown in the enlarged view)</label>' +
      '<div class="detail-grid" id="detailGrid">' + detailCells +
      '<button class="addcell" id="addDetail"><b>＋</b>Add</button></div>' +
      '<div class="hint">Tip: pick several photos at once.</div></div>' +

      '<div class="field"><label>Process video</label>' +
      videoCells +
      '<div class="videorow"><span class="nm">' +
      (videoList.length ? "Add more videos" : "No video yet") + "</span>" +
      '<button class="btn ghost small" id="addVideo">Add video</button></div></div>' +

      '<div class="field"><div class="switchrow"><div><div class="lab">Hidden</div>' +
      '<div class="sub">Keep it off the public site while you work on it</div></div>' +
      '<span class="switch"><input type="checkbox" id="f-hidden"' + (w.hidden ? " checked" : "") + ' /><span class="knob"></span></span>' +
      "</div></div>" +

      "</div>" +
      '<div class="savebar"><span class="status" id="saveStatus"></span>' +
      '<button class="btn rust" id="saveWork">Save</button></div>';

    wireEditEvents(w);
  }

  function wireEditEvents(w) {
    app.querySelector("[data-nav=list]").addEventListener("click", renderList);

    // price mode segmented control
    var mode = w.priceMode;
    app.querySelectorAll("#modeSeg button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        mode = btn.dataset.mode;
        app.querySelectorAll("#modeSeg button").forEach(function (b) { b.classList.toggle("on", b === btn); });
        document.getElementById("priceField").hidden = mode !== "price";
      });
    });

    var status = document.getElementById("saveStatus");

    // main photo replace
    document.getElementById("replacePhoto").addEventListener("click", async function () {
      var file = await pickFile("image/*");
      if (!file) return;
      var edited = await openCropper(file);
      if (!edited) return; // cancelled
      if (edited === file) edited = await toJpeg(file); // couldn't decode — old path
      var img = document.getElementById("mainPhoto");
      img.classList.add("busy");
      status.textContent = "Uploading…";
      try {
        var path = await uploadFile(edited, function (pct) {
          status.textContent = "Uploading… " + pct + "%";
        });
        var data = await api("/works/" + w.id, { method: "PUT", body: { image: path } });
        Object.assign(w, data.work);
        img.src = path;
        toast("Photo updated");
      } catch (e) { toast(e.message, true); }
      img.classList.remove("busy");
      status.textContent = "";
    });

    // process photos — pick one (with cropper) or many (converted as-is)
    document.getElementById("addDetail").addEventListener("click", async function () {
      var files = await pickFiles("image/*");
      if (!files.length) return;
      if (files.length > 1) {
        var seen = {}, deduped = [], skipped = 0;
        for (var h = 0; h < files.length; h++) {
          var hash = await fileHash(files[h]);
          if (seen[hash]) { skipped++; continue; }
          seen[hash] = true;
          deduped.push(files[h]);
        }
        files = deduped;
        if (skipped) toast(skipped + (skipped === 1 ? " identical duplicate skipped" : " identical duplicates skipped"));
      }
      var details = (w.details || []).slice();
      try {
        for (var i = 0; i < files.length; i++) {
          var prepped;
          if (files.length === 1) {
            var edited = await openCropper(files[i]);
            if (!edited) return; // cancelled the single-photo crop
            prepped = edited === files[i] ? await toJpeg(files[i], 2400) : edited;
          } else {
            prepped = await toJpeg(files[i], 2400); // batch: no per-photo cropping
          }
          var label = files.length > 1 ? "photo " + (i + 1) + "/" + files.length : "photo";
          var current = i;
          var path = await uploadFile(prepped, function (pct) {
            status.textContent = "Uploading " + (files.length > 1 ? (current + 1) + "/" + files.length : "") + "… " + pct + "%";
          });
          details.push(path);
        }
        var data = await api("/works/" + w.id, { method: "PUT", body: { details: details } });
        Object.assign(w, data.work);
        renderEdit(w.id);
        toast(files.length > 1 ? files.length + " photos added" : "Process photo added");
      } catch (e) { toast(e.message, true); status.textContent = ""; }
    });
    app.querySelectorAll("[data-rmdetail]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var i = Number(btn.dataset.rmdetail);
        var details = (w.details || []).slice();
        details.splice(i, 1);
        try {
          var data = await api("/works/" + w.id, { method: "PUT", body: { details: details } });
          Object.assign(w, data.work);
          renderEdit(w.id);
        } catch (e) { toast(e.message, true); }
      });
    });
    app.querySelectorAll("[data-movedetail]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var i = Number(btn.dataset.movedetail);
        var to = i + Number(btn.dataset.dir);
        var details = (w.details || []).slice();
        if (to < 0 || to >= details.length) return;
        var tmp = details[i]; details[i] = details[to]; details[to] = tmp;
        try {
          var data = await api("/works/" + w.id, { method: "PUT", body: { details: details } });
          Object.assign(w, data.work);
          renderEdit(w.id);
        } catch (e) { toast(e.message, true); }
      });
    });

    // videos — add one or several; each saved into the videos array
    var addVideo = document.getElementById("addVideo");
    if (addVideo) {
      addVideo.addEventListener("click", async function () {
        var files = await pickFiles("video/mp4,video/quicktime,video/webm,video/*");
        if (!files.length) return;
        if (files.some(function (f) { return f.size > 95 * 1024 * 1024; })) {
          return toast("Each video must be under ~95 MB — trim the big ones first", true);
        }
        // iOS can run out of memory and kill the tab if too many large videos
        // are selected in one go. Cap the batch and let people add more after.
        var MAX_BATCH = 6;
        if (files.length > MAX_BATCH) {
          files = files.slice(0, MAX_BATCH);
          toast("Adding the first " + MAX_BATCH + " — select the rest in another batch", true);
        }
        addVideo.disabled = true;
        var videos = workVideos(w).slice();
        try {
          for (var i = 0; i < files.length; i++) {
            var current = i;
            var path = await uploadFile(files[i], function (pct) {
              status.textContent = "Uploading video " + (files.length > 1 ? (current + 1) + "/" + files.length + " " : "") + "… " + pct + "%";
            });
            videos.push(path);
            // save after every single video — if the tab dies mid-batch
            // (iOS memory pressure), whatever finished uploading is kept
            var data = await api("/works/" + w.id, { method: "PUT", body: { videos: videos, video: "" } });
            Object.assign(w, data.work);
          }
          renderEdit(w.id);
          toast(files.length > 1 ? files.length + " videos added" : "Video added");
        } catch (e) { toast(e.message, true); addVideo.disabled = false; status.textContent = ""; renderEdit(w.id); }
      });
    }
    app.querySelectorAll("[data-rmvideo]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var videos = workVideos(w).slice();
        videos.splice(Number(btn.dataset.rmvideo), 1);
        try {
          var data = await api("/works/" + w.id, { method: "PUT", body: { videos: videos, video: "" } });
          Object.assign(w, data.work);
          renderEdit(w.id);
        } catch (e) { toast(e.message, true); }
      });
    });

    // save text fields
    document.getElementById("saveWork").addEventListener("click", async function () {
      var payload = {
        title: document.getElementById("f-title").value,
        year: document.getElementById("f-year").value,
        size: document.getElementById("f-size").value,
        materials: document.getElementById("f-materials").value,
        frame: document.getElementById("f-frame").value,
        note: document.getElementById("f-note").value,
        priceMode: mode,
        price: document.getElementById("f-price").value,
        hidden: document.getElementById("f-hidden").checked,
      };
      try {
        var data = await api("/works/" + w.id, { method: "PUT", body: payload });
        Object.assign(w, data.work);
        toast("Saved");
        renderList();
      } catch (e) { toast(e.message, true); }
    });

    // delete
    document.getElementById("deleteWork").addEventListener("click", async function () {
      if (!confirm('Delete "' + w.title + '"? This cannot be undone.')) return;
      try {
        await api("/works/" + w.id, { method: "DELETE" });
        state.works = state.works.filter(function (x) { return x.id !== w.id; });
        toast("Deleted");
        renderList();
      } catch (e) { toast(e.message, true); }
    });
  }

  // --- site settings ---------------------------------------------------------
  function renderSettings() {
    var s = state.site || {};
    state.editingId = "settings";
    app.innerHTML =
      bar("list") +
      '<div class="form">' +
      '<div class="sect-title">Site</div>' +
      '<div class="row2">' + field("Number", "s-number", s.number || "117") + field("Year", "s-year", s.year || "") + "</div>" +
      field("Artist name", "s-name", s.name || "") +
      field("Tagline (title page, optional)", "s-tagline", s.tagline || "") +
      '<div class="sect-title">Contact</div>' +
      field("Email", "s-email", s.email || "") +
      '<div class="row2">' + field("Phone (tel link)", "s-phone", s.phone || "") + field("Phone (as shown)", "s-phoneDisplay", s.phoneDisplay || "") + "</div>" +
      field("Instagram URL (optional)", "s-instagram", s.instagram || "") +
      "</div>" +
      '<div class="savebar"><span class="status"></span><button class="btn rust" id="saveSite">Save</button></div>';

    app.querySelector("[data-nav=list]").addEventListener("click", renderList);
    document.getElementById("saveSite").addEventListener("click", async function () {
      try {
        var data = await api("/site", {
          method: "PUT",
          body: {
            number: document.getElementById("s-number").value,
            year: document.getElementById("s-year").value,
            name: document.getElementById("s-name").value,
            tagline: document.getElementById("s-tagline").value,
            email: document.getElementById("s-email").value,
            phone: document.getElementById("s-phone").value,
            phoneDisplay: document.getElementById("s-phoneDisplay").value,
            instagram: document.getElementById("s-instagram").value,
          },
        });
        state.site = data.site;
        toast("Saved");
        renderList();
      } catch (e) { toast(e.message, true); }
    });
  }

  // --- boot -------------------------------------------------------------------
  async function loadAll() {
    var w = await api("/works");
    var s = await api("/site");
    state.works = w.works;
    state.site = s.site;
    renderList();
  }

  (async function () {
    try {
      await api("/me");
      await loadAll();
    } catch (e) {
      /* not logged in — login screen already rendered by api() */
    }
  })();
})();
