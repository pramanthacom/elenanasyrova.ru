const { mkdirSync, writeFileSync } = require("fs");
const { join } = require("path");

const outDir = join(__dirname, "..", "assets", "cards");
const targetUrl = "https://t.me/ElenaNasyrovaContactsBot?start=wild_fest";
const size = 33; // QR version 4
const dataCodewords = 64;
const ecCodewordsPerBlock = 18;
const blockDataCodewords = 32;

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function reedSolomonDivisor(degree) {
  const result = Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data, divisor) {
  const result = Array(divisor.length).fill(0);
  for (const value of data) {
    const factor = value ^ result.shift();
    result.push(0);
    divisor.forEach((coef, index) => {
      result[index] ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

function bitsToBytes(bits) {
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | (bits[i + j] || 0);
    bytes.push(value);
  }
  return bytes;
}

function appendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

function createDataCodewords(text) {
  const bytes = [...Buffer.from(text, "utf8")];
  const bits = [];
  appendBits(bits, 0x4, 4); // Byte mode
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));
  const capacityBits = dataCodewords * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  appendBits(bits, 0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const result = bitsToBytes(bits);
  for (let pad = 0xec; result.length < dataCodewords; pad ^= 0xec ^ 0x11) {
    result.push(pad);
  }
  return result;
}

function interleaveCodewords(data) {
  const divisor = reedSolomonDivisor(ecCodewordsPerBlock);
  const dataBlocks = [
    data.slice(0, blockDataCodewords),
    data.slice(blockDataCodewords, blockDataCodewords * 2),
  ];
  const ecBlocks = dataBlocks.map((block) => reedSolomonRemainder(block, divisor));
  const result = [];

  for (let i = 0; i < blockDataCodewords; i += 1) {
    dataBlocks.forEach((block) => result.push(block[i]));
  }
  for (let i = 0; i < ecCodewordsPerBlock; i += 1) {
    ecBlocks.forEach((block) => result.push(block[i]));
  }
  return result;
}

function createQrMatrix(text) {
  const matrix = Array.from({ length: size }, () => Array(size).fill(null));
  const set = (x, y, value) => {
    if (x >= 0 && x < size && y >= 0 && y < size) matrix[y][x] = Boolean(value);
  };

  function finder(x, y) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const xx = x + dx;
        const yy = y + dy;
        const dark =
          dx >= 0 &&
          dx <= 6 &&
          dy >= 0 &&
          dy <= 6 &&
          (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        set(xx, yy, dark);
      }
    }
  }

  function alignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  alignment(26, 26);

  for (let i = 8; i < size - 8; i += 1) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }

  const formatBits = 0x5412; // ECC M, mask 0
  for (let i = 0; i <= 5; i += 1) set(8, i, (formatBits >>> i) & 1);
  set(8, 7, (formatBits >>> 6) & 1);
  set(8, 8, (formatBits >>> 7) & 1);
  set(7, 8, (formatBits >>> 8) & 1);
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, (formatBits >>> i) & 1);
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, (formatBits >>> i) & 1);
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, (formatBits >>> i) & 1);
  set(8, size - 8, true);

  const codewords = interleaveCodewords(createDataCodewords(text));
  const bits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
  let bitIndex = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vert = 0; vert < size; vert += 1) {
      const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        if (matrix[y][x] !== null) continue;
        const mask = (x + y) % 2 === 0;
        matrix[y][x] = Boolean((bits[bitIndex] || 0) ^ mask);
        bitIndex += 1;
      }
    }
  }

  return matrix.map((row) => row.map(Boolean));
}

function qrSvg(matrix, x, y, moduleSize, dark = "#102f2d") {
  const rects = [];
  matrix.forEach((row, yy) => {
    row.forEach((cell, xx) => {
      if (cell) {
        rects.push(`<rect x="${x + xx * moduleSize}" y="${y + yy * moduleSize}" width="${moduleSize}" height="${moduleSize}" rx="1.6" fill="${dark}"/>`);
      }
    });
  });
  return rects.join("\n");
}

