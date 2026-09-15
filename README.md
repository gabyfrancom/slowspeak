# SlowSpeak 🐝

App web para practicar **inglés conversacional paso a paso**, inspirada en la metodología de *Slow English Podcast* (Miss Honey 🍯) y en la experiencia de juego de Duolingo: inglés **lento, claro y natural**, con **corrección de pronunciación por voz** en tiempo real.

![Tecnologías](https://img.shields.io/badge/stack-HTML%20%C2%B7%20CSS%20%C2%B7%20JS%20(vanilla)-FF8A3D)

## ✨ Características

- 🗺️ **Ruta de 28 días** con 140 frases conversacionales de la vida real (saludos, cafetería, direcciones, teléfono, viajes, emociones...)
- 🐢 **Inglés lento por defecto** (0.7x) con control de velocidad en cada frase
- 🎤 **Práctica por voz**: hablas, la app te transcribe y compara palabra por palabra
- 🎯 **Corrección inteligente**: fuzzy matching con tolerancia por longitud de palabra; aciertos en verde, fallos en rojo con subrayado ondulado
- 💡 Tips de pronunciación y uso natural en cada frase (estilo "errores corregidos en pantalla" del canal)
- 🎮 Gamificación: racha diaria 🔥, XP 💎, corazones ❤️, desbloqueo secuencial y confeti
- 💾 Progreso guardado localmente (localStorage), sin cuentas ni servidor
- 🐝 Mascota "Honey" que te acompaña y anima
- 🌙 Modo oscuro cuidadosamente calibrado
- 🗣️ Pronunciación escrita (aproximación fonética amigable) bajo cada frase

## 🚀 Uso

No requiere build ni instalación. Es una app 100% estática:

```bash
# Opción 1: clona y abre directamente
git clone https://github.com/TU_USUARIO/slowspeak.git
cd slowspeak

# Opción 2: sirve en local (recomendado para el micrófono)
npx serve .
# o
python3 -m http.server 8000
```

> ⚠️ **Importante:** el reconocimiento de voz (Web Speech API) funciona en **Chrome o Edge** (móvil y escritorio) y requiere **HTTPS o localhost** + permiso de micrófono. En Safari/Firefox la app muestra mensajes guía para practicar escuchando.

## 🌐 Despliegue gratuito

| Plataforma | Pasos |
|---|---|
| **GitHub Pages** | Settings → Pages → rama `main` → carpeta `/ (root)` |
| **Netlify Drop** | Arrastra la carpeta a [app.netlify.com/drop](https://app.netlify.com/drop) |
| **Vercel** | `npx vercel` dentro de la carpeta |

## 🧠 Cómo funciona la corrección

1. `speechSynthesis` (Web Speech API) lee la frase en inglés lento.
2. `SpeechRecognition` transcribe tu voz (hasta 3 alternativas, se elige la mejor).
3. Se normalizan ambos textos y se comparan **palabra por palabra** con distancia de Levenshtein:
   - coincidencia exacta → palabra verde
   - coincidencia aproximada (tolerancia según longitud) → aceptada
   - fallo → palabra roja + lista de "palabras a pulir"
4. Precisión ≥ 85% = frase superada; ≥ 99% = perfecta ⭐

## 📁 Estructura

```
slowspeak/
├── index.html   # Estructura, estilos y currículo (28 días × 5 frases)
├── app.js       # Lógica: voz, reconocimiento, puntuación, progreso
├── README.md
├── LICENSE      # MIT
└── .gitignore
```

## 🗺️ Hoja de ruta

- [ ] Modo conversación a dos voces (pregunta–respuesta)
- [ ] Días adicionales y temas avanzados
- [ ] Gráfica de progreso semanal
- [ ] Exportar/importar progreso entre dispositivos

## 📄 Licencia

MIT — úsala, modifícala y compártela libremente.

---

Hecha con 💛 para aprender inglés sin prisa, un día a la vez.
