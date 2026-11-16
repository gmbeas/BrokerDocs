# Cambios

## 2.0.0
- Nuevo nombre: **BrokerDocs** (antes Folio). Comandos y ajustes pasan a `brokerdocs.*`.
- Ícono nuevo.
- La marca vive en `.brokerdocs/brand.json` (se sigue leyendo `.folio/brand.json` si existe).
- Mismo motor disponible como CLI y como plugin de Claude Code en el mismo repositorio.

## 1.2.0
- Selección sincronizada: clic o texto marcado en la vista se selecciona en el código; el cursor en el código resalta el bloque en la vista (párrafos, ítems, filas de tabla, código, diagramas).
- Intercambiar lados código/vista (botón ⇄ y comando), con preferencia `brokerdocs.sourceSide`.
- Botón { } para abrir el código al lado del lado preferido.

## 1.1.0
- BrokerDocs como editor: aparece en "Reopen Editor With…" y en "Set Default for '*.md'".
- Editor visual de marca: selectores de color, paletas, logo y fuentes con vista previa en vivo.
- Botones en la barra de título: ver código al lado, exportar a Word/PDF y editar marca.
- La marca se recarga sola al cambiar brand.json o el logo, incluso fuera de VS Code.
- Autocompletado de `brokerdocs.brand` en settings.json.

## 1.0.0
- Vista previa en vivo con marca (logo, colores, fuentes, encabezado y pie).
- Barra de edición, atajos y menú contextual "BrokerDocs: Insertar".
- Pegar o arrastrar imágenes y adjuntos; enlaces inteligentes y detección de enlaces rotos.
- Diagramas Mermaid con colores de la marca (carga diferida).
- Notas destacadas estilo GitHub, en inglés y en español.
- Exportación a Word (.docx), PDF (Chrome/Edge del sistema) y HTML autónomo.