function eyeSvg(cx, cy, scale, stroke = "#d7ad5f", opacity = 1) {
  const s = scale / 1000;
  const tx = cx - 500 * s;
  const ty = cy - 500 * s;
  const tr = `translate(${tx} ${ty}) scale(${s})`;
  return `
    <g transform="${tr}" fill="none" stroke="${stroke}" stroke-width="18" stroke-linejoin="round" opacity="${opacity}">
      <circle cx="500" cy="500" r="460"/>
      <path d="M 40 500 C 150 440 280 214 500 214 C 720 214 850 440 960 500 C 850 560 720 786 500 786 C 280 786 150 560 40 500 Z"/>
      <circle cx="500" cy="500" r="280"/>
      <path d="M 500 220 C 590 326 649 400 649 500 C 649 600 590 674 500 780 C 410 674 351 600 351 500 C 351 400 410 326 500 220 Z"/>
      <circle cx="500" cy="500" r="149"/>
      <path d="M 351 500 C 400 465 430 406 500 406 C 570 406 600 465 649 500 C 600 535 570 594 500 594 C 430 594 400 535 351 500 Z"/>
      <circle cx="500" cy="500" r="90"/>
      <circle cx="500" cy="500" r="9" fill="${stroke}" stroke="none"/>
    </g>`;
}

