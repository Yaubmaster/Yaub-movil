/* ============================================================
 * recarga.js — pasarela de recarga del landing de Yaub Móvil.
 *
 * Modal autocontenido: el cliente pone su NÚMERO (+ nombre/correo opcionales),
 * elige una de las recargas VIGENTES y paga con una LIGA DE PAGO Conekta (la
 * misma que usa el app, vía LikePhone). El pago se acredita solo; el widget hace
 * polling del estado hasta confirmar.
 *
 * Backend: función pública yaub-movil-checkout (recargas Conekta, sin access key).
 * SOLO recargas a líneas existentes. La compra de línea nueva / plan de
 * activación NO va por aquí: ese rail es Mercado Pago + esim-create (service
 * role, asignación manual del plan en el CRM de LikePhone) y sigue por WhatsApp.
 *
 * Uso: incluye <script src="recarga.js" defer></script> y marca cualquier
 * botón/enlace con [data-recarga-open] para abrir el modal. Si el disparador
 * lleva [data-recarga-cv="276"] el plan queda preseleccionado.
 * ============================================================ */
(function () {
  "use strict";

  var CHECKOUT_URL =
    window.YAUB_CHECKOUT_URL ||
    "https://xwjhuixuvmyzfhujvxhf.supabase.co/functions/v1/yaub-movil-checkout";

  /* ── Recargas vigentes del landing ───────────────────────────
   * El catálogo de LikePhone trae 19 planes de recarga con nombres de marca
   * ajena (LikeON, LikeWOW, Corpo…) y precios duplicados. Aquí solo van los
   * cv_plan que la página anuncia, en el orden en que se muestran.
   *
   * El NOMBRE y los GB/días NO se hardcodean: se derivan de lo que devuelve el
   * catálogo en vivo, así el modal nunca promete algo distinto a lo que LikePhone
   * va a activar. El PRECIO además lo revalida el servidor al crear la orden.
   *
   * Para agregar o quitar una recarga del landing, edita solo esta lista.
   * ──────────────────────────────────────────────────────────── */
  var RECARGAS_VIGENTES = [
    { cv_plan: 276, badge: null },          // $62  · 2 GB  · 7 días
    { cv_plan: 278, badge: null },          // $108 · 5 GB  · 15 días
    { cv_plan: 284, badge: "Más datos" },   // $280 · 12 GB · 30 días
  ];

  // Número de WhatsApp de Yaub Móvil (fallback si el catálogo no responde).
  // Debe coincidir con WA_NUMBER de index.html.
  var WA_FALLBACK = window.YAUB_WA_NUMBER || "5215589627209";

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

  // Cruza el catálogo en vivo con la whitelist del landing, respetando su orden.
  // Un cv_plan que desaparece del catálogo simplemente no se muestra.
  function curar(catalogo) {
    var byCv = {};
    catalogo.forEach(function (p) { byCv[String(p.cv_plan)] = p; });
    return RECARGAS_VIGENTES
      .map(function (w) {
        var p = byCv[String(w.cv_plan)];
        return p ? { cv_plan: p.cv_plan, precio: p.precio, gb: p.gb, dias: p.vigencia_dias, badge: w.badge } : null;
      })
      .filter(Boolean);
  }

  // Etiqueta derivada del catálogo, sin marcas ajenas: "7 días · 2 GB".
  function etiqueta(p) {
    var d = p.dias === 1 ? "1 día" : p.dias + " días";
    return d + " · " + p.gb + " GB";
  }

  // ── Render de pasos ──
  function setPhase(p) { el.root.setAttribute("data-phase", p); }

  function renderPlans() {
    el.plans.innerHTML = "";
    plans.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "yr-plan";
      b.setAttribute("data-cv", String(p.cv_plan));
      if (p.cv_plan === selectedCv) b.classList.add("is-sel");
      b.innerHTML =
        '<span class="yr-plan-main">' +
        '<span class="yr-plan-name">' + esc(etiqueta(p)) + "</span>" +
        '<span class="yr-plan-meta">Llamadas y SMS incluidos</span>' +
        "</span>" +
        (p.badge ? '<span class="yr-plan-badge">' + esc(p.badge) + "</span>" : "") +
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
    el.pay.textContent = plan ? "Pagar $" + plan.precio : "Selecciona tu recarga";
    el.numErr.textContent = num && !/^\d{10}$/.test(num) ? "Deben ser 10 dígitos." : "";
  }

  function loadPlans() {
    setPhase("loading");
    post({ action: "plans" })
      .then(function (d) {
        plans = curar(Array.isArray(d.planes) ? d.planes : []);
        if (!plans.length) return fallbackWhatsApp();
        // Un solo plan disponible: preselecciónalo.
        if (plans.length === 1 && selectedCv == null) selectedCv = plans[0].cv_plan;
        renderPlans();
        setPhase("form");
        syncCta();
      })
      .catch(fallbackWhatsApp);
  }

  // Si el catálogo no responde, no dejamos al cliente en un callejón: lo
  // mandamos con Yaub Pal, que sí puede generarle la liga a mano.
  function fallbackWhatsApp() {
    el.errMsg.textContent = "No pudimos cargar las recargas en este momento.";
    el.errHelp.hidden = false;
    el.errHelp.href =
      "https://wa.me/" + WA_FALLBACK + "?text=" +
      encodeURIComponent("Hola 👋 Quiero hacer una recarga a mi línea Yaub");
    setPhase("error");
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
        el.errHelp.hidden = true;
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
              ? "Tu recarga ya quedó aplicada."
              : "Tu recarga se está aplicando; en unos minutos verás tus datos.";
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
  // opts: { numero: "10 dígitos" (prefill), cv: 276 (preselección) }
  function open(opts) {
    if (!el.root) build();
    opts = opts || {};
    el.root.classList.add("is-open");
    document.body.style.overflow = "hidden";
    selectedCv = Number(opts.cv) || null;
    order = null;
    el.num.value = normNum(opts.numero) || "";
    el.nombre.value = "";
    el.email.value = "";
    el.errHelp.hidden = true;
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
      '    <p class="yr-muted">Pon tu número, elige tu recarga y paga seguro con Conekta.</p></div>' +
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
      '    <div class="yr-plans-label">Elige tu recarga</div>' +
      '    <div class="yr-plans"></div>' +
      '    <button class="yr-pay" type="button" disabled>Selecciona tu recarga</button>' +
      '    <p class="yr-secure">Pago seguro con Conekta · Tu recarga se acredita sola al pagar.</p>' +
      "  </div>" +
      // loading
      '  <div class="yr-step yr-loading"><div class="yr-spin"></div><p class="yr-muted">Cargando recargas…</p></div>' +
      // creating
      '  <div class="yr-step yr-creating"><div class="yr-spin"></div><p>Generando tu pago…</p></div>' +
      // verifying
      '  <div class="yr-step yr-verifying"><div class="yr-spin"></div><p>Verificando tu recarga…</p>' +
      '    <p class="yr-muted">Termina el pago en la pestaña que se abrió. Tu recarga se acredita sola al confirmarse; puede tardar un par de minutos.</p>' +
      '    <a class="yr-open-link yr-btn-ghost" target="_blank" rel="noopener">Abrir pago de nuevo</a></div>' +
      // done
      '  <div class="yr-step yr-done"><div class="yr-check">✓</div><h4>¡Pago confirmado!</h4>' +
      '    <p class="yr-muted yr-done-sub"></p><button class="yr-ok yr-pay" type="button">Listo</button></div>' +
      // timeout
      '  <div class="yr-step yr-timeout"><h4>Aún no confirmamos la recarga</h4>' +
      '    <p class="yr-muted">Si ya pagaste, no te preocupes: se acredita sola en unos minutos. Puedes verificar de nuevo o cerrar y revisar tu saldo más tarde.</p>' +
      '    <button class="yr-retry yr-pay" type="button">Volver a verificar</button>' +
      '    <button class="yr-close2 yr-btn-ghost" type="button">Cerrar</button></div>' +
      // error
      '  <div class="yr-step yr-error"><p class="yr-errmsg"></p>' +
      '    <a class="yr-errhelp yr-pay" target="_blank" rel="noopener" hidden>Recargar por WhatsApp</a>' +
      '    <button class="yr-close3 yr-btn-ghost" type="button">Cerrar</button></div>' +
      "</div>";
    document.body.appendChild(root);

    el.root = root;
    el.num = root.querySelector(".yr-num");
    el.nombre = root.querySelector(".yr-nombre");
    el.email = root.querySelector(".yr-email");
    el.numErr = root.querySelector(".yr-num-err");
    el.plans = root.querySelector(".yr-plans");
    el.pay = root.querySelector(".yr-form .yr-pay");
    el.doneSub = root.querySelector(".yr-done-sub");
    el.errMsg = root.querySelector(".yr-errmsg");
    el.errHelp = root.querySelector(".yr-errhelp");
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

  /* Estilos del modal — tema CLARO, alineado a los tokens del landing
     (--bg #F7F8FB, --surface #fff, --ink #14141F, --cyan #0891B2). Los
     fallbacks permiten que el modal se vea bien aunque se embeba en otra página. */
  function injectStyles() {
    if (document.getElementById("yr-styles")) return;
    var s = document.createElement("style");
    s.id = "yr-styles";
    s.textContent = [
      ".yr-overlay{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(20,20,31,.46);backdrop-filter:blur(6px);font-family:var(--font,'Geist','Inter',ui-sans-serif,system-ui,sans-serif);letter-spacing:-0.01em}",
      ".yr-overlay.is-open{display:flex}",
      ".yr-modal{position:relative;width:100%;max-width:460px;max-height:90vh;overflow-y:auto;background:var(--surface,#fff);border:1px solid var(--line,rgba(20,20,31,.08));border-radius:24px;padding:30px 26px;box-shadow:0 30px 80px rgba(20,20,31,.22)}",
      ".yr-close{position:absolute;top:16px;right:16px;width:34px;height:34px;border:none;background:transparent;color:var(--ink-3,rgba(20,20,31,.42));font-size:17px;cursor:pointer;border-radius:10px;line-height:1}",
      ".yr-close:hover{background:rgba(20,20,31,.05);color:var(--ink,#14141F)}",
      ".yr-head{margin-bottom:20px;padding-right:30px}",
      ".yr-head h3{margin:0;font-size:24px;font-weight:800;color:var(--ink,#14141F);letter-spacing:-0.02em}",
      ".yr-dot{display:block;width:9px;height:9px;border-radius:50%;background:var(--cyan,#0891B2);margin-bottom:10px}",
      ".yr-muted{color:var(--ink-2,rgba(20,20,31,.64));font-size:13.5px;line-height:1.55;margin:7px 0 0}",
      ".yr-step{display:none}",
      '.yr-overlay[data-phase="form"] .yr-form{display:block}',
      '.yr-overlay[data-phase="loading"] .yr-loading{display:flex;flex-direction:column;align-items:center;gap:14px;padding:40px 0}',
      '.yr-overlay[data-phase="creating"] .yr-creating,',
      '.yr-overlay[data-phase="verifying"] .yr-verifying{display:flex;flex-direction:column;align-items:center;gap:14px;padding:34px 0;text-align:center;color:var(--ink,#14141F);font-weight:600}',
      '.yr-overlay[data-phase="done"] .yr-done,',
      '.yr-overlay[data-phase="timeout"] .yr-timeout,',
      '.yr-overlay[data-phase="error"] .yr-error{display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px 0;text-align:center}',
      ".yr-field{margin-bottom:15px;display:flex;flex-direction:column}",
      ".yr-row{display:flex;gap:12px}.yr-row .yr-field{flex:1;min-width:0}",
      ".yr-field label{font-size:12.5px;color:var(--ink-2,rgba(20,20,31,.64));margin-bottom:7px;font-weight:600}",
      ".yr-opt{color:var(--ink-3,rgba(20,20,31,.42));font-weight:500}",
      ".yr-field input{width:100%;box-sizing:border-box;background:var(--bg,#F7F8FB);border:1px solid var(--line,rgba(20,20,31,.08));border-radius:14px;padding:13px 15px;color:var(--ink,#14141F);font-size:15px;font-family:inherit;outline:none;transition:border-color .15s,box-shadow .15s}",
      ".yr-field input::placeholder{color:var(--ink-3,rgba(20,20,31,.42))}",
      ".yr-field input:focus{border-color:var(--cyan,#0891B2);box-shadow:0 0 0 3px rgba(8,145,178,.12)}",
      ".yr-err{color:#DC2626;font-size:12px;min-height:14px;margin-top:5px}",
      ".yr-plans-label{font-size:12.5px;color:var(--ink-2,rgba(20,20,31,.64));font-weight:600;margin:10px 0 9px}",
      ".yr-plans{display:flex;flex-direction:column;gap:9px;margin-bottom:20px}",
      ".yr-plan{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:var(--bg,#F7F8FB);border:1.5px solid var(--line,rgba(20,20,31,.08));border-radius:16px;padding:14px 16px;cursor:pointer;transition:border-color .15s,background .15s;color:var(--ink,#14141F);font-family:inherit}",
      ".yr-plan:hover{border-color:rgba(8,145,178,.34)}",
      ".yr-plan.is-sel{border-color:var(--cyan,#0891B2);background:rgba(8,145,178,.07)}",
      ".yr-plan-main{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}",
      ".yr-plan-name{font-size:15.5px;font-weight:700}",
      ".yr-plan-meta{font-size:12px;color:var(--ink-2,rgba(20,20,31,.64));font-weight:500}",
      ".yr-plan-badge{flex:none;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--lime,#65A30D);background:rgba(101,163,13,.12);padding:4px 9px;border-radius:999px}",
      ".yr-plan-price{flex:none;font-size:19px;font-weight:800}",
      ".yr-pay{display:inline-flex;align-items:center;justify-content:center;width:100%;box-sizing:border-box;padding:16px 24px;border:none;border-radius:16px;background:linear-gradient(120deg,var(--cyan,#0891B2),var(--cyan-b,#22D3EE));color:#fff;font-family:inherit;font-size:16px;font-weight:800;letter-spacing:-0.01em;cursor:pointer;text-decoration:none;box-shadow:0 14px 32px rgba(8,145,178,.3);transition:transform .3s cubic-bezier(.22,1,.36,1),box-shadow .3s}",
      ".yr-pay:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 20px 40px rgba(8,145,178,.38);color:#fff}",
      ".yr-pay:disabled{opacity:.42;cursor:not-allowed;transform:none;box-shadow:none}",
      ".yr-btn-ghost{display:inline-flex;align-items:center;justify-content:center;width:100%;box-sizing:border-box;padding:14px 24px;border:1.5px solid var(--line,rgba(20,20,31,.08));border-radius:16px;background:transparent;color:var(--ink-2,rgba(20,20,31,.64));font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;text-decoration:none}",
      ".yr-btn-ghost:hover{background:rgba(20,20,31,.04);color:var(--ink,#14141F)}",
      ".yr-secure{text-align:center;color:var(--ink-3,rgba(20,20,31,.42));font-size:11.5px;margin:13px 0 0;font-weight:500}",
      ".yr-spin{width:38px;height:38px;border:3px solid rgba(20,20,31,.1);border-top-color:var(--cyan,#0891B2);border-radius:50%;animation:yr-rot .8s linear infinite}",
      "@keyframes yr-rot{to{transform:rotate(360deg)}}",
      ".yr-check{width:64px;height:64px;border-radius:50%;background:rgba(101,163,13,.14);color:var(--lime,#65A30D);display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800}",
      ".yr-done h4,.yr-timeout h4{margin:0;font-size:21px;font-weight:800;color:var(--ink,#14141F);letter-spacing:-0.02em}",
      ".yr-errmsg{color:var(--ink,#14141F);font-size:16px;font-weight:700;margin:0}",
      "@media(max-width:480px){.yr-row{flex-direction:column;gap:0}.yr-modal{padding:24px 18px;border-radius:20px}}",
      "@media(prefers-reduced-motion:reduce){.yr-spin{animation-duration:2s}.yr-pay{transition:none}.yr-pay:hover:not(:disabled){transform:none}}",
    ].join("\n");
    document.head.appendChild(s);
  }

  // ── Bind de disparadores ──
  function bind() {
    document.querySelectorAll("[data-recarga-open]").forEach(function (t) {
      t.addEventListener("click", function (e) {
        e.preventDefault();
        open({ cv: t.getAttribute("data-recarga-cv"), numero: t.getAttribute("data-recarga-num") });
      });
    });
    // Formularios que ya piden el número: lo pasamos al modal ya prellenado.
    document.querySelectorAll("[data-recarga-form]").forEach(function (f) {
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var input = f.querySelector("input");
        open({ numero: input ? input.value : "", cv: f.getAttribute("data-recarga-cv") });
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
