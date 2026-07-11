/* ============================================================
 * recarga.js — widget de recarga del landing de Yaub Móvil.
 *
 * Modal autocontenido: el cliente pone su NÚMERO (+ nombre/correo opcionales),
 * elige un plan del catálogo REAL y paga con una LIGA DE PAGO Conekta (la misma
 * que usa el app, vía LikePhone). El pago se acredita solo; el widget hace
 * polling del estado hasta confirmar.
 *
 * Backend: función pública yaub-movil-checkout (recargas Conekta, sin access key).
 * SOLO recargas a líneas existentes (la compra de línea nueva no va por aquí).
 *
 * Uso: incluye <script src="recarga.js" defer></script> y marca cualquier
 * botón/enlace con [data-recarga-open] para abrir el modal.
 * ============================================================ */
(function () {
  "use strict";

  var CHECKOUT_URL =
    window.YAUB_CHECKOUT_URL ||
    "https://xwjhuixuvmyzfhujvxhf.supabase.co/functions/v1/yaub-movil-checkout";

  // ── Estado ──
  var plans = [];
  var selectedCv = null;
  var order = null;
  var polling = false;
  var pollAbort = false;

  var el = {}; // refs a nodos del modal

  // ── API ──
  function post(body) {
    return fetch(CHECKOUT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok || !d || d.success === false) {
            var code = (d && d.error) || "error_" + r.status;
            var err = new Error(code);
            err.code = code;
            throw err;
          }
          return d;
        });
      })
      .catch(function (e) {
        if (e && e.code) throw e;
        var err = new Error("sin_conexion");
        err.code = "sin_conexion";
        throw err;
      });
  }

  function normNum(v) {
    return String(v || "").replace(/\D/g, "").slice(-10);
  }
  function validEmail(v) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || "").trim());
  }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // ── Render de pasos ──
  function setPhase(p) { el.root.setAttribute("data-phase", p); }

  function renderPlans() {
    if (!plans.length) {
      el.plans.innerHTML = '<p class="yr-muted">No hay planes disponibles ahora mismo.</p>';
      return;
    }
    el.plans.innerHTML = "";
    plans.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "yr-plan";
      b.setAttribute("data-cv", String(p.cv_plan));
      if (p.cv_plan === selectedCv) b.classList.add("is-sel");
      b.innerHTML =
        '<span class="yr-plan-main">' +
        '<span class="yr-plan-name">' + esc(p.plan) + "</span>" +
        '<span class="yr-plan-meta">' + p.gb + " GB · " + p.vigencia_dias + " días</span>" +
        "</span>" +
        '<span class="yr-plan-price">$' + p.precio + "</span>";
      b.addEventListener("click", function () {
        selectedCv = p.cv_plan;
        renderPlans();
        syncCta();
      });
      el.plans.appendChild(b);
    });
  }

  function syncCta() {
    var num = normNum(el.num.value);
    var plan = plans.find(function (p) { return p.cv_plan === selectedCv; });
    var ok = /^\d{10}$/.test(num) && !!plan;
    el.pay.disabled = !ok;
    el.pay.textContent = plan ? "Pagar $" + plan.precio : "Selecciona un plan";
    el.numErr.textContent = num && !/^\d{10}$/.test(num) ? "Deben ser 10 dígitos." : "";
  }

  function loadPlans() {
    setPhase("loading");
    post({ action: "plans" })
      .then(function (d) {
        plans = Array.isArray(d.planes) ? d.planes : [];
        renderPlans();
        setPhase("form");
        syncCta();
      })
      .catch(function () {
        el.errMsg.textContent = "No se pudieron cargar los planes. Intenta de nuevo.";
        setPhase("error");
      });
  }

  function pay() {
    var num = normNum(el.num.value);
    var plan = plans.find(function (p) { return p.cv_plan === selectedCv; });
    if (!/^\d{10}$/.test(num) || !plan) return;

    var email = el.email.value.trim();
    if (email && !validEmail(email)) {
      el.email.focus();
      return;
    }
    var body = { action: "create", msisdn: num, cv_plan: plan.cv_plan };
    if (email) body.email = email;
    var nombre = el.nombre.value.trim();
    if (nombre) body.nombre = nombre;

    setPhase("creating");
    post(body)
      .then(function (d) {
        order = { order_id: d.order_id, msisdn: num, payment_link: d.payment_link };
        // Fallback anti popup-blocker: el enlace visible siempre apunta a la liga.
        if (el.openLink) el.openLink.href = d.payment_link;
        // Abrir la liga de pago en pestaña nueva.
        window.open(d.payment_link, "_blank", "noopener");
        return poll(order, 40);
      })
      .catch(function (e) {
        el.errMsg.textContent =
          e.code === "sin_conexion"
            ? "Sin conexión. Intenta de nuevo."
            : e.code === "demasiados_intentos"
            ? "Demasiadas recargas pendientes para este número. Intenta más tarde."
            : "No se pudo iniciar el pago. Intenta de nuevo.";
        setPhase("error");
      });
  }

  function poll(ord, rounds) {
    setPhase("verifying");
    pollAbort = false;
    polling = true;
    var i = 0;
    function step() {
      if (pollAbort) { polling = false; return Promise.resolve(); }
      if (i >= rounds) { polling = false; setPhase("timeout"); return Promise.resolve(); }
      i++;
      return post({ action: "status", msisdn: ord.msisdn, order_id: ord.order_id })
        .then(function (st) {
          if (pollAbort) { polling = false; return; }
          if (st.pagado || st.activado) {
            polling = false;
            el.doneSub.textContent = st.activado
              ? "Tu " + (st.plan || "recarga") + " ya quedó aplicada."
              : "Tu " + (st.plan || "recarga") + " se está aplicando; en unos minutos verás tus datos.";
            setPhase("done");
            return;
          }
          return sleep(3000).then(step);
        })
        .catch(function () { return sleep(3000).then(step); });
    }
    return step();
  }

  // ── Abrir / cerrar ──
  function open() {
    if (!el.root) build();
    el.root.classList.add("is-open");
    document.body.style.overflow = "hidden";
    selectedCv = null;
    order = null;
    el.num.value = "";
    el.nombre.value = "";
    el.email.value = "";
    loadPlans();
  }
  function close() {
    pollAbort = true;
    polling = false;
    el.root.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ── Construcción del modal (una sola vez) ──
  function build() {
    injectStyles();
    var root = document.createElement("div");
    root.className = "yr-overlay";
    root.setAttribute("data-phase", "loading");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Recargar tu línea Yaub Móvil");
    root.innerHTML =
      '<div class="yr-modal">' +
      '  <button class="yr-close" type="button" aria-label="Cerrar">✕</button>' +
      '  <div class="yr-head"><span class="yr-dot"></span><h3>Recarga tu línea</h3>' +
      '    <p class="yr-muted">Pon tu número, elige un plan y paga seguro con Conekta.</p></div>' +
      // form
      '  <div class="yr-step yr-form">' +
      '    <div class="yr-field"><label>Tu número Yaub Móvil</label>' +
      '      <input class="yr-num" inputmode="numeric" autocomplete="tel" maxlength="14" placeholder="10 dígitos" />' +
      '      <span class="yr-err yr-num-err"></span></div>' +
      '    <div class="yr-row">' +
      '      <div class="yr-field"><label>Nombre <span class="yr-opt">(opcional)</span></label>' +
      '        <input class="yr-nombre" autocomplete="name" placeholder="Tu nombre" /></div>' +
      '      <div class="yr-field"><label>Correo <span class="yr-opt">(opcional, para tu recibo)</span></label>' +
      '        <input class="yr-email" type="email" autocomplete="email" placeholder="tu@correo.com" /></div>' +
      '    </div>' +
      '    <div class="yr-plans-label">Elige tu plan</div>' +
      '    <div class="yr-plans"></div>' +
      '    <button class="yr-pay btn primary" type="button" disabled>Selecciona un plan</button>' +
      '    <p class="yr-secure">Pago seguro con Conekta · Tu recarga se acredita sola al pagar.</p>' +
      "  </div>" +
      // loading
      '  <div class="yr-step yr-loading"><div class="yr-spin"></div><p class="yr-muted">Cargando planes…</p></div>' +
      // creating
      '  <div class="yr-step yr-creating"><div class="yr-spin"></div><p>Generando tu pago…</p></div>' +
      // verifying
      '  <div class="yr-step yr-verifying"><div class="yr-spin"></div><p>Verificando tu recarga…</p>' +
      '    <p class="yr-muted">Termina el pago en la pestaña que se abrió. Tu recarga se acredita sola al confirmarse; puede tardar un par de minutos.</p>' +
      '    <a class="yr-open-link btn" target="_blank" rel="noopener">Abrir pago de nuevo</a></div>' +
      // done
      '  <div class="yr-step yr-done"><div class="yr-check">✓</div><h4>¡Pago confirmado!</h4>' +
      '    <p class="yr-muted yr-done-sub"></p><button class="yr-ok btn primary" type="button">Listo</button></div>' +
      // timeout
      '  <div class="yr-step yr-timeout"><h4>Aún no confirmamos la recarga</h4>' +
      '    <p class="yr-muted">Si ya pagaste, no te preocupes: se acredita sola en unos minutos. Puedes verificar de nuevo o cerrar y revisar tu saldo más tarde.</p>' +
      '    <button class="yr-retry btn primary" type="button">Volver a verificar</button>' +
      '    <button class="yr-close2 btn" type="button">Cerrar</button></div>' +
      // error
      '  <div class="yr-step yr-error"><p class="yr-errmsg"></p>' +
      '    <button class="yr-close3 btn primary" type="button">Cerrar</button></div>' +
      "</div>";
    document.body.appendChild(root);

    el.root = root;
    el.num = root.querySelector(".yr-num");
    el.nombre = root.querySelector(".yr-nombre");
    el.email = root.querySelector(".yr-email");
    el.numErr = root.querySelector(".yr-num-err");
    el.plans = root.querySelector(".yr-plans");
    el.pay = root.querySelector(".yr-pay");
    el.doneSub = root.querySelector(".yr-done-sub");
    el.errMsg = root.querySelector(".yr-errmsg");
    el.openLink = root.querySelector(".yr-open-link");

    el.num.addEventListener("input", syncCta);
    el.pay.addEventListener("click", pay);
    root.querySelector(".yr-close").addEventListener("click", close);
    root.querySelector(".yr-ok").addEventListener("click", close);
    root.querySelector(".yr-close2").addEventListener("click", close);
    root.querySelector(".yr-close3").addEventListener("click", close);
    root.querySelector(".yr-retry").addEventListener("click", function () {
      if (order) poll(order, 20);
    });
    root.addEventListener("click", function (e) { if (e.target === root) close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && root.classList.contains("is-open")) close();
    });
  }

  function injectStyles() {
    if (document.getElementById("yr-styles")) return;
    var s = document.createElement("style");
    s.id = "yr-styles";
    s.textContent = [
      ".yr-overlay{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.72);backdrop-filter:blur(6px);font-family:var(--sans,'Geist',system-ui,sans-serif)}",
      ".yr-overlay.is-open{display:flex}",
      ".yr-modal{position:relative;width:100%;max-width:440px;max-height:90vh;overflow-y:auto;background:var(--bg-2,#0B0B12);border:1px solid var(--line-strong,rgba(255,255,255,.1));border-radius:18px;padding:26px 24px;box-shadow:0 24px 80px rgba(0,0,0,.6),0 0 0 1px rgba(34,211,238,.06)}",
      ".yr-close{position:absolute;top:14px;right:14px;width:34px;height:34px;border:none;background:transparent;color:var(--text-dim,#9CA3AF);font-size:18px;cursor:pointer;border-radius:8px}",
      ".yr-close:hover{background:rgba(255,255,255,.06);color:var(--text,#E5E7EB)}",
      ".yr-head{margin-bottom:18px;padding-right:28px}",
      ".yr-head h3{margin:0;font-size:22px;font-weight:700;color:var(--text,#E5E7EB)}",
      ".yr-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--cyan,#22D3EE);box-shadow:0 0 10px var(--cyan,#22D3EE);margin-bottom:8px}",
      ".yr-muted{color:var(--text-dim,#9CA3AF);font-size:13px;line-height:1.5;margin:6px 0 0}",
      ".yr-step{display:none}",
      '.yr-overlay[data-phase="form"] .yr-form{display:block}',
      '.yr-overlay[data-phase="loading"] .yr-loading{display:flex;flex-direction:column;align-items:center;gap:14px;padding:40px 0}',
      '.yr-overlay[data-phase="creating"] .yr-creating,',
      '.yr-overlay[data-phase="verifying"] .yr-verifying{display:flex;flex-direction:column;align-items:center;gap:14px;padding:34px 0;text-align:center;color:var(--text,#E5E7EB)}',
      '.yr-overlay[data-phase="done"] .yr-done,',
      '.yr-overlay[data-phase="timeout"] .yr-timeout,',
      '.yr-overlay[data-phase="error"] .yr-error{display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px 0;text-align:center}',
      ".yr-field{margin-bottom:14px;display:flex;flex-direction:column}",
      ".yr-row{display:flex;gap:12px}.yr-row .yr-field{flex:1}",
      ".yr-field label{font-size:12px;color:var(--text-dim,#9CA3AF);margin-bottom:6px;font-weight:500}",
      ".yr-opt{color:var(--text-faint,#6B7280);font-weight:400}",
      ".yr-field input{background:var(--bg-3,#12121C);border:1px solid var(--line-strong,rgba(255,255,255,.1));border-radius:10px;padding:11px 13px;color:var(--text,#E5E7EB);font-size:15px;font-family:inherit;outline:none;transition:border-color .15s}",
      ".yr-field input:focus{border-color:var(--cyan,#22D3EE)}",
      ".yr-err{color:var(--danger,#F87171);font-size:12px;min-height:14px;margin-top:4px}",
      ".yr-plans-label{font-size:12px;color:var(--text-dim,#9CA3AF);font-weight:500;margin:8px 0 8px}",
      ".yr-plans{display:flex;flex-direction:column;gap:8px;margin-bottom:18px;max-height:38vh;overflow-y:auto}",
      ".yr-plan{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;text-align:left;background:var(--bg-3,#12121C);border:1px solid var(--line,rgba(255,255,255,.06));border-radius:12px;padding:13px 15px;cursor:pointer;transition:border-color .15s,background .15s;color:var(--text,#E5E7EB)}",
      ".yr-plan:hover{border-color:var(--line-cyan-soft,rgba(34,211,238,.16))}",
      ".yr-plan.is-sel{border-color:var(--cyan,#22D3EE);background:var(--cyan-soft,rgba(34,211,238,.12))}",
      ".yr-plan-main{display:flex;flex-direction:column;gap:3px}",
      ".yr-plan-name{font-size:15px;font-weight:600}",
      ".yr-plan-meta{font-size:12px;color:var(--text-dim,#9CA3AF)}",
      ".yr-plan-price{font-size:18px;font-weight:700;font-family:var(--mono,monospace)}",
      ".yr-pay{width:100%;justify-content:center}.yr-pay:disabled{opacity:.45;cursor:not-allowed;transform:none;filter:none}",
      ".yr-secure{text-align:center;color:var(--text-faint,#6B7280);font-size:11px;margin:12px 0 0}",
      ".yr-spin{width:38px;height:38px;border:3px solid rgba(255,255,255,.12);border-top-color:var(--cyan,#22D3EE);border-radius:50%;animation:yr-rot .8s linear infinite}",
      "@keyframes yr-rot{to{transform:rotate(360deg)}}",
      ".yr-check{width:64px;height:64px;border-radius:50%;background:rgba(52,211,153,.15);color:var(--green,#34D399);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800}",
      ".yr-done h4,.yr-timeout h4{margin:0;font-size:20px;font-weight:700;color:var(--text,#E5E7EB)}",
      ".yr-done .btn,.yr-timeout .btn,.yr-error .btn{width:100%;justify-content:center;margin-top:6px}",
      ".yr-errmsg{color:var(--danger,#F87171);font-size:15px;font-weight:600}",
      "@media(max-width:480px){.yr-row{flex-direction:column;gap:0}.yr-modal{padding:22px 18px}}",
    ].join("\n");
    document.head.appendChild(s);
  }

  // ── Bind de disparadores ──
  function bind() {
    document.querySelectorAll("[data-recarga-open]").forEach(function (t) {
      t.addEventListener("click", function (e) {
        e.preventDefault();
        open();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  // Exponer por si se quiere abrir programáticamente.
  window.YaubRecarga = { open: open, close: close };
})();
