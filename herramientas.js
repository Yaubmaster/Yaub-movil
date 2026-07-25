/* ============================================================
 * herramientas.js — consultas del landing resueltas EN LA PÁGINA.
 *
 * Antes estos formularios solo armaban un mensaje de WhatsApp: el visitante
 * escribía su CP, se iba al chat y esperaba a que el bot le contestara. Ahora la
 * respuesta se resuelve aquí y WhatsApp queda como el paso siguiente (comprar),
 * no como el paso para obtener el dato.
 *
 * Backend: función pública yaub-movil-landing (solo lectura, rate-limit por IP).
 *   [data-cobertura]      → CP de 5 dígitos → ¿llega la red?
 *   [data-compatibilidad] → IMEI 14-16      → ¿sirve el equipo? ¿soporta eSIM?
 *
 * Cada formulario necesita un contenedor [data-out] hermano donde se pinta el
 * resultado. Si el backend falla, el fallback SIEMPRE es WhatsApp: es mejor
 * mandar al cliente con un humano que dejarlo sin respuesta.
 * ============================================================ */
(function () {
  "use strict";

  var API =
    window.YAUB_LANDING_URL ||
    "https://xwjhuixuvmyzfhujvxhf.supabase.co/functions/v1/yaub-movil-landing";

  var WA = window.YAUB_WA_NUMBER || "5215589627209";

  function waUrl(msg) {
    return "https://wa.me/" + WA + "?text=" + encodeURIComponent(msg);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function post(body) {
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        // Los 400/429 traen un `mensaje` pensado para el cliente: lo respetamos
        // en vez de tratarlos como fallo genérico.
        if (!d || (d.success === false && !d.mensaje)) throw new Error(d && d.error || "error");
        return d;
      });
    });
  }

  // ── Render del resultado ──
  function paint(out, kind, html) {
    out.className = "tool-out is-" + kind;
    out.innerHTML = html;
    out.hidden = false;
  }

  function spinner(out) {
    out.className = "tool-out is-load";
    out.innerHTML = '<span class="tool-spin"></span> Consultando…';
    out.hidden = false;
  }

  function falla(out, msg, waMsg) {
    paint(out, "warn",
      "<strong>" + esc(msg) + "</strong>" +
      '<a class="tool-wa" target="_blank" rel="noopener" href="' + esc(waUrl(waMsg)) + '">' +
      "Pregúntanos por WhatsApp</a>");
  }

  // ── Cobertura por CP ──
  function cobertura(form, out) {
    var input = form.querySelector("input");
    var cp = String(input.value || "").replace(/\D/g, "");
    if (!/^\d{5}$/.test(cp)) {
      paint(out, "warn", "<strong>El código postal debe tener 5 dígitos.</strong>");
      input.focus();
      return;
    }

    spinner(out);
    post({ action: "cobertura", cp: cp })
      .then(function (d) {
        if (d.success === false) return falla(out, d.mensaje, "Hola 👋 Quiero validar cobertura en el CP: " + cp);

        // "Monterrey, Nuevo León" cuando el CP trae ciudad/estado; si no, el CP pelón.
        var lugar = [d.ciudad, d.estado].filter(Boolean).join(", ");
        var donde = lugar ? esc(lugar) + " (CP " + esc(cp) + ")" : "el CP " + esc(cp);

        if (d.tiene_cobertura) {
          paint(out, "ok",
            "<strong>✅ Sí hay cobertura en " + donde + ".</strong>" +
            "<span>Puedes cambiarte manteniendo tu mismo número.</span>" +
            '<a class="tool-wa" target="_blank" rel="noopener" href="' +
            esc(waUrl("Hola 👋 Validé cobertura en el CP " + cp + " y sí llega. Quiero cambiarme a Yaub Móvil")) +
            '">Quiero cambiarme</a>');
        } else {
          paint(out, "no",
            "<strong>Todavía no llegamos a " + donde + ".</strong>" +
            "<span>Escríbenos y te avisamos en cuanto haya cobertura en tu zona.</span>" +
            '<a class="tool-wa" target="_blank" rel="noopener" href="' +
            esc(waUrl("Hola 👋 Mi CP " + cp + " aún no tiene cobertura. ¿Me avisan cuando llegue?")) +
            '">Avísenme</a>');
        }
      })
      .catch(function () {
        falla(out, "No pudimos validar tu cobertura ahora mismo.",
          "Hola 👋 Quiero validar cobertura en el CP: " + cp);
      });
  }

  /* El catálogo de la red usa placeholders cuando no conoce el equipo: un IMEI
   * real devolvió marca "Not Known" con modelo "N900". Pegarlos tal cual daba
   * "Not Known N900: no podemos garantizar el servicio", que se lee como un error
   * de la página. Descartamos esos valores y caemos a "Tu equipo". */
  var PLACEHOLDER = /^(not known|unknown|desconocid\w*|n\/?a|-{1,}|null|undefined)$/i;

  function limpio(v) {
    var s = String(v == null ? "" : v).trim();
    return s && !PLACEHOLDER.test(s) ? s : "";
  }

  function nombreEquipo(marca, modelo) {
    return [limpio(marca), limpio(modelo)].filter(Boolean).join(" ");
  }

  // ── Compatibilidad por IMEI ──
  function compatibilidad(form, out) {
    var input = form.querySelector("input");
    var imei = String(input.value || "").replace(/\D/g, "");
    if (!/^\d{14,16}$/.test(imei)) {
      paint(out, "warn",
        "<strong>El IMEI debe tener entre 14 y 16 dígitos.</strong>" +
        "<span>Márcalo con <b>*#06#</b> en tu teléfono y cópialo completo.</span>");
      input.focus();
      return;
    }

    spinner(out);
    post({ action: "compatibilidad", imei: imei })
      .then(function (d) {
        if (d.success === false) {
          return falla(out, d.mensaje || "No pudimos validar tu equipo.",
            "Hola 👋 Quiero saber si mi equipo es compatible con Yaub Móvil");
        }

        // IMEI que no está en el catálogo: no afirmamos incompatibilidad.
        if (d.imei_encontrado === false || d.compatible === null) {
          return falla(out, d.mensaje || "No encontramos ese IMEI en el catálogo de la red.",
            "Hola 👋 Mi IMEI no aparece en el catálogo. ¿Mi equipo sirve en Yaub Móvil?");
        }

        var equipo = nombreEquipo(d.marca, d.modelo);
        var nombre = equipo ? esc(equipo) : "Tu equipo";

        if (!d.compatible) {
          return paint(out, "no",
            "<strong>" + nombre + ": no podemos garantizar el servicio.</strong>" +
            "<span>" + esc(d.mensaje || "El equipo no está homologado para la red.") + "</span>" +
            '<a class="tool-wa" target="_blank" rel="noopener" href="' +
            esc(waUrl("Hola 👋 Mi equipo " + (equipo || "(IMEI " + imei + ")") + " salió como no homologado. ¿Qué opciones tengo?")) +
            '">Revisarlo con un asesor</a>');
        }

        // Compatible: lo que más le importa al cliente es si puede usar eSIM
        // (activación inmediata) o si necesita SIM física (envío a domicilio).
        var chips =
          '<span class="tool-chip' + (d.soporta_esim ? " on" : "") + '">' +
          (d.soporta_esim ? "✓ eSIM" : "Solo SIM física") + "</span>" +
          (d.volte ? '<span class="tool-chip on">✓ VoLTE</span>' : "") +
          (d.banda_28 ? '<span class="tool-chip on">✓ Banda 28</span>' : "");

        paint(out, "ok",
          "<strong>✅ " + nombre + " es compatible.</strong>" +
          '<span class="tool-chips">' + chips + "</span>" +
          "<span>" + (d.soporta_esim
            ? "Puedes activarte con eSIM, sin esperar un envío."
            : "Tu equipo necesita SIM física; te la enviamos a domicilio.") + "</span>" +
          '<a class="tool-wa" target="_blank" rel="noopener" href="' +
          esc(waUrl("Hola 👋 Validé mi equipo" + (equipo ? " " + equipo : " (IMEI " + imei + ")") +
            " y es compatible" + (d.soporta_esim ? " con eSIM" : " (necesito SIM física)") +
            ". Quiero cambiarme a Yaub Móvil")) +
          '">Quiero cambiarme</a>');
      })
      .catch(function () {
        falla(out, "No pudimos validar tu equipo ahora mismo.",
          "Hola 👋 Quiero saber si mi equipo es compatible con Yaub Móvil");
      });
  }

  // ── Estilos del bloque de resultado ──
  function injectStyles() {
    if (document.getElementById("yh-styles")) return;
    var s = document.createElement("style");
    s.id = "yh-styles";
    s.textContent = [
      ".tool-out{margin-top:14px;padding:14px 16px;border-radius:14px;font-size:14px;line-height:1.5;display:flex;flex-direction:column;gap:6px;border:1px solid var(--line,rgba(20,20,31,.08));background:var(--bg,#F7F8FB);color:var(--ink,#14141F)}",
      ".tool-out strong{font-weight:800;font-size:14.5px}",
      ".tool-out span{color:var(--ink-2,rgba(20,20,31,.64))}",
      ".tool-out.is-ok{border-color:rgba(101,163,13,.34);background:rgba(101,163,13,.07)}",
      ".tool-out.is-no{border-color:rgba(124,58,237,.28);background:rgba(124,58,237,.06)}",
      ".tool-out.is-warn{border-color:rgba(220,38,38,.26);background:rgba(220,38,38,.05)}",
      ".tool-out.is-load{flex-direction:row;align-items:center;gap:10px;color:var(--ink-2,rgba(20,20,31,.64))}",
      ".tool-spin{width:16px;height:16px;flex:none;border:2px solid rgba(20,20,31,.14);border-top-color:var(--cyan,#0891B2);border-radius:50%;display:inline-block;animation:yh-rot .8s linear infinite}",
      "@keyframes yh-rot{to{transform:rotate(360deg)}}",
      ".tool-chips{display:flex;flex-wrap:wrap;gap:6px}",
      ".tool-chip{font-size:11.5px;font-weight:800;padding:4px 9px;border-radius:999px;background:rgba(20,20,31,.06);color:var(--ink-2,rgba(20,20,31,.64))}",
      ".tool-chip.on{background:rgba(8,145,178,.12);color:var(--cyan,#0891B2)}",
      ".tool-wa{align-self:flex-start;margin-top:4px;font-weight:800;font-size:13.5px;color:var(--cyan,#0891B2);text-decoration:none;border-bottom:1.5px solid rgba(8,145,178,.32)}",
      ".tool-wa:hover{color:var(--ink,#14141F);border-bottom-color:var(--ink,#14141F)}",
      // `.tool .tool-hint` y no `.tool-hint`: el landing trae `.tool p{font-size:14px;
      // color:var(--ink-2)}`, que por especificidad (0,1,1) le ganaría a una sola clase.
      ".tool .tool-hint{font-size:12px;color:var(--ink-3,rgba(20,20,31,.42));margin:9px 0 0}",
      "@media(prefers-reduced-motion:reduce){.tool-spin{animation-duration:2s}}",
    ].join("\n");
    document.head.appendChild(s);
  }

  function bind() {
    injectStyles();
    [["data-cobertura", cobertura], ["data-compatibilidad", compatibilidad]].forEach(function (pair) {
      document.querySelectorAll("[" + pair[0] + "]").forEach(function (form) {
        var out = form.parentNode.querySelector("[data-out]");
        if (!out) return;
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          pair[1](form, out);
        });
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
