import bricolageData from '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?inline';
import sourceSansData from '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2?inline';
import plexMonoData from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?inline';

function fontBuffer(dataUrl: string) {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
  return bytes.buffer;
}

export function loadLocalFonts() {
  const fonts = [
    new FontFace('Bricolage Grotesque Variable', fontBuffer(bricolageData), { weight: '200 800', display: 'swap' }),
    new FontFace('Source Sans 3 Variable', fontBuffer(sourceSansData), { weight: '200 900', display: 'swap' }),
    new FontFace('IBM Plex Mono', fontBuffer(plexMonoData), { weight: '500', display: 'swap' }),
  ];

  for (const font of fonts) void font.load().then((loaded) => document.fonts.add(loaded));
}
