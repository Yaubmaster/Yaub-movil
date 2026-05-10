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

1. Sube todos los archivos al repo manteniendo la estructura.
2. Renombra `Yaub Movil Landing.html` → `index.html` si quieres que sea la home.
3. Apunta tu dominio (ej. `yaub.ai/movil`) al repo desde Vercel / Netlify / GitHub Pages.

## Funcionalidad

- **Switcher de audiencia** B2C / B2B sincroniza planes, beneficios, stack flow y promesas.
- **Nav dropdowns** ("Yaub Móvil" / "Yaub Móvil Business") cambian audiencia automáticamente y hacen scroll a planes.
- **Mobile-first nav** con hamburger menu (< 760px).
- **Responsive completo** — tablet (1100px) y mobile (760px / 420px).
- Agente IA `Yaub Pal` (B2C) · Cobranza Inteligente (B2B) · Stack flow real.

## Stack

HTML estático + CSS puro + JS vanilla. Sin frameworks, sin build step.
Geist + Geist Mono (Google Fonts).
