# Prompt para Bolt — Integración Yaub Móvil en yaub.ai

> Copia y pega este prompt en Bolt (o Claude Code, o el agente que tengas conectado a tu repo).

---

## Contexto

Acabo de subir al repo los archivos de la landing de **Yaub Móvil** (nuestro MVNO con agente IA). La estructura es:

```
/
├── Yaub Movil Landing.html
├── Yaub SMS Console.html
├── landing.css
└── assets/  (logos + iconos: yaubmovil-logo-v2.png, yaubmovil-icon-v2.png, etc.)
```

Quiero integrarlo al sitio principal de **yaub.ai** sin romper el branding existente.

## Tareas

### 1. Mover los archivos a su ruta final

Reorganiza así dentro del proyecto:

```
/movil/
  ├── index.html              ← renombrar "Yaub Movil Landing.html"
  ├── sms.html                ← renombrar "Yaub SMS Console.html"
  ├── landing.css
  └── assets/
```

Asegúrate de que las rutas internas (`<link href="landing.css">`, `assets/...`) sigan resolviendo. Si el sitio principal usa Next/Vite/Astro, ajusta los paths para que `/movil/` sea servido como sub-ruta estática.

### 2. Agregar tab "Yaub Móvil" al nav principal de yaub.ai

En la nav bar de la home (`/` de yaub.ai), agrega un nuevo link **antes** del CTA principal:

- **Label:** `Yaub Móvil`
- **Href:** `/movil/` (la landing recién subida)
- **Estilo:** match al resto de los nav-links existentes (mismo color, peso, hover state). Si la nav usa un dot indicador, usa color cyan `#22D3EE` para diferenciarlo como sub-producto.
- Considera un mini badge `NUEVO` o un dot tipo "live" pulsante al lado del label durante el primer mes.

### 3. Agregar módulo "Yaub tiene su propia telefonía" en la home

**Ubicación:** justo **abajo de la sección de Stacks** (donde se muestran los productos / pilares de Yaub AI), arriba del footer o del CTA final.

**Contenido del módulo:**

```
[Logo Yaub Móvil grande, izquierda]    [Texto + CTA, derecha]

EYEBROW: NUEVO PRODUCTO · MVNO MÉXICO

H2: Yaub ahora tiene su propia telefonía.

P: Yaub Móvil es el primer MVNO mexicano con agente IA conversacional
   dentro de cada SIM. Planes desde $77, recompensas en GB, recargas
   por WhatsApp en 38 segundos, y para empresas: descuento por nómina,
   activación masiva hasta 5,000 líneas y MDM con recovery 5× superior.

[Botón primario]: Visitar Yaub Móvil ↗   →   /movil/
[Botón secundario]: Para empresas        →   /movil/#planes (con aud=b2b)
```

**Diseño:**
- Card horizontal full-width, con padding generoso (~64px vertical en desktop).
- Background con gradiente sutil cyan → púrpura (`linear-gradient(135deg, rgba(34,211,238,0.06), rgba(157,111,251,0.06))`) o un panel oscuro elevado, según matchee con el resto del sitio.
- El logo de Yaub Móvil debe usar el archivo `/movil/assets/yaubmovil-logo-v2.png` con `filter: drop-shadow(0 0 16px rgba(157,111,251,0.4))` para darle vida.
- Mobile: stack vertical, logo arriba centrado, texto y CTAs abajo.

### 4. Tracking + meta

- Agrega evento de analytics al click de "Visitar Yaub Móvil" (`event: click_yaub_movil_home`).
- Meta description del módulo / SEO: incluye keywords "MVNO México", "telefonía con IA", "Yaub Móvil".
- Open Graph: si la landing tiene OG image propio, úsalo cuando se comparta `/movil/`.

### 5. Verificar

- [ ] Nav tab nueva visible y clickeable en desktop + mobile.
- [ ] Módulo "Yaub Móvil" renderiza correctamente abajo de stacks.
- [ ] `/movil/` carga la landing completa sin errores 404 en CSS / assets.
- [ ] El switcher B2C/B2B dentro de la landing sigue funcional.
- [ ] Responsive en mobile (< 760px) tanto en yaub.ai/ como en yaub.ai/movil/.

---

**Nota:** la landing de `/movil/` ya es 100% standalone, no depende de los estilos de yaub.ai. Solo asegúrate de que las rutas estén bien servidas.
