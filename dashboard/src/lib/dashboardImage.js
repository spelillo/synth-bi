// dashboard/src/lib/dashboardImage.js — renders the dashboard canvas as it
// looks right now (layout, tile backgrounds and titles, every chart, text
// boxes, canvas background) into one SVG, then rasterizes it to a PNG. Used
// by the Export modal's "Dashboard image" option.
//
// Charts are already SVG (shared/chart-engine.js), so they're embedded
// as-is, positioned from the live grid. Text boxes are re-set as SVG text,
// wrapped with canvas text metrics at the box's own font and width. Web
// fonts can't load inside an SVG drawn to a canvas, so the image falls back
// to the system sans for text — layout and colors are exact.

const escXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function radiusOf(el) {
  return parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
}

function colorOf(value, fallback) {
  return !value || value === 'rgba(0, 0, 0, 0)' || value === 'transparent' ? fallback : value;
}

// gridEl: the react-grid-layout container (.dash-grid) or the stacked list.
export function composeDashboardSvg(gridEl, { background = '#e8ebe6', padding = 24 } = {}) {
  const base = gridEl.getBoundingClientRect();
  const width = Math.ceil(gridEl.scrollWidth) + padding * 2;
  const height = Math.ceil(gridEl.scrollHeight) + padding * 2;
  const measure = document.createElement('canvas').getContext('2d');
  const rel = r => ({ x: r.left - base.left + padding, y: r.top - base.top + padding, w: r.width, h: r.height });
  let body = '';
  let clipId = 0;

  gridEl.querySelectorAll('.tile, .text-tile').forEach(el => {
    const box = rel(el.getBoundingClientRect());
    const cs = getComputedStyle(el);
    const fill = colorOf(cs.backgroundColor, 'none');
    const r = radiusOf(el);
    const clip = `c${clipId++}`;
    body += `<clipPath id="${clip}"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${r}" /></clipPath>`;
    body += `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${r}" fill="${fill}"${cs.borderTopWidth !== '0px' && cs.borderTopColor !== 'rgba(0, 0, 0, 0)' && cs.borderTopColor !== 'transparent' ? ` stroke="${cs.borderTopColor}"` : ''} />`;
    body += `<g clip-path="url(#${clip})">`;

    if (el.classList.contains('tile')) {
      ['.tile-title', '.tile-subtitle'].forEach(sel => {
        const t = el.querySelector(sel);
        if (!t) return;
        const tr = rel(t.getBoundingClientRect());
        const ts = getComputedStyle(t);
        const anchor = ts.textAlign === 'center' ? 'middle' : ts.textAlign === 'right' ? 'end' : 'start';
        const tx = anchor === 'middle' ? tr.x + tr.w / 2 : anchor === 'end' ? tr.x + tr.w : tr.x;
        body += `<text x="${tx}" y="${tr.y + tr.h * 0.72}" font-size="${ts.fontSize}" font-weight="${ts.fontWeight}" fill="${ts.color}" text-anchor="${anchor}" font-family="Inter, Helvetica, Arial, sans-serif">${escXml(t.textContent)}</text>`;
      });
      const canvas = el.querySelector('.chart-canvas');
      const svg = canvas && canvas.querySelector('svg');
      if (svg) {
        const cr = rel(canvas.getBoundingClientRect());
        const sr = rel(svg.getBoundingClientRect());
        const inner = `c${clipId++}`;
        const clone = svg.cloneNode(true);
        clone.setAttribute('x', sr.x);
        clone.setAttribute('y', sr.y);
        clone.setAttribute('width', sr.w);
        clone.setAttribute('height', sr.h);
        body += `<clipPath id="${inner}"><rect x="${cr.x}" y="${cr.y}" width="${cr.w}" height="${cr.h}" /></clipPath><g clip-path="url(#${inner})">${new XMLSerializer().serializeToString(clone)}</g>`;
      } else {
        const msg = el.querySelector('.tile-message span');
        if (msg) body += `<text x="${box.x + box.w / 2}" y="${box.y + box.h / 2}" font-size="13" fill="#868685" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif">${escXml(msg.textContent)}</text>`;
      }
    } else {
      const content = el.querySelector('.text-tile-content');
      if (content) {
        content.querySelectorAll(':scope > div, :scope > ul > li').forEach(block => {
          if (block.classList.contains('tb-placeholder') || block.classList.contains('tb-gap')) return;
          const br = rel(block.getBoundingClientRect());
          const bs = getComputedStyle(block);
          const fontSize = parseFloat(bs.fontSize);
          const lineH = parseFloat(bs.lineHeight) || fontSize * 1.25;
          measure.font = `${bs.fontStyle} ${bs.fontWeight} ${fontSize}px Inter, Helvetica, Arial, sans-serif`;
          const bullet = block.tagName === 'LI';
          const lines = wrapLines(measure, block.textContent, br.w - (bullet ? 4 : 0));
          const anchor = bs.textAlign === 'center' ? 'middle' : bs.textAlign === 'right' ? 'end' : 'start';
          const x = anchor === 'middle' ? br.x + br.w / 2 : anchor === 'end' ? br.x + br.w : br.x;
          lines.forEach((ln, i) => {
            const y = br.y + lineH * i + fontSize * 0.95;
            if (bullet && i === 0) body += `<circle cx="${br.x - fontSize * 0.55}" cy="${y - fontSize * 0.32}" r="${Math.max(2, fontSize * 0.12)}" fill="${bs.color}" />`;
            body += `<text x="${x}" y="${y}" font-size="${fontSize}" font-weight="${bs.fontWeight}" font-style="${bs.fontStyle}" fill="${bs.color}" text-anchor="${anchor}" font-family="Inter, Helvetica, Arial, sans-serif">${escXml(ln)}</text>`;
          });
        });
      }
    }
    body += '</g>';
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${background}" />${body}</svg>`;
  return { svg, width, height };
}

export function svgToPngBlob(svg, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Couldn't create the image."))), 'image/png');
    };
    img.onerror = () => reject(new Error("Couldn't render the dashboard image."));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export async function renderDashboardPng(gridEl, options) {
  const { svg, width, height } = composeDashboardSvg(gridEl, options);
  return svgToPngBlob(svg, width, height, options && options.scale);
}
