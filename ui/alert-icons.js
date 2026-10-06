const svg=content=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
export const chartIcon=type=>type==='delta'
  ?svg('<g class="icon-bars"><path d="M3 20h18M5 16v-5h3v5zm6 0V5h3v11zm6 0V8h3v8z"/></g>')
  :svg('<g class="icon-line"><path d="M3 4v16h18M5 15l5-7 5 4 5-8"/></g>');
export const speakerIcon=enabled=>svg(`<path d="M4 9h4l5-4v14l-5-4H4z"/>${enabled?'<g class="icon-sound"><path d="M16 8a6 6 0 010 8M19 5a10 10 0 010 14"/></g>':'<g class="icon-muted"><path d="M17 9l5 6M22 9l-5 6"/></g>'}`);