const matrix = createQrMatrix(targetUrl);
const qrModule = 18;
const qrSize = matrix.length * qrModule;
const qrX = (1080 - qrSize) / 2;
const qrY = 720;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="page" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fffaf3"/>
      <stop offset="0.34" stop-color="#fff1ec"/>
      <stop offset="0.72" stop-color="#fffaf3"/>
      <stop offset="1" stop-color="#f8fbf5"/>
    </linearGradient>
    <radialGradient id="aquaGlow" cx="88%" cy="72%" r="54%">
      <stop offset="0" stop-color="#bfeee8" stop-opacity="0.32"/>
      <stop offset="0.52" stop-color="#e9fbf7" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="roseGlow" cx="12%" cy="15%" r="46%">
      <stop offset="0" stop-color="#f7d5cd" stop-opacity="0.32"/>
      <stop offset="0.5" stop-color="#fff0eb" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7e9c8"/>
      <stop offset="0.52" stop-color="#d6ad62"/>
      <stop offset="1" stop-color="#fff3d5"/>
    </linearGradient>
    <linearGradient id="nameInk" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#174844"/>
      <stop offset="0.66" stop-color="#174844"/>
      <stop offset="0.86" stop-color="#9f8f62"/>
      <stop offset="1" stop-color="#d1ad62"/>
    </linearGradient>
    <linearGradient id="softTitle" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#d8b475"/>
      <stop offset="0.5" stop-color="#c9958d"/>
      <stop offset="1" stop-color="#83bdb8"/>
    </linearGradient>
    <linearGradient id="softBody" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6a8f8a"/>
      <stop offset="1" stop-color="#c59a73"/>
    </linearGradient>
    <linearGradient id="deepPanel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#143736"/>
      <stop offset="0.56" stop-color="#194946"/>
      <stop offset="1" stop-color="#0d2927"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="28" stdDeviation="34" flood-color="#7b5a48" flood-opacity="0.18"/>
    </filter>
    <filter id="goldGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <pattern id="stars" width="120" height="120" patternUnits="userSpaceOnUse">
      <circle cx="18" cy="28" r="1.8" fill="#e8c98e" opacity="0.54"/>
      <circle cx="84" cy="42" r="1.2" fill="#ffffff" opacity="0.7"/>
      <circle cx="54" cy="92" r="1.5" fill="#bfeee8" opacity="0.55"/>
    </pattern>
  </defs>

  <rect width="1080" height="1920" fill="url(#page)"/>
  <rect width="1080" height="1920" fill="url(#aquaGlow)"/>
  <rect width="1080" height="1920" fill="url(#roseGlow)"/>
  <rect width="1080" height="1920" fill="url(#stars)" opacity="0.72"/>
  <path d="M-40 1720 C160 1425 334 1508 520 1295 C734 1050 833 774 1136 625 L1136 1920 L-40 1920 Z" fill="#dff7f2" opacity="0.16"/>
  <path d="M-30 128 C150 44 330 88 514 34 C738 -32 870 26 1116 -20 L1116 1920 L-30 1920 Z" fill="#fffaf4" opacity="0.44"/>

  <rect x="66" y="66" width="948" height="1788" rx="72" fill="rgba(255,250,242,0.72)" stroke="url(#gold)" stroke-width="3"/>
  <rect x="106" y="108" width="868" height="1704" rx="42" fill="rgba(255,255,255,0.34)" stroke="#f1dfc2" stroke-width="1.2" opacity="0.92"/>

  ${eyeSvg(540, 178, 116, "#d6ac64", 0.96)}
  <text x="540" y="278" text-anchor="middle" font-family="Arial, sans-serif" font-size="27" font-weight="700" letter-spacing="7" fill="url(#nameInk)">ЕЛЕНА НАСЫРОВА</text>
  <text x="540" y="326" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="5" fill="#c99a8f" opacity="0.9">НЕОПСИХОЛОГ</text>

  <line x1="184" y1="392" x2="896" y2="392" stroke="url(#gold)" stroke-width="2"/>

  <text x="540" y="504" text-anchor="middle" font-family="Arial, sans-serif" font-size="55" font-weight="800" fill="url(#softTitle)">Сканируй QR</text>
  <text x="540" y="572" text-anchor="middle" font-family="Arial, sans-serif" font-size="43" font-weight="700" fill="#b9847c">жми Start в Telegram-боте</text>

  <rect x="150" y="664" width="780" height="780" rx="48" fill="#fff7ec" filter="url(#softShadow)" stroke="url(#gold)" stroke-width="5"/>
  <rect x="210" y="724" width="660" height="660" rx="10" fill="#fffefb"/>
  ${qrSvg(matrix, qrX, qrY, qrModule)}
  <rect x="482" y="998" width="116" height="116" rx="28" fill="#f6efe3" stroke="#d7ad5f" stroke-width="4"/>
  ${eyeSvg(540, 1056, 82, "#d7ad5f", 1)}

  <text x="540" y="1562" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" font-weight="500" fill="#66827e">Бот обменяет вас контактами</text>
  <text x="540" y="1620" text-anchor="middle" font-family="Arial, sans-serif" font-size="43" font-weight="800" fill="url(#nameInk)">с Еленой Насыровой</text>
  <text x="540" y="1720" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="3" fill="#78bbb8">&#1089;&#1086;&#1079;&#1085;&#1072;&#1085;&#1080;&#1077; &#8226; &#1076;&#1091;&#1096;&#1072; &#8226; &#1090;&#1077;&#1083;&#1086; &#8226; &#1088;&#1086;&#1076; &#8226; &#1079;&#1074;&#1077;&#1079;&#1076;&#1099;</text>

  <line x1="356" y1="1786" x2="724" y2="1786" stroke="url(#gold)" stroke-width="2" opacity="0.58"/>
  <circle cx="540" cy="1786" r="5" fill="#d6ad62" opacity="0.82"/>
</svg>
`;

mkdirSync(outDir, { recursive: true });
const svgPath = join(outDir, "elena-contacts-bot-qr-card.svg");
const htmlPath = join(outDir, "elena-contacts-bot-qr-card.html");
writeFileSync(svgPath, svg, "utf8");
writeFileSync(
  htmlPath,
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:1080px;height:1920px;overflow:hidden;background:#fff}</style>${svg}`,
  "utf8",
);

console.log(svgPath);
console.log(htmlPath);
