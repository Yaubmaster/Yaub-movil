# Yaub Móvil — Landing Page

Landing oficial de **Yaub Móvil**, el primer MVNO mexicano con un agente IA conversacional dentro de cada SIM.

## Estructura

```
/
├── Yaub Movil Landing.html    # Landing principal (entry point)
├── Yaub SMS Console.html      # Consola SMS empresarial (B2B)
├── landing.css                # Estilos completos (con responsive mobile)
└── assets/                    # Logos e iconos
    ├── yaubmovil-logo-v2.png
    ├── yaubmovil-icon-v2.png
    ├── logo-yaubai.png
    ├── logo-altan.png
    └── logo-likephone.png
```

## Cómo deployar

`yaubmovil.mx` se sirve desde **Cloudflare Workers** (Worker `yaub-movil`; antes Vercel). Cada merge a la rama de
producción se publica solo con Workers Builds. No hay build: se publican los archivos tal cual desde la raíz del repo.

- `wrangler.jsonc`: nombre del Worker y dominios (`yaubmovil.mx` y `www.yaubmovil.mx`).
- `worker.js`: solo manda `www.` al dominio sin `www`.
- `.assetsignore`: lo que NO se publica (este README, notas internas, configuración).
- Probar en local: `npx wrangler dev` y abrir http://localhost:8787.

## Funcionalidad

- **Switcher de audiencia** B2C / B2B sincroniza planes, beneficios, stack flow y promesas.
- **Nav dropdowns** ("Yaub Móvil" / "Yaub Móvil Business") cambian audiencia automáticamente y hacen scroll a planes.
- **Mobile-first nav** con hamburger menu (< 760px).
- **Responsive completo** — tablet (1100px) y mobile (760px / 420px).
- Agente IA `Yaub Pal` (B2C) · Cobranza Inteligente (B2B) · Stack flow real.

## Stack

HTML estático + CSS puro + JS vanilla. Sin frameworks, sin build step.
Geist + Geist Mono (Google Fonts).
