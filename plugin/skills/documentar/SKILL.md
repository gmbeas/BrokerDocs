---
name: documentar
description: Redacta y exporta documentación con la marca del proyecto (Markdown → Word/PDF con logo, colores y diagramas). Úsala cuando pidan documentar el avance del día, de la semana, de un issue o PR, un informe o acta, o exportar un .md a Word o PDF.
---

# BrokerDocs: documentar y exportar con marca

La herramienta es `node scripts/brokerdocs.js`, relativa a la carpeta de esta skill (usa la ruta absoluta de esa carpeta). Solo necesita Node. El diseño (logo, colores, fuentes, encabezado, pie, tablas y diagramas) lo aplica la herramienta, así que **no lo describas ni lo repitas en el Markdown**.

## Flujo (en este orden, sin pasos extra)

1. **Contexto en una sola llamada.** No ejecutes `git log`/`git diff` por tu cuenta.
   - Día: `brokerdocs.js contexto dia [AAAA-MM-DD]`
   - Semana: `brokerdocs.js contexto semana [AAAA-MM-DD]`
   - Issue: `brokerdocs.js contexto issue <n>` (usa `gh` si está disponible)
   - Rango: `brokerdocs.js contexto rango <desde> <hasta>`
   - Opciones: `--autor "nombre"`, `--max 40`. Lee código solo si un commit no se entiende por su mensaje.
   - Suma lo que el usuario haya contado en la conversación (reuniones, decisiones, bloqueos).
2. **Plantilla.** Usa `templates/diario.md`, `templates/semanal.md` o `templates/issue.md`. Para otros documentos, usa el mismo front matter (`tipo`, `titulo`, `subtitulo`, `fecha`, `autor`).
3. **Escribe el .md** en `docs/avances/` (o en la carpeta que indique el usuario), con el nombre `AAAA-MM-DD-diario.md`, `AAAA-Www-semanal.md` o `issue-<n>.md`.
4. **Exporta:** `brokerdocs.js export <archivo.md> --to docx` (Word, por defecto). Otras opciones: `--to pdf`, `--to all` (Word + PDF), `--to html`, `--page A4`.
5. **Responde en 1–2 líneas** con las rutas generadas. No repitas el contenido del documento en el chat.

Si la salida avisa que no hay marca, sugiere una vez `brokerdocs.js brand init`, que crea `.brokerdocs/brand.json` en la raíz del proyecto. Con la extensión BrokerDocs de VS Code, la marca se edita visualmente.

## Reglas de redacción
- Español, directo y concreto. Escribe resultados ("login con SSO funcionando"), no actividades ("se trabajó en login").
- Agrupa los commits por área o funcionalidad; nunca los listes uno por uno. Cita como mucho un hash por punto.
- Elimina las secciones que queden vacías. No inventes datos: si falta algo, deja `{por confirmar}`.
- Diagrama ```mermaid``` solo cuando aporte: un flujo nuevo, un cambio de arquitectura o un proceso del issue. Como máximo uno por documento, con 8 nodos o menos. Usa etiquetas cortas y no uses `<br/>`.
- Tablas para indicadores o cambios por archivo. Para destacar, usa `> [!NOTE]`, `> [!WARNING]`, `> [!RIESGO]` o `> [!BLOQUEO]` en la primera línea de la cita.
- Largo orientativo: diario ≤ 1 página, semanal ≤ 2, issue ≤ 2.

## Markdown que entiende el exportador
Títulos `#`–`####`, **negrita**, *cursiva*, ~~tachado~~, `código`, [enlaces](url), imágenes locales, listas (con anidación y `- [ ]`/`- [x]`), tablas con alineación, bloques de código, notas `> [!NOTE]`, `---` y ```mermaid```.
